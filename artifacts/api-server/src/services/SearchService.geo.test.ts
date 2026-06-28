import { describe, it, expect, afterAll } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { searchListings } from "./SearchService";
import { db, createUser, deleteUsers, uniq, randomUUID } from "../__tests__/helpers";
import { listings, listingMedia, locations } from "@workspace/db/schema";

/**
 * #4 near-me / radius search. Proven against a real DB on seeded location
 * centroids: a point + radius returns listings whose EFFECTIVE coordinate (own
 * override OR area centroid) is inside the circle, and excludes far ones — while
 * omitting the geo params leaves results unfiltered (additive, non-breaking).
 */
const uids: string[] = [];
const ids: string[] = [];

async function mkListing(
  sellerId: string,
  token: string,
  suffix: string,
  coords: { lat: number | null; lng: number | null; locationId: string | null },
): Promise<string> {
  const id = randomUUID();
  await db.insert(listings).values({
    id,
    userId: sellerId,
    title: `${token} ${suffix}`,
    category: "car",
    status: "active",
    basePriceCash: "500000",
    location: "Cairo",
    locationId: coords.locationId,
    latitude: coords.lat != null ? String(coords.lat) : null,
    longitude: coords.lng != null ? String(coords.lng) : null,
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

describe("SearchService — near-me / radius filter", () => {
  it("returns listings inside the radius (own coords + centroid fallback), excludes far, and is additive", async () => {
    // A seeded area with a centroid is the search anchor.
    const [loc] = await db
      .select()
      .from(locations)
      .where(isNotNull(locations.latitude))
      .limit(1);
    expect(loc).toBeTruthy();
    const centerLat = Number(loc.latitude);
    const centerLng = Number(loc.longitude);

    const seller = await createUser();
    uids.push(seller);
    const token = uniq("geo");

    // Own coords exactly on the anchor → inside.
    const near = await mkListing(seller, token, "near", { lat: centerLat, lng: centerLng, locationId: null });
    // No own coords, but its area centroid IS the anchor → inside via fallback.
    const viaCentroid = await mkListing(seller, token, "centroid", { lat: null, lng: null, locationId: loc.id });
    // ~5° away (>500 km) → outside any sane city radius.
    const far = await mkListing(seller, token, "far", { lat: centerLat + 5, lng: centerLng + 5, locationId: null });

    const within = await searchListings(
      { search_term: token, near_lat: centerLat, near_lng: centerLng, radius_km: 50 },
      undefined,
      50,
    );
    const withinIds = within.items.map((i) => i.id);
    expect(withinIds).toContain(near);
    expect(withinIds).toContain(viaCentroid);
    expect(withinIds).not.toContain(far);

    // Additive: with NO geo params, all three (including far) are returned.
    const all = await searchListings({ search_term: token }, undefined, 50);
    const allIds = all.items.map((i) => i.id);
    expect(allIds).toContain(near);
    expect(allIds).toContain(viaCentroid);
    expect(allIds).toContain(far);
  });
});
