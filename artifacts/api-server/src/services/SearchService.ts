import { db } from "@workspace/db";
import { listings, listingAttributes, listingMedia, paymentOptions, interactions, users, locations, industrialTypeEnum } from "@workspace/db/schema";
import { and, eq, lte, gte, ilike, desc, asc, sql, count, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { normalizePaymentOptions, computeOffers } from "./PaymentService";
import { transformFeedItems } from "./BffService";
import { CircuitBreaker } from "../lib/circuitBreaker";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import type { FeedItem, FacetCounts } from "../validators/schemas";

export type PaymentPlan = "installment" | "bank" | "direct" | "islamic";

export type SearchSort =
  | "recommended"
  | "newest"
  | "price_asc"
  | "price_desc"
  | "popular";

// Industrial subtype literals, sourced from the DB enum so filter inputs line
// up with the `listing_attributes.industrial_type` column in `inArray(...)`.
export type IndustrialSubtype = (typeof industrialTypeEnum.enumValues)[number];

export interface ParsedSearchQuery {
  category?: "car" | "real_estate" | "industrial";
  // Buyer request/wanted filter. undefined → both; true → only requests; false → only sales.
  is_request?: boolean;
  industrial_type?: IndustrialSubtype[];
  max_price?: number;
  min_price?: number;
  has_installment?: boolean;
  search_term?: string;
  location?: string;
  condition?: string;
  payment_plan?: PaymentPlan;
  property_type?: string;
  finishing_type?: string;
  compound?: boolean;
  furnished?: boolean;
  fuel_type?: string;
  transmission?: string;
  brand?: string;
  model?: string;
  min_year?: number;
  max_year?: number;
  industry?: string;
  origin_type?: string;
  // Near-me / radius search. All three are required together; when present,
  // results are limited to listings whose EFFECTIVE coordinate (the listing's
  // own override, else its area centroid) lies within radius_km of the point.
  // Absent → behaviour is unchanged (no geo filter).
  near_lat?: number;
  near_lng?: number;
  radius_km?: number;
  sort?: SearchSort;
}

const ARABIC_CATEGORY_MAP: Record<string, string> = {
  عربية: "car",
  سيارة: "car",
  سيارات: "car",
  اتوموبيل: "car",
  شقة: "real_estate",
  شقق: "real_estate",
  فيلا: "real_estate",
  فلل: "real_estate",
  عقار: "real_estate",
  ارض: "real_estate",
  أرض: "real_estate",
  مصنع: "industrial",
  معدات: "industrial",
  "خط انتاج": "industrial",
  "خط إنتاج": "industrial",
  مكينة: "industrial",
};

const ARABIC_PAYMENT_MAP = ["قسط", "اقساط", "أقساط", "تقسيط", "installment", "monthly"];

const ARABIC_NUMBER_MAP: Record<string, number> = {
  مليون: 1_000_000,
  مليار: 1_000_000_000,
  الف: 1_000,
  ألف: 1_000,
};

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const normalized = query.toLowerCase().trim();

  const result: ParsedSearchQuery = {};

  // Category detection
  for (const [arabic, category] of Object.entries(ARABIC_CATEGORY_MAP)) {
    if (normalized.includes(arabic)) {
      result.category = category as ParsedSearchQuery["category"];
      break;
    }
  }

  // English category fallback
  if (!result.category) {
    if (/\bcar\b|\bvehicle\b|\bauto\b/.test(normalized)) result.category = "car";
    else if (/\breal.?estate\b|\bproperty\b|\bapartment\b/.test(normalized)) result.category = "real_estate";
    else if (/\bindustrial\b|\bfactor(y|ies)\b|\bmachine\b/.test(normalized)) result.category = "industrial";
  }

  // Installment detection
  if (ARABIC_PAYMENT_MAP.some((kw) => normalized.includes(kw))) {
    result.has_installment = true;
  }

  // Price extraction: "تحت 2 مليون", "under 3 million", "5m", "500k"
  const arabicPriceMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(مليون|مليار|الف|ألف)/);
  if (arabicPriceMatch) {
    const num = parseFloat(arabicPriceMatch[1]);
    const unit = arabicPriceMatch[2];
    const multiplier = ARABIC_NUMBER_MAP[unit] ?? 1;
    const price = num * multiplier;
    if (/تحت|أقل|under|less|below|max/.test(normalized)) {
      result.max_price = price;
    } else if (/فوق|أكثر|above|over|min|more/.test(normalized)) {
      result.min_price = price;
    } else {
      result.max_price = price * 1.2;
      result.min_price = price * 0.8;
    }
  }

  const engPriceMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(m|million|k|thousand)/);
  if (!result.max_price && engPriceMatch) {
    const num = parseFloat(engPriceMatch[1]);
    const unit = engPriceMatch[2];
    const multiplier = unit.startsWith("m") ? 1_000_000 : 1_000;
    result.max_price = num * multiplier;
  }

  // Only set search_term when the query isn't purely a price/category/payment filter
  const hasStructuredFilter = result.max_price || result.min_price || result.has_installment;
  const isKnownCategory = result.category !== undefined;
  if (!hasStructuredFilter && !isKnownCategory) {
    result.search_term = query.trim();
  } else {
    // Strip price/filter keywords — keep the remaining meaningful words as title search
    const stripped = query
      .replace(/(\d+(?:\.\d+)?)\s*(مليون|مليار|الف|ألف|million|billion|thousand|[mk]b?)/gi, "")
      .replace(/تحت|أقل|فوق|أكثر|under|less|below|above|over|max|min|تقسيط|قسط|installment|monthly/gi, "")
      .replace(/سيارة|سيارات|عربية|اتوموبيل|شقة|شقق|فيلا|فلل|عقار|ارض|مصنع|معدات/g, "")
      .replace(/car|vehicle|real.?estate|property|apartment|industrial|factory/gi, "")
      .trim();
    if (stripped.length > 2) result.search_term = stripped;
  }

  return result;
}

/**
 * Shared per-section "engine" filters, applied identically by the feed
 * (in-section browsing) and search (dedicated results) so every chip returns
 * the same truthful result set. Every filter is pushed into the DB — via real
 * enum columns, JSONB `specs`, or correlated EXISTS sub-queries — never
 * post-query, so paginated pages never produce false-zero results.
 *
 * Payment semantics: installment = any non-cash plan; bank = bank_finance;
 * direct = seller_installment; islamic = sharia-compliant non-cash plan.
 */
export function buildAttributeConditions(f: {
  condition?: string;
  payment_plan?: PaymentPlan;
  has_installment?: boolean;
  property_type?: string;
  finishing_type?: string;
  compound?: boolean;
  furnished?: boolean;
  fuel_type?: string;
  transmission?: string;
  brand?: string;
  model?: string;
  min_year?: number;
  max_year?: number;
  industry?: string;
  origin_type?: string;
}): SQL[] {
  const conditions: SQL[] = [];

  // condition / property_type / finishing live in dedicated enum columns, but a
  // minority of rows only carry them inside `specs` JSON — COALESCE keeps the
  // result set complete instead of silently dropping those listings.
  if (f.condition) {
    conditions.push(
      sql`COALESCE(${listingAttributes.condition}::text, ${listingAttributes.specs}->>'condition') = ${f.condition}`
    );
  }
  if (f.property_type) {
    conditions.push(
      sql`COALESCE(${listingAttributes.propertyType}::text, ${listingAttributes.specs}->>'property_type') = ${f.property_type}`
    );
  }
  if (f.finishing_type) {
    conditions.push(
      sql`COALESCE(${listingAttributes.finishingType}::text, ${listingAttributes.specs}->>'finishing') = ${f.finishing_type}`
    );
  }
  // compound / furnished are only modelled inside `specs` JSON (boolean).
  if (f.compound !== undefined) {
    conditions.push(sql`(${listingAttributes.specs}->>'compound')::boolean = ${f.compound}`);
  }
  if (f.furnished !== undefined) {
    conditions.push(sql`(${listingAttributes.specs}->>'furnished')::boolean = ${f.furnished}`);
  }

  // Car enum filters — same COALESCE(column, specs) completeness rule.
  if (f.fuel_type) {
    conditions.push(
      sql`COALESCE(${listingAttributes.fuelType}::text, ${listingAttributes.specs}->>'fuel_type') = ${f.fuel_type}`
    );
  }
  if (f.transmission) {
    conditions.push(
      sql`COALESCE(${listingAttributes.transmission}::text, ${listingAttributes.specs}->>'transmission') = ${f.transmission}`
    );
  }
  // Industrial enum filters.
  if (f.industry) {
    conditions.push(
      sql`COALESCE(${listingAttributes.industry}::text, ${listingAttributes.specs}->>'industry') = ${f.industry}`
    );
  }
  if (f.origin_type) {
    conditions.push(
      sql`COALESCE(${listingAttributes.originType}::text, ${listingAttributes.specs}->>'origin_type') = ${f.origin_type}`
    );
  }
  // brand / model are matched against the English listing title (titles are
  // canonical "<Brand> <Model> <Year>"), keeping the NLP `q` param free for
  // genuine free text. Honest by design: a brand/model with no inventory
  // simply returns no rows rather than faking a structured catalog filter.
  if (f.brand) {
    conditions.push(ilike(listings.title, `%${f.brand}%`));
  }
  if (f.model) {
    conditions.push(ilike(listings.title, `%${f.model}%`));
  }
  // year lives only in numeric specs.year — guard the cast with a 4-digit regex
  // so non-numeric values never raise a cast error mid-query.
  if (f.min_year !== undefined) {
    conditions.push(
      sql`(CASE WHEN ${listingAttributes.specs}->>'year' ~ '^[0-9]{4}$' THEN (${listingAttributes.specs}->>'year')::int END) >= ${f.min_year}`
    );
  }
  if (f.max_year !== undefined) {
    conditions.push(
      sql`(CASE WHEN ${listingAttributes.specs}->>'year' ~ '^[0-9]{4}$' THEN (${listingAttributes.specs}->>'year')::int END) <= ${f.max_year}`
    );
  }

  const plan = f.payment_plan ?? (f.has_installment ? "installment" : undefined);
  if (plan) {
    let modeFragment: SQL;
    if (plan === "bank") {
      modeFragment = sql`AND ${paymentOptions.mode} = 'bank_finance'`;
    } else if (plan === "direct") {
      modeFragment = sql`AND ${paymentOptions.mode} = 'seller_installment'`;
    } else if (plan === "islamic") {
      modeFragment = sql`AND ${paymentOptions.isIslamicCompliant} = true AND ${paymentOptions.mode} != 'cash'`;
    } else {
      modeFragment = sql`AND ${paymentOptions.mode} != 'cash'`;
    }
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${paymentOptions}
        WHERE ${paymentOptions.listingId} = ${listings.id}
          AND ${paymentOptions.monthlyPayment} IS NOT NULL
          ${modeFragment}
      )`
    );
  }

  return conditions;
}

export async function searchListings(
  parsed: ParsedSearchQuery,
  cursor?: string,
  limit: number = 20
): Promise<{ items: FeedItem[]; cursor?: string; has_next: boolean }> {
  const sort: SearchSort = parsed.sort ?? "recommended";
  // recommended / newest keep the created_at keyset cursor (backward compatible
  // with existing clients). price_* / popular sort by a non-cursor key, so they
  // paginate by numeric offset instead — the cursor is opaque to the client, so
  // each sort carries its own consistent cursor format within a paging session.
  const useOffset =
    sort === "price_asc" || sort === "price_desc" || sort === "popular";

  const conditions = [eq(listings.status, "active")];

  if (parsed.category) conditions.push(eq(listings.category, parsed.category));
  // Buyer request/wanted filter (undefined → both sales and requests).
  if (parsed.is_request !== undefined)
    conditions.push(eq(listings.isRequest, parsed.is_request));
  // Industrial subtype filter (single subtype or a whole group). Pushed into the
  // DB via the joined 1:1 sidecar so paginated group browsing never false-empties.
  if (parsed.industrial_type && parsed.industrial_type.length > 0)
    conditions.push(inArray(listingAttributes.industrialType, parsed.industrial_type));
  if (parsed.max_price) conditions.push(lte(listings.basePriceCash, String(parsed.max_price)));
  if (parsed.min_price) conditions.push(gte(listings.basePriceCash, String(parsed.min_price)));
  if (parsed.location) conditions.push(ilike(listings.location, `%${parsed.location}%`));
  if (parsed.search_term) {
    conditions.push(ilike(listings.title, `%${parsed.search_term}%`));
  }
  // The recency keyset predicate only applies to the default/newest ordering.
  // It keys off the EFFECTIVE (bump-aware) recency timestamp so recycled
  // listings page consistently with the bump-aware ordering below. The cursor is
  // a COMPOSITE "<isoTs>|<id>" keyset matching ORDER BY (recency DESC, id ASC):
  // take rows strictly older, OR the same effective recency with a larger id.
  // A timestamp-only "< ts" cursor would SKIP rows that share the boundary
  // timestamp (common for batch-created or simultaneously-bumped listings).
  if (!useOffset && cursor) {
    const sep = cursor.indexOf("|");
    const ts = sep >= 0 ? cursor.slice(0, sep) : cursor;
    const lastId = sep >= 0 ? cursor.slice(sep + 1) : null;
    const tsDate = new Date(ts);
    const recency = sql`COALESCE(${listings.bumpedAt}, ${listings.createdAt})`;
    conditions.push(
      lastId
        ? sql`(${recency} < ${tsDate} OR (${recency} = ${tsDate} AND ${listings.id} > ${lastId}))`
        : sql`${recency} < ${tsDate}`
    );
  }
  // Hide abuse-controlled inventory (flagged listings + shadow-banned sellers).
  conditions.push(...publicVisibilityConditions());
  // Per-section engine filters (condition / payment plan / property type /
  // compound / furnished / fuel / transmission / brand / model / year /
  // industry / origin) — shared with the feed, pushed into the DB.
  conditions.push(...buildAttributeConditions(parsed));

  // Near-me / radius filter (ADDITIVE — only when all three geo params are
  // present, so existing search/feed behaviour is byte-identical without them).
  // Effective coordinate = listing override, else the joined area centroid
  // (locations LEFT JOIN below is 1:1 on location_id, so it never fans rows out).
  // A cheap bounding box prunes first; exact Haversine (km, R=6371) confirms.
  if (parsed.near_lat != null && parsed.near_lng != null && parsed.radius_km != null && parsed.radius_km > 0) {
    const effLat = sql`COALESCE(${listings.latitude}, ${locations.latitude})`;
    const effLng = sql`COALESCE(${listings.longitude}, ${locations.longitude})`;
    const latDelta = parsed.radius_km / 111; // ~111 km per degree of latitude
    const cosLat = Math.max(Math.cos((parsed.near_lat * Math.PI) / 180), 0.01);
    const lngDelta = parsed.radius_km / (111 * cosLat);
    const distanceKm = sql`6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(${parsed.near_lat})) * cos(radians(${effLat}))
        * cos(radians(${effLng}) - radians(${parsed.near_lng}))
      + sin(radians(${parsed.near_lat})) * sin(radians(${effLat}))
    )))`;
    conditions.push(sql`${effLat} IS NOT NULL AND ${effLng} IS NOT NULL`);
    conditions.push(sql`${effLat} BETWEEN ${parsed.near_lat - latDelta} AND ${parsed.near_lat + latDelta}`);
    conditions.push(sql`${effLng} BETWEEN ${parsed.near_lng - lngDelta} AND ${parsed.near_lng + lngDelta}`);
    conditions.push(sql`${distanceKm} <= ${parsed.radius_km}`);
  }

  // Popularity = lifetime views + clicks (interactions is 1:1 with a listing,
  // so the LEFT JOIN never fans rows out and is safe to keep for every sort).
  const popularity = sql<number>`COALESCE(${interactions.views}, 0) + COALESCE(${interactions.clicks}, 0)`;
  const orderBy: SQL[] =
    sort === "price_asc"
      ? [asc(listings.basePriceCash), asc(listings.id)]
      : sort === "price_desc"
        ? [desc(listings.basePriceCash), asc(listings.id)]
        : sort === "popular"
          ? [desc(popularity), asc(listings.id)]
          : // recommended / newest: bump-aware recency (recycled listings
            // resurface to the top); created_at preserved, only the SORT key
            // is effective. id tiebreaker keeps the keyset cursor stable.
            [
              desc(sql`COALESCE(${listings.bumpedAt}, ${listings.createdAt})`),
              asc(listings.id),
            ];

  const offset = useOffset && cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;

  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      category: listings.category,
      base_price_cash: listings.basePriceCash,
      location: listings.location,
      status: listings.status,
      created_at: listings.createdAt,
      user_id: listings.userId,
      is_verified: users.isVerified,
      user_name: users.name,
      user_role: users.role,
      quality_score: users.qualityScore,
      industrial_type: listingAttributes.industrialType,
      bumped_at: listings.bumpedAt,
      is_request: listings.isRequest,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .leftJoin(interactions, eq(interactions.listingId, listings.id))
    // 1:1 on location_id — provides the area centroid for the near-me filter
    // above. Harmless when no geo filter is active (LEFT JOIN, never fans out).
    .leftJoin(locations, eq(listings.locationId, locations.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  let nextCursor: string | undefined;
  if (hasNext && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = useOffset
      ? String(offset + limit)
      // Composite "<isoTs>|<id>" matching the keyset predicate above: effective
      // (bump-aware) recency timestamp plus the id tiebreaker.
      : `${new Date(last.bumped_at ?? last.created_at ?? new Date()).toISOString()}|${last.id}`;
  }

  const enriched = await enrichListings(pageRows);
  const items = transformFeedItems(enriched);

  return { items, cursor: nextCursor, has_next: hasNext };
}

export async function getAutocomplete(query: string): Promise<string[]> {
  if (!query || query.length < 2) return [];

  const results = await db
    .selectDistinct({ title: listings.title })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(
      and(
        eq(listings.status, "active"),
        ilike(listings.title, `%${query}%`),
        ...publicVisibilityConditions()
      )
    )
    .limit(10);

  return results.map((r) => r.title);
}

export async function getTrending(limit: number = 20): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      category: listings.category,
      base_price_cash: listings.basePriceCash,
      location: listings.location,
      status: listings.status,
      created_at: listings.createdAt,
      user_id: listings.userId,
      is_verified: users.isVerified,
      user_name: users.name,
      user_role: users.role,
      quality_score: users.qualityScore,
      views: interactions.views,
      clicks: interactions.clicks,
      industrial_type: listingAttributes.industrialType,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(interactions, eq(interactions.listingId, listings.id))
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(and(eq(listings.status, "active"), ...publicVisibilityConditions()))
    .orderBy(desc(sql`COALESCE(${interactions.views}, 0) + COALESCE(${interactions.clicks}, 0)`))
    .limit(limit);

  const enriched = await enrichListings(rows);
  return transformFeedItems(enriched);
}

/**
 * Per-value counts of the currently-visible inventory, optionally scoped to a
 * category. The mobile mini-app gates each filter chip on count > 0 so it never
 * offers a filter that would return an empty page. Every count uses the SAME
 * column / specs COALESCE expression as buildAttributeConditions, so a chip's
 * badge count always equals the size of the result set it produces.
 */
export async function getFacets(
  category?: "car" | "real_estate" | "industrial"
): Promise<FacetCounts> {
  const visible: SQL[] = [eq(listings.status, "active"), ...publicVisibilityConditions()];
  const scoped: SQL[] = category ? [...visible, eq(listings.category, category)] : [...visible];

  const groupMap = async (expr: SQL, where: SQL[]): Promise<Record<string, number>> => {
    const rows = await db
      .select({ k: expr, c: count() })
      .from(listings)
      .leftJoin(users, eq(listings.userId, users.id))
      .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
      .where(and(...where))
      // GROUP BY the output-column ordinal, not the expression: a COALESCE with a
      // bound JSON-key param renders different placeholder numbers in SELECT vs
      // GROUP BY, so Postgres won't treat them as the same expression. Ordinal
      // sidesteps that and groups by exactly the selected key.
      .groupBy(sql`1`);
    const map: Record<string, number> = {};
    for (const r of rows) {
      const k = r.k as unknown;
      if (k === null || k === undefined || k === "") continue;
      map[String(k)] = Number(r.c);
    }
    return map;
  };

  const countWhere = async (extra: SQL[]): Promise<number> => {
    const [row] = await db
      .select({ c: count() })
      .from(listings)
      .leftJoin(users, eq(listings.userId, users.id))
      .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
      .where(and(...scoped, ...extra));
    return Number(row?.c ?? 0);
  };

  // Mirror buildAttributeConditions: dedicated enum column with a specs-JSON
  // fallback, so facet counts and filter results stay in lockstep.
  const coalesce = (col: SQL, key: string): SQL =>
    sql`COALESCE(${col}, ${listingAttributes.specs}->>${key})`;

  const [
    total,
    categoryMap,
    condition,
    fuel_type,
    transmission,
    property_type,
    finishing_type,
    industrial_type,
    industry,
    origin_type,
    installment,
    bank,
    direct,
    islamic,
    compound,
    furnished,
  ] = await Promise.all([
    countWhere([]),
    // The category facet is intentionally unscoped so the client can show every
    // section's count and let the user switch between them.
    groupMap(sql`${listings.category}::text`, visible),
    groupMap(coalesce(sql`${listingAttributes.condition}::text`, "condition"), scoped),
    groupMap(coalesce(sql`${listingAttributes.fuelType}::text`, "fuel_type"), scoped),
    groupMap(coalesce(sql`${listingAttributes.transmission}::text`, "transmission"), scoped),
    groupMap(coalesce(sql`${listingAttributes.propertyType}::text`, "property_type"), scoped),
    groupMap(coalesce(sql`${listingAttributes.finishingType}::text`, "finishing"), scoped),
    groupMap(sql`${listingAttributes.industrialType}::text`, scoped),
    groupMap(coalesce(sql`${listingAttributes.industry}::text`, "industry"), scoped),
    groupMap(coalesce(sql`${listingAttributes.originType}::text`, "origin_type"), scoped),
    countWhere(buildAttributeConditions({ payment_plan: "installment" })),
    countWhere(buildAttributeConditions({ payment_plan: "bank" })),
    countWhere(buildAttributeConditions({ payment_plan: "direct" })),
    countWhere(buildAttributeConditions({ payment_plan: "islamic" })),
    countWhere([sql`(${listingAttributes.specs}->>'compound')::boolean = true`]),
    countWhere([sql`(${listingAttributes.specs}->>'furnished')::boolean = true`]),
  ]);

  const payment_plan: Record<string, number> = {};
  if (installment) payment_plan.installment = installment;
  if (bank) payment_plan.bank = bank;
  if (direct) payment_plan.direct = direct;
  if (islamic) payment_plan.islamic = islamic;

  return {
    total,
    category: categoryMap,
    condition,
    fuel_type,
    transmission,
    payment_plan,
    property_type,
    finishing_type,
    industrial_type,
    industry,
    origin_type,
    compound,
    furnished,
    has_installment: installment,
  };
}

// Similar-listings is the slowest read path (range scan + enrichment fan-out).
// A circuit breaker with a short latency budget keeps it from hanging the
// request: on timeout/failure it serves a recently-cached result (or empty).
const similarBreaker = new CircuitBreaker({
  name: "similar-listings",
  timeoutMs: 800,
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

const SIMILAR_CACHE_TTL_MS = 5 * 60 * 1000;
const SIMILAR_CACHE_MAX = 2000;
const similarCache = new Map<string, { items: FeedItem[]; ts: number }>();

export async function getSimilarListings(listingId: string, limit: number = 10): Promise<FeedItem[]> {
  return similarBreaker.execute(
    async () => {
      const items = await computeSimilarListings(listingId, limit);
      if (similarCache.size >= SIMILAR_CACHE_MAX) {
        const oldest = similarCache.keys().next().value;
        if (oldest !== undefined) similarCache.delete(oldest);
      }
      similarCache.set(listingId, { items, ts: Date.now() });
      return items;
    },
    () => {
      const cached = similarCache.get(listingId);
      if (cached && Date.now() - cached.ts < SIMILAR_CACHE_TTL_MS) return cached.items;
      return [];
    },
  );
}

async function computeSimilarListings(listingId: string, limit: number): Promise<FeedItem[]> {
  const [target] = await db
    .select({ category: listings.category, price: listings.basePriceCash })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!target) return [];

  const price = Number(target.price);

  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      category: listings.category,
      base_price_cash: listings.basePriceCash,
      location: listings.location,
      status: listings.status,
      created_at: listings.createdAt,
      user_id: listings.userId,
      is_verified: users.isVerified,
      user_name: users.name,
      user_role: users.role,
      quality_score: users.qualityScore,
      industrial_type: listingAttributes.industrialType,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(
      and(
        eq(listings.status, "active"),
        eq(listings.category, target.category),
        gte(listings.basePriceCash, String(price * 0.8)),
        lte(listings.basePriceCash, String(price * 1.2)),
        sql`${listings.id} != ${listingId}`,
        ...publicVisibilityConditions()
      )
    )
    .limit(limit);

  const enriched = await enrichListings(rows);
  return transformFeedItems(enriched);
}

export async function getRecommendations(userId: string, limit: number = 20): Promise<FeedItem[]> {
  // Fallback to trending if no behavior data
  return getTrending(limit);
}

// Helper: enrich base rows with media, payment, interaction data
export async function enrichListings(
  rows: Array<{
    id: string;
    title: string;
    category: "car" | "real_estate" | "industrial";
    base_price_cash: string;
    location: string;
    status: string | null;
    created_at: Date | string | null;
    user_id: string | null;
    is_verified: boolean | null;
    user_name: string | null;
    user_role: string | null;
    quality_score?: number | null;
    views?: number | null;
    clicks?: number | null;
    industrial_type?: string | null;
    // Additive recency/engagement/kind passthrough → typed onto the enriched row
    // so computeScore (saves/bumped) and the BFF transform (is_request) can read
    // them, and feed/search cursors can key off the effective recency timestamp.
    bumped_at?: Date | string | null;
    saves_count?: number | null;
    is_request?: boolean | null;
  }>
) {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [mediaRows, paymentRows, interactionRows, geoRows, attrRows] = await Promise.all([
    db.select().from(listingMedia).where(inArray(listingMedia.listingId, ids)),
    db.select().from(paymentOptions).where(inArray(paymentOptions.listingId, ids)),
    db.select().from(interactions).where(inArray(interactions.listingId, ids)),
    db
      .select({
        id: listings.id,
        lat: listings.latitude,
        lng: listings.longitude,
        loc_lat: locations.latitude,
        loc_lng: locations.longitude,
      })
      .from(listings)
      .leftJoin(locations, eq(listings.locationId, locations.id))
      .where(inArray(listings.id, ids)),
    db
      .select({ listingId: listingAttributes.listingId, specs: listingAttributes.specs })
      .from(listingAttributes)
      .where(inArray(listingAttributes.listingId, ids)),
  ]);

  // Opt-in WhatsApp lives inside the per-listing specs JSON (default off).
  const whatsappByListing = new Map<string, boolean>();
  for (const a of attrRows) {
    const specs = (a.specs ?? {}) as Record<string, unknown>;
    whatsappByListing.set(a.listingId, specs.whatsapp_enabled === true);
  }

  const mediaByListing = new Map<string, typeof mediaRows>();
  const paymentByListing = new Map<string, typeof paymentRows>();
  const interactionByListing = new Map<string, typeof interactionRows[0]>();

  for (const m of mediaRows) {
    if (!mediaByListing.has(m.listingId)) mediaByListing.set(m.listingId, []);
    mediaByListing.get(m.listingId)!.push(m);
  }
  for (const p of paymentRows) {
    if (!paymentByListing.has(p.listingId)) paymentByListing.set(p.listingId, []);
    paymentByListing.get(p.listingId)!.push(p);
  }
  for (const i of interactionRows) {
    interactionByListing.set(i.listingId, i);
  }

  // Resolve display coordinates: listing-level override first, else the joined
  // area centroid. Drizzle returns numeric columns as strings.
  const coordsByListing = new Map<string, { lat: number; lng: number } | null>();
  for (const g of geoRows) {
    const lat = g.lat != null ? Number(g.lat) : g.loc_lat != null ? Number(g.loc_lat) : null;
    const lng = g.lng != null ? Number(g.lng) : g.loc_lng != null ? Number(g.loc_lng) : null;
    coordsByListing.set(
      g.id,
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null
    );
  }

  return rows.map((row) => {
    const media = mediaByListing.get(row.id) ?? [];
    const payments = paymentByListing.get(row.id) ?? [];
    const interaction = interactionByListing.get(row.id);

    // The feed renders thumbnail_url in an <Image> and a null thumbnail drops the
    // listing entirely, so the cover must be an IMAGE. Prefer the flagged
    // thumbnail, then fall back to the first image (never a leading video), and
    // only as a last resort the first media item.
    const thumbnail =
      media.find((m) => m.isThumbnail) ??
      media.find((m) => m.type === "image") ??
      media[0];
    const hasVideo = media.some((m) => m.type === "video");
    const offers = computeOffers(payments, row.base_price_cash);

    return {
      ...row,
      created_at: row.created_at ?? new Date(),
      views: interaction?.views ?? row.views ?? 0,
      clicks: interaction?.clicks ?? row.clicks ?? 0,
      thumbnail_url: thumbnail?.url ?? null,
      has_video: hasVideo,
      is_sponsored: false,
      payment: normalizePaymentOptions(payments),
      coordinates: coordsByListing.get(row.id) ?? null,
      best_offer_badge: offers.best_offer_badge,
      industrial_type: row.industrial_type ?? null,
      whatsapp_enabled: whatsappByListing.get(row.id) ?? false,
    };
  });
}
