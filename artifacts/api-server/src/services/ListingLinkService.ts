import { db } from "@workspace/db";
import {
  listingLinks,
  listings,
  listingAttributes,
  listingMedia,
  users,
} from "@workspace/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import { pickListingThumbnailUrl, sortListingMedia } from "../lib/listingMediaPreview";
import type { LinkedListing } from "../validators/schemas";

type Relation = "feeds_into" | "part_of" | "compatible_with";

function formatEGP(value: string): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")}M EGP`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString("en-EG")}K EGP`;
  return `${n.toLocaleString("en-EG")} EGP`;
}

/**
 * Connect the path listing (the edge SOURCE) to another listing in the
 * supply-chain graph. Owner-guarded: the caller must own the source listing.
 * Self-links are rejected (also enforced by a DB CHECK) and duplicate edges are
 * idempotent (unique index → returns the existing edge with created=false).
 */
export async function createLink(
  fromListingId: string,
  relation: Relation,
  toListingId: string,
  clerkId: string
): Promise<{ id: string; created: boolean }> {
  if (fromListingId === toListingId) {
    throw Object.assign(new Error("A listing cannot link to itself"), {
      code: "INVALID_DATA",
    });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) {
    throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });
  }

  const [from] = await db
    .select({ id: listings.id, userId: listings.userId })
    .from(listings)
    .where(eq(listings.id, fromListingId))
    .limit(1);
  if (!from) {
    throw Object.assign(new Error("Source listing not found"), { code: "NOT_FOUND" });
  }
  if (from.userId !== user.id) {
    throw Object.assign(new Error("You do not own this listing"), { code: "FORBIDDEN" });
  }

  const [to] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.id, toListingId))
    .limit(1);
  if (!to) {
    throw Object.assign(new Error("Target listing not found"), { code: "NOT_FOUND" });
  }

  const inserted = await db
    .insert(listingLinks)
    .values({ fromListingId, toListingId, relation })
    .onConflictDoNothing()
    .returning({ id: listingLinks.id });

  if (inserted.length > 0) {
    return { id: inserted[0].id, created: true };
  }

  // Duplicate edge — return the existing one.
  const [existing] = await db
    .select({ id: listingLinks.id })
    .from(listingLinks)
    .where(
      and(
        eq(listingLinks.fromListingId, fromListingId),
        eq(listingLinks.toListingId, toListingId),
        eq(listingLinks.relation, relation)
      )
    )
    .limit(1);

  return { id: existing?.id ?? "", created: false };
}

/**
 * Bidirectional supply-chain neighbours of a listing. `direction` is RELATIVE
 * to the viewed listing: "outgoing" = it is the edge source, "incoming" = it is
 * the edge target. Only ACTIVE + publicly-visible neighbours are returned
 * (flagged listings / shadow-banned sellers are dropped via
 * publicVisibilityConditions()).
 */
export async function getLinksForListing(listingId: string): Promise<LinkedListing[]> {
  const linkRows = await db
    .select({
      fromListingId: listingLinks.fromListingId,
      toListingId: listingLinks.toListingId,
      relation: listingLinks.relation,
    })
    .from(listingLinks)
    .where(
      or(
        eq(listingLinks.fromListingId, listingId),
        eq(listingLinks.toListingId, listingId)
      )
    );

  if (linkRows.length === 0) return [];

  const neighborIds = Array.from(
    new Set(
      linkRows.map((l) => (l.fromListingId === listingId ? l.toListingId : l.fromListingId))
    )
  );

  const [neighborRows, mediaRows] = await Promise.all([
    db
      .select({
        id: listings.id,
        title: listings.title,
        base_price_cash: listings.basePriceCash,
        category: listings.category,
        industrial_type: listingAttributes.industrialType,
        supplier_id: users.id,
        supplier_name: users.name,
        supplier_is_verified: users.isVerified,
      })
      .from(listings)
      .leftJoin(users, eq(listings.userId, users.id))
      .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
      .where(
        and(
          inArray(listings.id, neighborIds),
          eq(listings.status, "active"),
          ...publicVisibilityConditions()
        )
      ),
    db
      .select({
        listingId: listingMedia.listingId,
        type: listingMedia.type,
        url: listingMedia.url,
        thumbnail_url: listingMedia.thumbnailUrl,
        isThumbnail: listingMedia.isThumbnail,
        sortOrder: listingMedia.sortOrder,
      })
      .from(listingMedia)
      .where(inArray(listingMedia.listingId, neighborIds)),
  ]);

  const mediaByListing = new Map<string, typeof mediaRows>();
  for (const m of mediaRows) {
    if (!mediaByListing.has(m.listingId)) mediaByListing.set(m.listingId, []);
    mediaByListing.get(m.listingId)!.push(m);
  }
  const thumbByListing = new Map<string, string>();
  for (const [id, items] of mediaByListing) {
    const url = pickListingThumbnailUrl(sortListingMedia(items));
    if (url) thumbByListing.set(id, url);
  }

  const neighborById = new Map<string, (typeof neighborRows)[number]>();
  for (const n of neighborRows) neighborById.set(n.id, n);

  const result: LinkedListing[] = [];
  for (const link of linkRows) {
    const neighborId = link.fromListingId === listingId ? link.toListingId : link.fromListingId;
    const direction: "incoming" | "outgoing" =
      link.fromListingId === listingId ? "outgoing" : "incoming";
    const n = neighborById.get(neighborId);
    if (!n) continue; // inactive / hidden neighbour — drop it.

    result.push({
      id: n.id,
      title: n.title,
      price_display: formatEGP(n.base_price_cash),
      thumbnail: thumbByListing.get(n.id) ?? null,
      category: n.category,
      industrial_type: n.industrial_type ?? null,
      relation: link.relation,
      direction,
      supplier: n.supplier_id
        ? {
            id: n.supplier_id,
            name: n.supplier_name ?? "Unknown",
            is_verified: !!n.supplier_is_verified,
          }
        : null,
    });
  }

  return result;
}
