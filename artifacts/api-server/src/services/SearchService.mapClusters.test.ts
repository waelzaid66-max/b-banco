import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { mapClusters, type ParsedSearchQuery } from "./SearchService";
import { db, createUser, deleteUsers, uniq, randomUUID } from "../__tests__/helpers";
import { listings, listingMedia } from "@workspace/db/schema";

/**
 * #4 / Addition A5 — server-side map clustering. Proven on a real DB:
 *   - zoom OUT → nearby listings collapse into few clusters (the whole point);
 *   - zoom IN  → each listing becomes its own pin (count 1 + listing_id set);
 *   - the viewport bbox is the gate (a listing outside it is excluded) and the
 *     total count is conserved (no listing lost or double-counted).
 * Rows are isolated from the shared DB by a unique title token (search_term).
 */
const uids: string[] = [];
const ids: string[] = [];

async function mkAt(sellerId: string, token: string, lat: number, lng: number): Promise<string> {
  const id = randomUUID();
  await db.insert(listings).values({
    id,
    userId: sellerId,
    title: `${token} car`,
    category: "car",
    status: "active",
    basePriceCash: "500000",
    location: "Cairo",
    latitude: String(lat),
    longitude: String(lng),
  });
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

describe("SearchService — server-side map clustering", () => {
  it("clusters when zoomed out, becomes individual pins when zoomed in, and the bbox gates membership", async () => {
    const seller = await createUser();
    uids.push(seller);
    const token = uniq("mapclus");

    // Three listings ~0.01° apart (area A) + one ~0.8° away (area B), all inside
    // the viewport; one far outside it.
    const a1 = await mkAt(seller, token, 30.0, 31.0);
    const a2 = await mkAt(seller, token, 30.01, 31.0);
    const a3 = await mkAt(seller, token, 30.02, 31.0);
    const b = await mkAt(seller, token, 30.8, 31.8);
    await mkAt(seller, token, 40.0, 41.0); // far — outside the viewport below

    const base: ParsedSearchQuery = { category: "car", search_term: token };
    const bbox = { min_lat: 29.5, max_lat: 31.0, min_lng: 30.5, max_lng: 32.0 };

    // Zoomed OUT: the four in-viewport listings collapse into far fewer clusters,
    // none of them centred on the far point, and every one is still counted.
    const coarse = await mapClusters(base, bbox, 1);
    const coarseTotal = coarse.reduce((s, c) => s + c.count, 0);
    expect(coarseTotal).toBe(4);
    expect(coarse.length).toBeLessThan(4);
    expect(coarse.every((c) => c.lat < 32)).toBe(true); // far one excluded by bbox

    // Zoomed IN: each listing is its own pin (count 1 + a tappable listing_id).
    const fine = await mapClusters(base, bbox, 18);
    expect(fine.reduce((s, c) => s + c.count, 0)).toBe(4);
    expect(fine.length).toBe(4);
    expect(fine.every((c) => c.count === 1)).toBe(true);
    expect(fine.every((c) => c.listing_id !== null)).toBe(true);
    expect(fine.map((c) => c.listing_id).sort()).toEqual([a1, a2, a3, b].sort());

    // Widening the viewport to include the far listing is the ONLY thing that
    // brings it in → the bbox is the gate (additive, nothing else changed).
    const wide = await mapClusters(base, { min_lat: 25, max_lat: 45, min_lng: 25, max_lng: 45 }, 1);
    expect(wide.reduce((s, c) => s + c.count, 0)).toBe(5);
  });
});
