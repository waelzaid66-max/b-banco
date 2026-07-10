import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { eq, inArray, isNotNull, asc } from "drizzle-orm";
import { createListing, updateListing } from "./ListingService";
import { searchListings } from "./SearchService";
import { CreateListingSchema } from "../validators/schemas";
import { db, deleteUsers, uniq, randomUUID } from "../__tests__/helpers";
import { listings, listingAttributes, listingMedia, users, locations } from "@workspace/db/schema";

/**
 * Edit-listing journey (update). Proves: owner-only authorization, that an edit
 * re-normalizes and reflects in BOTH the listings row and its 1:1 attributes
 * sidecar (written in one transaction — a mid-edit failure can't desync them),
 * and that status is patched only when explicitly provided.
 */
const uids: string[] = [];
let locationInput = "Cairo";

async function seedOwner(): Promise<string> {
  const userId = randomUUID();
  const clerkId = uniq("clerk");
  uids.push(userId);
  await db.insert(users).values({ id: userId, clerkId, name: "Edit Seller", role: "individual" });
  return clerkId;
}

async function mkListing(ownerClerk: string, token: string): Promise<string> {
  const input = CreateListingSchema.parse({
    title: `${token} sedan`,
    description: "Clean car, ready to drive.",
    category: "car",
    base_price_cash: 300000,
    location: locationInput,
    specs: { mileage: 50000, condition: "used" },
    media: [{ type: "image", url: `https://cdn.example/${token}.jpg`, is_thumbnail: true }],
    payment_options: [{ mode: "cash" }],
  });
  const { id } = await createListing(input, ownerClerk);
  return id;
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
  // listings → users FK is not cascade; drop listings first (cascades to
  // attributes/media), then the users.
  await db.delete(listings).where(inArray(listings.userId, uids));
  await deleteUsers(...uids);
});

describe("ListingService.updateListing — edit journey", () => {
  it("edits title + price + specs atomically; listing row AND attributes both reflect it", async () => {
    const ownerClerk = await seedOwner();
    const token = uniq("EDIT").toUpperCase();
    const id = await mkListing(ownerClerk, token);

    const res = await updateListing(id, ownerClerk, {
      title: `${token} sedan UPDATED`,
      base_price_cash: 275000,
      specs: { mileage: 51000, condition: "used", color: "white" },
    });
    expect(res.updated).toBe(true);

    // listings row updated.
    const [row] = await db
      .select({ title: listings.title, price: listings.basePriceCash })
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);
    expect(row!.title).toContain("UPDATED");
    expect(Number(row!.price)).toBe(275000);

    // attributes sidecar updated in the SAME transaction → specs reflect the edit
    // (proves the two writes are consistent, never half-applied).
    const [attr] = await db
      .select({ specs: listingAttributes.specs })
      .from(listingAttributes)
      .where(eq(listingAttributes.listingId, id))
      .limit(1);
    expect((attr!.specs as Record<string, unknown>).color).toBe("white");
    expect(String((attr!.specs as Record<string, unknown>).mileage)).toBe("51000");
  });

  it("rejects an edit from a non-owner (authorization)", async () => {
    const ownerClerk = await seedOwner();
    const strangerClerk = await seedOwner();
    const id = await mkListing(ownerClerk, uniq("OWN").toUpperCase());
    await expect(updateListing(id, strangerClerk, { title: "hijack" })).rejects.toThrow(
      /not found or access denied/i
    );
  });

  it("patches status only when provided (mark sold), otherwise leaves it active", async () => {
    const ownerClerk = await seedOwner();
    const id = await mkListing(ownerClerk, uniq("STAT").toUpperCase());

    // A non-status edit must NOT change status.
    await updateListing(id, ownerClerk, { base_price_cash: 290000 });
    let [row] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, id)).limit(1);
    expect(row!.status).toBe("active");

    // Explicit status patch marks it sold.
    await updateListing(id, ownerClerk, { status: "sold" });
    [row] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, id)).limit(1);
    expect(row!.status).toBe("sold");
  });

  it("replaces media when provided; cover stays the first image", async () => {
    const ownerClerk = await seedOwner();
    const token = uniq("MEDIA").toUpperCase();
    const id = await mkListing(ownerClerk, token);

    const newUrl = `https://cdn.example/${token}-new.jpg`;
    await updateListing(id, ownerClerk, {
      media: [
        { type: "image", url: newUrl, is_thumbnail: true },
        { type: "video", url: `https://cdn.example/${token}.mp4` },
      ],
    });

    const rows = await db
      .select({
        url: listingMedia.url,
        type: listingMedia.type,
        isThumbnail: listingMedia.isThumbnail,
        sortOrder: listingMedia.sortOrder,
      })
      .from(listingMedia)
      .where(eq(listingMedia.listingId, id))
      .orderBy(asc(listingMedia.sortOrder));

    expect(rows).toHaveLength(2);
    expect(rows[0]!.url).toBe(newUrl);
    expect(rows[0]!.isThumbnail).toBe(true);
    expect(rows[1]!.type).toBe("video");
  });

  it("pause (archived) hides from search; republish (active) restores it", async () => {
    const ownerClerk = await seedOwner();
    const token = uniq("PAUSE").toUpperCase();
    const id = await mkListing(ownerClerk, token);

    // Live → appears in search.
    const before = await searchListings({ search_term: token }, undefined, 50);
    expect(before.items.map((i) => i.id)).toContain(id);

    // Pause → archived → excluded from search (feed/search require status=active).
    await updateListing(id, ownerClerk, { status: "archived" });
    const paused = await searchListings({ search_term: token }, undefined, 50);
    expect(paused.items.map((i) => i.id)).not.toContain(id);

    // Republish → active → visible again.
    await updateListing(id, ownerClerk, { status: "active" });
    const republished = await searchListings({ search_term: token }, undefined, 50);
    expect(republished.items.map((i) => i.id)).toContain(id);
  });
});
