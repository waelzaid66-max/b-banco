import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { createListing } from "./ListingService";
import { CreateListingSchema } from "../validators/schemas";
import { db, deleteUsers, uniq, randomUUID } from "../__tests__/helpers";
import { users, listings, locations } from "@workspace/db/schema";

/**
 * #4 — the create endpoint now accepts an optional precise pin (latitude/
 * longitude) so the seller's "use my location" overrides the area centroid for
 * near-me search. Verifies the coordinates are stored when supplied, and left
 * null (centroid fallback) when omitted. Drives the REAL CreateListingSchema +
 * createListing path. Buyer requests are used to relax the price/media floors.
 */
const uids: string[] = [];
let locationInput = "Cairo";

async function seedOwner(): Promise<string> {
  const userId = randomUUID();
  const clerkId = uniq("clerk");
  uids.push(userId);
  await db.insert(users).values({ id: userId, clerkId, name: "Coord Seller", role: "individual" });
  return clerkId;
}

beforeAll(async () => {
  const [loc] = await db
    .select({ area: locations.area, city: locations.city })
    .from(locations)
    .where(isNotNull(locations.area))
    .limit(1);
  locationInput = loc?.area ?? loc?.city ?? "Cairo";
});

afterAll(async () => {
  await db.delete(listings).where(inArray(listings.userId, uids));
  await deleteUsers(...uids);
});

describe("createListing — optional precise coordinates (#4)", () => {
  it("stores the seller's pin when latitude+longitude are supplied", async () => {
    const clerkId = await seedOwner();
    const body = CreateListingSchema.parse({
      title: `${uniq("PIN")} car wanted`,
      description: "looking for a clean car near me",
      category: "car",
      is_request: true,
      location: locationInput,
      specs: {},
      media: [],
      latitude: 30.05,
      longitude: 31.24,
    });
    const { id } = await createListing(body, clerkId);

    const [row] = await db.select().from(listings).where(eq(listings.id, id));
    expect(Number(row.latitude)).toBeCloseTo(30.05, 4);
    expect(Number(row.longitude)).toBeCloseTo(31.24, 4);
  });

  it("leaves coordinates null when no pin is supplied (area-centroid fallback)", async () => {
    const clerkId = await seedOwner();
    const body = CreateListingSchema.parse({
      title: `${uniq("NOPIN")} car wanted`,
      description: "looking for a clean car",
      category: "car",
      is_request: true,
      location: locationInput,
      specs: {},
      media: [],
    });
    const { id } = await createListing(body, clerkId);

    const [row] = await db.select().from(listings).where(eq(listings.id, id));
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
  });
});
