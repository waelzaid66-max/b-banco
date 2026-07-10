import { db } from "@workspace/db";
import { listings, listingAttributes, listingMedia, paymentOptions, interactions, users, locations, industrialTypeEnum } from "@workspace/db/schema";
import { and, or, eq, lte, gte, ilike, desc, asc, sql, count, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { normalizePaymentOptions, computeOffers } from "./PaymentService";
import { transformFeedItems } from "./BffService";
import { CircuitBreaker } from "../lib/circuitBreaker";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import type { FeedItem, FacetCounts } from "../validators/schemas";
import { allowCommodityMaterialFilter } from "./allowCommodityMaterialFilter";
import {
  pickListingThumbnailUrl,
  sortListingMedia,
} from "../lib/listingMediaPreview";

export { allowCommodityMaterialFilter } from "./allowCommodityMaterialFilter";

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
  // Real-estate offer type — "sale" (تمليك) vs "rent" (إيجار). Stored in specs.
  offer_type?: string;
  // Rental system for rent listings — the country's legal/duration regime
  // (EG: furnished_daily / new_law ≤5y / old_law ≤59y; Gulf: annual_contract).
  // Free string in specs, per the adaptive-data philosophy (catalog lives client-side).
  rental_term?: string;
  fuel_type?: string;
  transmission?: string;
  brand?: string;
  model?: string;
  min_year?: number;
  max_year?: number;
  industry?: string;
  origin_type?: string;
  // Commodity material slug (specs.material) — materials company only.
  material?: string;
  // Near-me / radius search. All three are required together; when present,
  // results are limited to listings whose EFFECTIVE coordinate (the listing's
  // own override, else its area centroid) lies within radius_km of the point.
  // Absent → behaviour is unchanged (no geo filter).
  near_lat?: number;
  near_lng?: number;
  radius_km?: number;
  // ISO market country (EG, SA, …) stored on specs.market_country. Missing / null
  // specs coalesce to EG so legacy inventory stays in the default market.
  market_country?: string;
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
  category?: "car" | "real_estate" | "industrial";
  industrial_type?: IndustrialSubtype[];
  condition?: string;
  payment_plan?: PaymentPlan;
  has_installment?: boolean;
  property_type?: string;
  finishing_type?: string;
  compound?: boolean;
  furnished?: boolean;
  offer_type?: string;
  rental_term?: string;
  fuel_type?: string;
  transmission?: string;
  brand?: string;
  model?: string;
  min_year?: number;
  max_year?: number;
  industry?: string;
  origin_type?: string;
  material?: string;
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
  // offer_type (sale/rent) lives only in specs JSON — the primary real-estate split.
  if (f.offer_type) {
    conditions.push(sql`${listingAttributes.specs}->>'offer_type' = ${f.offer_type}`);
  }
  // rental_term — the rental regime within offer_type=rent (specs-only, like offer_type).
  if (f.rental_term) {
    conditions.push(sql`${listingAttributes.specs}->>'rental_term' = ${f.rental_term}`);
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
  // Commodity material — specs-only; gated to materials inventory (not cars/RE/facilities).
  if (allowCommodityMaterialFilter(f)) {
    conditions.push(sql`${listingAttributes.specs}->>'material' = ${f.material!}`);
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

/**
 * Market-country filter shared by list search and map clusters. ADDITIVE —
 * when market_country is set, inventory must match specs.market_country
 * (legacy rows without the key count as EG).
 */
export function marketCountryConditions(parsed: {
  market_country?: string;
}): SQL[] {
  const iso = parsed.market_country?.trim().toUpperCase();
  if (!iso || !/^[A-Z]{2}$/.test(iso)) return [];
  return [
    sql`COALESCE(${listingAttributes.specs}->>'market_country', 'EG') = ${iso}`,
  ];
}

/**
 * Near-me / radius filter shared by list search and map clusters. ADDITIVE —
 * only when all three geo params are present. Effective coordinate = listing
 * override, else the joined area centroid.
 */
export function nearMeConditions(parsed: {
  near_lat?: number;
  near_lng?: number;
  radius_km?: number;
}): SQL[] {
  if (
    parsed.near_lat == null ||
    parsed.near_lng == null ||
    parsed.radius_km == null ||
    parsed.radius_km <= 0
  ) {
    return [];
  }
  const effLat = sql`COALESCE(${listings.latitude}, ${locations.latitude})`;
  const effLng = sql`COALESCE(${listings.longitude}, ${locations.longitude})`;
  const latDelta = parsed.radius_km / 111;
  const cosLat = Math.max(Math.cos((parsed.near_lat * Math.PI) / 180), 0.01);
  const lngDelta = parsed.radius_km / (111 * cosLat);
  const distanceKm = sql`6371 * acos(LEAST(1, GREATEST(-1,
    cos(radians(${parsed.near_lat})) * cos(radians(${effLat}))
      * cos(radians(${effLng}) - radians(${parsed.near_lng}))
    + sin(radians(${parsed.near_lat})) * sin(radians(${effLat}))
  )))`;
  return [
    sql`${effLat} IS NOT NULL AND ${effLng} IS NOT NULL`,
    sql`${effLat} BETWEEN ${parsed.near_lat - latDelta} AND ${parsed.near_lat + latDelta}`,
    sql`${effLng} BETWEEN ${parsed.near_lng - lngDelta} AND ${parsed.near_lng + lngDelta}`,
    sql`${distanceKm} <= ${parsed.radius_km}`,
  ];
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
    // Philosophy principle 10 — find a listing by ANY of its data: the title, the
    // description, OR any structured/custom spec VALUE (jsonb VALUES only, never the
    // keys, so a generic key name like "fuel_type" can't false-match everything).
    // This is what makes unlimited custom specs (Phase A) actually discoverable —
    // e.g. a laser cutter found by "Raycus" even when it's only in a custom spec.
    // ILIKE for now; a GIN/tsvector index is the planned scale-up for big catalogs.
    const term = `%${parsed.search_term}%`;
    conditions.push(
      or(
        ilike(listings.title, term),
        ilike(listings.description, term),
        sql`(jsonb_typeof(${listingAttributes.specs}) = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(${listingAttributes.specs}) AS kv WHERE kv.value ILIKE ${term}))`
      )!
    );
  }
  conditions.push(...marketCountryConditions(parsed));
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
  conditions.push(...nearMeConditions(parsed));

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

export interface MapBounds {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
}

export interface MapCluster {
  /** Cluster centroid (avg of member coordinates). */
  lat: number;
  lng: number;
  /** How many listings the cluster aggregates. */
  count: number;
  /** Present ONLY for a single-listing cluster (count === 1) → a tappable pin. */
  listing_id: string | null;
  /**
   * Single-pin only: furnished/daily real-estate rental (same rule as feed
   * `is_bookable`). Null for multi-listing cells.
   */
  is_bookable: boolean | null;
  /** Single-pin only: UI-ready price label. Null for multi-listing cells. */
  price_display: string | null;
}

/**
 * Server-side map clustering (#4, Addition A5). Aggregates the listings that
 * match the SAME filters as search — but within a viewport bounding box — into a
 * zoom-dependent grid, returning one row per occupied cell (centroid + count)
 * instead of every pin. This is what lets the map scale: the client fetches a
 * bounded number of clusters per pan/zoom rather than all matching coordinates.
 *
 * Reuses the exact visibility + filter conditions as `searchListings` (status,
 * category, request, price, location, free-text, abuse hiding, per-section
 * attribute filters) so the map and the list stay consistent. Effective
 * coordinate = listing override, else the area centroid (locations 1:1 join).
 * ADDITIVE: a brand-new function; `searchListings` is untouched.
 */
export async function mapClusters(
  parsed: ParsedSearchQuery,
  bounds: MapBounds,
  zoom: number
): Promise<MapCluster[]> {
  const conditions = [eq(listings.status, "active")];

  if (parsed.category) conditions.push(eq(listings.category, parsed.category));
  if (parsed.is_request !== undefined)
    conditions.push(eq(listings.isRequest, parsed.is_request));
  if (parsed.industrial_type && parsed.industrial_type.length > 0)
    conditions.push(inArray(listingAttributes.industrialType, parsed.industrial_type));
  if (parsed.max_price) conditions.push(lte(listings.basePriceCash, String(parsed.max_price)));
  if (parsed.min_price) conditions.push(gte(listings.basePriceCash, String(parsed.min_price)));
  if (parsed.location) conditions.push(ilike(listings.location, `%${parsed.location}%`));
  if (parsed.search_term) {
    const term = `%${parsed.search_term}%`;
    conditions.push(
      or(
        ilike(listings.title, term),
        ilike(listings.description, term),
        sql`(jsonb_typeof(${listingAttributes.specs}) = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(${listingAttributes.specs}) AS kv WHERE kv.value ILIKE ${term}))`
      )!
    );
  }
  conditions.push(...publicVisibilityConditions());
  conditions.push(...buildAttributeConditions(parsed));
  conditions.push(...marketCountryConditions(parsed));
  conditions.push(...nearMeConditions(parsed));

  // Effective coordinate (listing override → area centroid), as float for math.
  const effLat = sql`COALESCE(${listings.latitude}, ${locations.latitude})::float8`;
  const effLng = sql`COALESCE(${listings.longitude}, ${locations.longitude})::float8`;

  // Restrict to the viewport (and require a coordinate to exist).
  conditions.push(sql`${effLat} IS NOT NULL AND ${effLng} IS NOT NULL`);
  conditions.push(sql`${effLat} BETWEEN ${bounds.min_lat} AND ${bounds.max_lat}`);
  conditions.push(sql`${effLng} BETWEEN ${bounds.min_lng} AND ${bounds.max_lng}`);

  // Grid cell size in degrees from zoom: coarse cells when zoomed out (heavy
  // clustering), fine cells when zoomed in (down to individual pins). Clamped so
  // the exponent stays sane regardless of what the client sends.
  const z = Math.max(0, Math.min(20, Math.floor(zoom)));
  const cell = 360 / Math.pow(2, z + 2);
  const gy = sql`floor(${effLat} / ${cell})`;
  const gx = sql`floor(${effLng} / ${cell})`;

  const rows = await db
    .select({
      cnt: sql<number>`count(*)::int`,
      clat: sql<number>`avg(${effLat})::float8`,
      clng: sql<number>`avg(${effLng})::float8`,
      // min(uuid) has no aggregate in PG — compare as text. Only used when the
      // cluster holds exactly one listing (→ a tappable pin), so any single id is
      // correct; for multi-listing cells the value is ignored.
      sample: sql<string>`min(${listings.id}::text)`,
      // Single-cell enrichment (valid when count=1; ignored for multi).
      sample_category: sql<string>`min(${listings.category}::text)`,
      sample_rental_term: sql<string | null>`(array_agg(${listingAttributes.specs}->>'rental_term'))[1]`,
      sample_offer_type: sql<string | null>`(array_agg(${listingAttributes.specs}->>'offer_type'))[1]`,
      sample_price: sql<string>`min(${listings.basePriceCash}::text)`,
      sample_is_request: sql<boolean>`bool_or(${listings.isRequest})`,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .leftJoin(locations, eq(listings.locationId, locations.id))
    .where(and(...conditions))
    .groupBy(gy, gx)
    // Bound the payload — a sane viewport never needs more cells than this.
    .limit(2000);

  return rows.map((r) => {
    const count = Number(r.cnt);
    if (count !== 1) {
      return {
        lat: Number(r.clat),
        lng: Number(r.clng),
        count,
        listing_id: null,
        is_bookable: null,
        price_display: null,
      };
    }
    const rentalTerm = r.sample_rental_term ?? null;
    const offerType = r.sample_offer_type ?? null;
    const isBookable =
      r.sample_category === "real_estate" && rentalTerm === "furnished_daily";
    const priceDisplay = formatMapPinPrice({
      is_request: r.sample_is_request === true,
      base_price_cash: r.sample_price,
      offer_type: offerType,
      rental_term: rentalTerm,
    });
    return {
      lat: Number(r.clat),
      lng: Number(r.clng),
      count,
      listing_id: r.sample,
      is_bookable: isBookable,
      price_display: priceDisplay,
    };
  });
}

/** Same display rules as feed pins — kept local so map clusters stay self-contained. */
function formatMapPinPrice(row: {
  is_request: boolean;
  base_price_cash: string;
  offer_type: string | null;
  rental_term: string | null;
}): string {
  if (row.is_request) return "طلب سعر / Price requested";
  const n = Number(row.base_price_cash);
  let base: string;
  if (n >= 1_000_000) {
    base = `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")}M EGP`;
  } else if (n >= 1_000) {
    base = `${Math.round(n / 1_000).toLocaleString("en-EG")}K EGP`;
  } else {
    base = `${n.toLocaleString("en-EG")} EGP`;
  }
  if (row.offer_type !== "rent") return base;
  if (row.rental_term === "furnished_daily") return `${base} /يوم`;
  if (row.rental_term === "annual_contract") return `${base} /سنة`;
  return `${base} /شهر`;
}

export async function getAutocomplete(
  query: string,
  opts?: {
    category?: "car" | "real_estate" | "industrial";
    industrial_type?: string[];
  },
): Promise<string[]> {
  if (!query || query.length < 2) return [];

  const conditions = [
    eq(listings.status, "active"),
    ilike(listings.title, `%${query}%`),
    ...publicVisibilityConditions(),
  ];

  // Section isolation: never suggest villa titles while browsing cars, etc.
  if (opts?.category) {
    conditions.push(eq(listings.category, opts.category));
  }
  if (opts?.industrial_type?.length) {
    conditions.push(
      inArray(listingAttributes.industrialType, opts.industrial_type),
    );
  }

  const results = await db
    .selectDistinct({ title: listings.title })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(and(...conditions))
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
    offer_type,
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
    // offer_type (sale/rent) is specs-only — no dedicated column to COALESCE.
    groupMap(sql`${listingAttributes.specs}->>'offer_type'`, scoped),
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
    offer_type,
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
  // Rental context (offer_type + rental_term) — drives the honest price-period
  // suffix on rentals ("/شهر", "/يوم", "/سنة"). Same attrRows fetch: zero cost.
  const rentalByListing = new Map<
    string,
    { offer_type?: string; rental_term?: string }
  >();
  for (const a of attrRows) {
    const specs = (a.specs ?? {}) as Record<string, unknown>;
    whatsappByListing.set(a.listingId, specs.whatsapp_enabled === true);
    rentalByListing.set(a.listingId, {
      offer_type: typeof specs.offer_type === "string" ? specs.offer_type : undefined,
      rental_term: typeof specs.rental_term === "string" ? specs.rental_term : undefined,
    });
  }

  const mediaByListing = new Map<string, typeof mediaRows>();
  const paymentByListing = new Map<string, typeof paymentRows>();
  const interactionByListing = new Map<string, typeof interactionRows[0]>();

  for (const m of mediaRows) {
    if (!mediaByListing.has(m.listingId)) mediaByListing.set(m.listingId, []);
    mediaByListing.get(m.listingId)!.push(m);
  }
  for (const [listingId, items] of mediaByListing) {
    mediaByListing.set(listingId, sortListingMedia(items));
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

    const hasVideo = media.some((m) => m.type === "video");
    const offers = computeOffers(payments, row.base_price_cash);

    return {
      ...row,
      created_at: row.created_at ?? new Date(),
      views: interaction?.views ?? row.views ?? 0,
      clicks: interaction?.clicks ?? row.clicks ?? 0,
      thumbnail_url: pickListingThumbnailUrl(media),
      has_video: hasVideo,
      is_sponsored: false,
      payment: normalizePaymentOptions(payments),
      coordinates: coordsByListing.get(row.id) ?? null,
      best_offer_badge: offers.best_offer_badge,
      industrial_type: row.industrial_type ?? null,
      whatsapp_enabled: whatsappByListing.get(row.id) ?? false,
      offer_type: rentalByListing.get(row.id)?.offer_type ?? null,
      rental_term: rentalByListing.get(row.id)?.rental_term ?? null,
    };
  });
}
