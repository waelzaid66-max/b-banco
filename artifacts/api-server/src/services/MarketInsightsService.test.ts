import { describe, it, expect, afterAll } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";
import { db, createUser, deleteUsers, randomUUID } from "../__tests__/helpers";
import { priceObservations, listings, listingAttributes } from "@workspace/db/schema";
import {
  buildSegmentKey,
  getMarketInsights,
  getPriceHistory,
  rateDeal,
  getListingDealInsights,
  MIN_SAMPLE,
} from "./MarketInsightsService";

/**
 * The Deal-Rating engine on a real Postgres. Proves the segment key is
 * deterministic, that statistics only appear once there are enough REAL samples
 * (never fabricated), and that a price is bucketed correctly against its
 * segment's quartiles.
 */

// Unique per-run segment so parallel/other data never pollutes the assertions.
const SEG = `test-seg-${Date.now()}`;

async function seed(prices: number[], segment = SEG): Promise<void> {
  // Insert observations directly (listing_id NULL = pure fixtures, exempt from
  // the (listing,source) unique index, so many rows coexist).
  for (let i = 0; i < prices.length; i++) {
    await db.insert(priceObservations).values({
      listingId: null,
      category: "car",
      segmentKey: segment,
      locationKey: "test",
      price: String(prices[i]),
      // vary source so the NULL-listing unique index never trips
      source: `test-${i}`,
    });
  }
}

afterAll(async () => {
  await db.execute(sql`DELETE FROM price_observations WHERE segment_key LIKE 'test-seg-%'`);
});

describe("buildSegmentKey", () => {
  it("is deterministic and category-aware", () => {
    const a = buildSegmentKey({ category: "car", specs: { brand: "Toyota", model: "Corolla", year: 2019 }, location: "New Cairo" });
    const b = buildSegmentKey({ category: "car", specs: { brand: "Toyota", model: "Corolla", year: 2020 }, location: "New Cairo" });
    // 2019 and 2020 fall in the same 3-year vintage band → same segment.
    expect(a).toBe(b);
    expect(a).toContain("car");
    expect(a).toContain("toyota");

    const re = buildSegmentKey({ category: "real_estate", specs: { property_type: "apartment" }, location: "Fifth Settlement" });
    expect(re).toContain("real_estate");
    expect(re).toContain("apartment");
    // Different location → different segment.
    expect(buildSegmentKey({ category: "car", specs: { brand: "Toyota" }, location: "Giza" })).not.toBe(
      buildSegmentKey({ category: "car", specs: { brand: "Toyota" }, location: "Cairo" }),
    );
  });
});

describe("insufficient data is honest, never invented", () => {
  it("returns insufficient_data below MIN_SAMPLE", async () => {
    const seg = `${SEG}-thin`;
    await seed([100000, 200000, 300000], seg); // 3 < MIN_SAMPLE
    const insights = await getMarketInsights(seg);
    expect(insights.sample_size).toBe(3);
    expect(insights.sufficient).toBe(false);
    expect(insights.median).toBeNull();

    const verdict = await rateDeal(100000, seg);
    expect(verdict.rating).toBe("insufficient_data");
    expect(verdict.delta_pct).toBeNull();
  });
});

describe("market insights + deal rating on a real distribution", () => {
  // 9 points 100k..900k → median 500k, p25 300k, p75 700k.
  const prices = [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000];

  it("computes median/average once there are enough samples", async () => {
    expect(prices.length).toBeGreaterThanOrEqual(MIN_SAMPLE);
    await seed(prices);
    const insights = await getMarketInsights(SEG);
    expect(insights.sufficient).toBe(true);
    expect(insights.sample_size).toBe(prices.length);
    expect(insights.median).toBe(500000);
    expect(insights.min).toBe(100000);
    expect(insights.max).toBe(900000);
  });

  it("rates prices by quartile against the segment", async () => {
    expect((await rateDeal(150000, SEG)).rating).toBe("great_deal"); // ≤ p25
    expect((await rateDeal(450000, SEG)).rating).toBe("good_deal"); // ≤ median
    expect((await rateDeal(650000, SEG)).rating).toBe("fair"); // ≤ p75
    expect((await rateDeal(880000, SEG)).rating).toBe("above_market"); // > p75

    const good = await rateDeal(250000, SEG);
    expect(good.median).toBe(500000);
    // 250k is 50% below the 500k median.
    expect(good.delta_pct).toBe(-50);
  });

  it("returns monthly history points", async () => {
    const hist = await getPriceHistory(SEG, 12);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    const total = hist.reduce((s, p) => s + p.count, 0);
    expect(total).toBe(prices.length);
  });
});

describe("getListingDealInsights (endpoint service)", () => {
  const uids: string[] = [];
  const lids: string[] = [];

  afterAll(async () => {
    if (lids.length) await db.delete(listings).where(inArray(listings.id, lids));
    await deleteUsers(...uids);
    await db.execute(sql`DELETE FROM price_observations WHERE segment_key LIKE 'car|deal-insights-%'`);
  });

  it("combines rating + insights + history for a real listing; 404 semantics via null", async () => {
    const seller = await createUser({ role: "dealer" });
    uids.push(seller);
    const loc = `deal-insights-${Date.now()}`;
    const specs = { brand: "Toyota", model: "Corolla", year: 2020 };

    // A listing priced BELOW its segment → should rate a good/great deal.
    const listingId = randomUUID();
    lids.push(listingId);
    await db.insert(listings).values({
      id: listingId,
      userId: seller,
      title: "Corolla test",
      category: "car",
      basePriceCash: "200000",
      location: loc,
      status: "active",
    });
    await db.insert(listingAttributes).values({ listingId, specs });

    // Seed the segment with a known distribution (median 500k).
    const segmentKey = buildSegmentKey({ category: "car", specs, location: loc });
    for (let i = 1; i <= 9; i++) {
      await db.insert(priceObservations).values({
        listingId: null,
        category: "car",
        segmentKey,
        locationKey: loc,
        price: String(i * 100000),
        source: `seed-${i}`,
      });
    }

    const res = await getListingDealInsights(listingId);
    expect(res).not.toBeNull();
    expect(res!.segment_key).toBe(segmentKey);
    expect(res!.sample_size).toBe(9);
    expect(res!.median).toBe(500000);
    // 200k is well below the 500k median → a great deal.
    expect(res!.rating).toBe("great_deal");
    expect(res!.history.length).toBeGreaterThanOrEqual(1);

    // Unknown listing → null (controller maps this to 404).
    expect(await getListingDealInsights(randomUUID())).toBeNull();
  });
});
