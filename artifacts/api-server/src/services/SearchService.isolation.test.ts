import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { searchListings } from "./SearchService";
import { db, createUser, deleteUsers, uniq, randomUUID } from "../__tests__/helpers";
import { listings, listingMedia } from "@workspace/db/schema";

/**
 * #6 "each section is independent — no mixing of cars / real estate / industry,
 * and filters are real (not cosmetic)". Proven directly against the DB: a unique
 * title token scopes the assertions to this test's own rows (seed data shares no
 * token), so counts are deterministic.
 */
const uids: string[] = [];
const ids: string[] = [];

async function mkListing(sellerId: string, token: string, suffix: string, category: "car" | "real_estate" | "industrial", price: string): Promise<string> {
  const id = randomUUID();
  await db.insert(listings).values({
    id,
    userId: sellerId,
    title: `${token} ${suffix}`,
    category,
    status: "active",
    basePriceCash: price,
    location: "Cairo",
  });
  // Feed cards require an image (transformFeedItems drops media-less rows).
  await db.insert(listingMedia).values({
    id: randomUUID(),
    listingId: id,
    type: "image",
    url: `https://example.test/${id}.jpg`,
    thumbnailUrl: `https://example.test/${id}-thumb.jpg`,
    isThumbnail: true,
    sortOrder: 0,
  });
  ids.push(id);
  return id;
}

afterAll(async () => {
  for (const id of ids) await db.delete(listings).where(eq(listings.id, id));
  await deleteUsers(...uids);
});

describe("SearchService — section isolation + real filters", () => {
  it("never mixes categories, and price filters actually exclude", async () => {
    const seller = await createUser();
    uids.push(seller);
    const token = uniq("iso"); // unique marker → scopes to our rows only

    const carCheap = await mkListing(seller, token, "car-cheap", "car", "500000");
    const carPricey = await mkListing(seller, token, "car-pricey", "car", "9000000");
    const realEstate = await mkListing(seller, token, "apartment", "real_estate", "3000000");
    const industrial = await mkListing(seller, token, "machine", "industrial", "750000");

    // No category → every section's row that matches the token is returned (4).
    const all = await searchListings({ search_term: token }, undefined, 50);
    const allIds = all.items.map((i) => i.id);
    expect(allIds).toContain(carCheap);
    expect(allIds).toContain(realEstate);
    expect(allIds).toContain(industrial);

    // category=car → ONLY cars; never the real-estate or industrial row.
    const cars = await searchListings({ category: "car", search_term: token }, undefined, 50);
    const carIds = cars.items.map((i) => i.id);
    expect(carIds).toEqual(expect.arrayContaining([carCheap, carPricey]));
    expect(carIds).not.toContain(realEstate);
    expect(carIds).not.toContain(industrial);

    // category=real_estate → ONLY the apartment.
    const re = await searchListings({ category: "real_estate", search_term: token }, undefined, 50);
    const reIds = re.items.map((i) => i.id);
    expect(reIds).toContain(realEstate);
    expect(reIds).not.toContain(carCheap);
    expect(reIds).not.toContain(industrial);

    // Real price filter: max_price excludes the 9M car (not cosmetic).
    const cheapCars = await searchListings(
      { category: "car", search_term: token, max_price: 1_000_000 },
      undefined,
      50,
    );
    const cheapIds = cheapCars.items.map((i) => i.id);
    expect(cheapIds).toContain(carCheap);
    expect(cheapIds).not.toContain(carPricey);
  });
});
