/**
 * Market Insights — the Deal-Rating engine.
 *
 * Turns the append-only `price_observations` ledger (real listing prices over
 * time) into three read models:
 *   - price history  : monthly aggregates for a market segment
 *   - market insights: current count / average / median / range + short trend
 *   - deal rating    : where a given price sits in its segment's distribution
 *
 * Design guarantees (app philosophy):
 *   - Never fabricate. Every number is computed from real observations; a
 *     segment with fewer than MIN_SAMPLE real points returns "insufficient_data"
 *     instead of a made-up figure.
 *   - Never block trade. `recordPriceObservation` is best-effort and swallows
 *     its own errors — a publish/sale is never rolled back by analytics.
 *   - No schema churn to grow. `segmentKey` encodes category + location + a
 *     per-category discriminator, so new dimensions are code-only.
 */
import { db } from "@workspace/db";
import { priceObservations, listings, listingAttributes } from "@workspace/db/schema";
import { sql, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export type ListingCategory = "car" | "real_estate" | "industrial";

export type DealRating =
  | "great_deal"
  | "good_deal"
  | "fair"
  | "above_market"
  | "insufficient_data";

/** Minimum real samples in a segment before we quote statistics or a rating. */
export const MIN_SAMPLE = 5;
/** Trailing window (months) that defines "the current market". */
const WINDOW_MONTHS = 12;

type Specs = Record<string, unknown> | null | undefined;

/** Deterministic, unicode-safe token (lower-cased, spaces → dashes). */
function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** First non-empty spec value among the given keys. */
function pick(specs: Specs, keys: string[]): string {
  if (!specs) return "";
  for (const k of keys) {
    const val = (specs as Record<string, unknown>)[k];
    if (val != null && String(val).trim() !== "") return String(val);
  }
  return "";
}

/** Cars compare within a 3-year vintage band, e.g. 2018 → "2018-2020". */
function yearBucket(specs: Specs): string {
  const raw = pick(specs, ["year", "model_year", "manufacture_year"]);
  const y = parseInt(raw, 10);
  if (!Number.isFinite(y) || y < 1950 || y > 2100) return "";
  const start = y - (y % 3);
  return `${start}-${start + 2}`;
}

/**
 * The market bucket a listing belongs to. Same inputs → same key, so every
 * observation and query line up. Location is always part of the segment (real
 * estate especially is priced locally); a per-category discriminator refines it.
 */
export function buildSegmentKey(input: {
  category: ListingCategory;
  specs?: Specs;
  location?: string | null;
}): string {
  const loc = norm(input.location) || "any";
  const parts: string[] = [input.category, loc];
  if (input.category === "car") {
    parts.push(norm(pick(input.specs, ["brand", "make"])));
    parts.push(norm(pick(input.specs, ["model"])));
    parts.push(norm(yearBucket(input.specs)));
  } else if (input.category === "real_estate") {
    parts.push(norm(pick(input.specs, ["property_type", "propertyType"])));
  } else {
    parts.push(norm(pick(input.specs, ["industrial_type", "industrialType", "industry"])));
  }
  return parts.filter((p) => p !== "").join("|");
}

/** The salient specs kept on the observation for later analysis. */
function salientAttributes(category: ListingCategory, specs: Specs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keep =
    category === "car"
      ? ["brand", "make", "model", "year", "condition", "transmission", "fuel_type"]
      : category === "real_estate"
        ? ["property_type", "area", "rooms", "bedrooms", "finishing", "offer_type"]
        : ["industrial_type", "industry", "area", "power"];
  for (const k of keep) {
    const v = pick(specs, [k]);
    if (v !== "") out[k] = v;
  }
  return out;
}

/**
 * Record a real price point for a listing. Best-effort: any failure is logged
 * and swallowed so it can never affect the publish/sale that triggered it.
 * Idempotent per (listing, source) — re-publishing refreshes, never duplicates.
 */
export async function recordPriceObservation(input: {
  listingId: string;
  category: ListingCategory;
  priceCash: number | null | undefined;
  specs?: Specs;
  location?: string | null;
  source?: "listing_publish" | "listing_sold" | "backfill";
  observedAt?: Date;
}): Promise<void> {
  try {
    const price = Number(input.priceCash);
    // Requests / price-on-request carry no asking price → not a market signal.
    if (!Number.isFinite(price) || price <= 0) return;

    const segmentKey = buildSegmentKey(input);
    const source = input.source ?? "listing_publish";
    await db
      .insert(priceObservations)
      .values({
        listingId: input.listingId,
        category: input.category,
        segmentKey,
        locationKey: norm(input.location) || null,
        price: String(price),
        attributes: salientAttributes(input.category, input.specs),
        source,
        ...(input.observedAt ? { observedAt: input.observedAt } : {}),
      })
      .onConflictDoUpdate({
        target: [priceObservations.listingId, priceObservations.source],
        set: {
          price: String(price),
          segmentKey,
          category: input.category,
          locationKey: norm(input.location) || null,
          ...(input.observedAt ? { observedAt: input.observedAt } : {}),
        },
      });
  } catch (err) {
    logger.error({ err }, "recordPriceObservation failed (non-fatal, analytics only)");
  }
}

export interface MarketInsights {
  segment_key: string;
  sample_size: number;
  currency: string;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  // % change of the last 3-month average vs the prior 3 months (null if unknown).
  trend_pct: number | null;
  sufficient: boolean;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Current market snapshot for a segment (trailing WINDOW_MONTHS). */
export async function getMarketInsights(segmentKey: string): Promise<MarketInsights> {
  const rows = await db.execute(sql`
    SELECT
      count(*)::int AS n,
      avg(price)::float8 AS avg,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::float8 AS median,
      min(price)::float8 AS min,
      max(price)::float8 AS max,
      avg(price) FILTER (WHERE observed_at >= now() - interval '3 months')::float8 AS recent,
      avg(price) FILTER (WHERE observed_at <  now() - interval '3 months'
                           AND observed_at >= now() - interval '6 months')::float8 AS prior
    FROM price_observations
    WHERE segment_key = ${segmentKey}
      AND observed_at >= now() - (${WINDOW_MONTHS} || ' months')::interval
  `);
  const r = (rows.rows?.[0] ?? {}) as Record<string, unknown>;
  const n = num(r.n) ?? 0;
  const recent = num(r.recent);
  const prior = num(r.prior);
  const trend_pct =
    recent != null && prior != null && prior !== 0
      ? Math.round(((recent - prior) / prior) * 1000) / 10
      : null;
  return {
    segment_key: segmentKey,
    sample_size: n,
    currency: "EGP",
    average: n >= MIN_SAMPLE ? num(r.avg) : null,
    median: n >= MIN_SAMPLE ? num(r.median) : null,
    min: n >= MIN_SAMPLE ? num(r.min) : null,
    max: n >= MIN_SAMPLE ? num(r.max) : null,
    trend_pct: n >= MIN_SAMPLE ? trend_pct : null,
    sufficient: n >= MIN_SAMPLE,
  };
}

export interface PriceHistoryPoint {
  month: string; // YYYY-MM
  count: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

/** Monthly price aggregates for a segment over the trailing `months`. */
export async function getPriceHistory(
  segmentKey: string,
  months = WINDOW_MONTHS,
): Promise<PriceHistoryPoint[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', observed_at), 'YYYY-MM') AS month,
      count(*)::int AS n,
      avg(price)::float8 AS avg,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::float8 AS median,
      min(price)::float8 AS min,
      max(price)::float8 AS max
    FROM price_observations
    WHERE segment_key = ${segmentKey}
      AND observed_at >= now() - (${months} || ' months')::interval
    GROUP BY 1
    ORDER BY 1
  `);
  return (rows.rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      month: String(r.month),
      count: num(r.n) ?? 0,
      average: num(r.avg),
      median: num(r.median),
      min: num(r.min),
      max: num(r.max),
    };
  });
}

export interface DealVerdict {
  rating: DealRating;
  segment_key: string;
  sample_size: number;
  median: number | null;
  // How far the price sits below (−) or above (+) the segment median, in %.
  delta_pct: number | null;
}

/**
 * Rate a price against its segment's real distribution (trailing window).
 * Buckets by quartile — at or below p25 = great, ≤ median = good, ≤ p75 = fair,
 * else above market. Honest by design: below MIN_SAMPLE it declines to rate.
 */
export async function rateDeal(
  priceCash: number,
  segmentKey: string,
): Promise<DealVerdict> {
  const price = Number(priceCash);
  const rows = await db.execute(sql`
    SELECT
      count(*)::int AS n,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price)::float8 AS p25,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY price)::float8 AS p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price)::float8 AS p75
    FROM price_observations
    WHERE segment_key = ${segmentKey}
      AND observed_at >= now() - (${WINDOW_MONTHS} || ' months')::interval
  `);
  const r = (rows.rows?.[0] ?? {}) as Record<string, unknown>;
  const n = num(r.n) ?? 0;
  const p25 = num(r.p25);
  const p50 = num(r.p50);
  const p75 = num(r.p75);

  if (n < MIN_SAMPLE || p25 == null || p50 == null || p75 == null || !Number.isFinite(price)) {
    return { rating: "insufficient_data", segment_key: segmentKey, sample_size: n, median: n >= MIN_SAMPLE ? p50 : null, delta_pct: null };
  }

  let rating: DealRating;
  if (price <= p25) rating = "great_deal";
  else if (price <= p50) rating = "good_deal";
  else if (price <= p75) rating = "fair";
  else rating = "above_market";

  const delta_pct = p50 !== 0 ? Math.round(((price - p50) / p50) * 1000) / 10 : null;
  return { rating, segment_key: segmentKey, sample_size: n, median: p50, delta_pct };
}

export interface DealInsightsDTO {
  rating: DealRating;
  segment_key: string;
  sample_size: number;
  currency: string;
  median: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  delta_pct: number | null;
  trend_pct: number | null;
  history: PriceHistoryPoint[];
}

/**
 * The full deal‑insights view for one listing: its segment's statistics + this
 * listing's rating within it + a monthly history. Returns null if the listing
 * does not exist. Read‑only; safe for a public listing card / detail view.
 */
export async function getListingDealInsights(listingId: string): Promise<DealInsightsDTO | null> {
  const [row] = await db
    .select({
      category: listings.category,
      price: listings.basePriceCash,
      location: listings.location,
      isRequest: listings.isRequest,
      specs: listingAttributes.specs,
    })
    .from(listings)
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!row) return null;

  const category = row.category as ListingCategory;
  const segmentKey = buildSegmentKey({
    category,
    specs: (row.specs as Record<string, unknown>) ?? {},
    location: row.location,
  });

  const [insights, verdict, history] = await Promise.all([
    getMarketInsights(segmentKey),
    // Requests have no asking price → rating is naturally insufficient/neutral.
    rateDeal(Number(row.price), segmentKey),
    getPriceHistory(segmentKey),
  ]);

  return {
    rating: verdict.rating,
    segment_key: segmentKey,
    sample_size: insights.sample_size,
    currency: insights.currency,
    median: insights.median,
    average: insights.average,
    min: insights.min,
    max: insights.max,
    delta_pct: verdict.delta_pct,
    trend_pct: insights.trend_pct,
    history,
  };
}
