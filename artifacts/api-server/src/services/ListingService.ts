import { db } from "@workspace/db";
import {
  listings,
  listingAttributes,
  listingMedia,
  paymentOptions,
  users,
  interactions,
  locations,
} from "@workspace/db/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { normalizePaymentOptions, computeOffers } from "./PaymentService";
import { normalizeListing, detectDuplicate, computeTrustScore, validateMedia } from "./NormalizationService";
import { checkListingRate, auditListingFlag } from "./AbuseService";
import { notifyNewMatch, notifyPriceDrop } from "./AlertService";
import { recomputeDealerQuality } from "./QualityService";
import { trackCandidateAttributes } from "./CandidateAttributeService";
import { recordPriceObservation } from "./MarketInsightsService";
import { checkListingQuota, type UserRole } from "./PlanService";
import { getLinksForListing } from "./ListingLinkService";
import { mintContactToken } from "./LeadService";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import { getObjectStorageService } from "../lib/objectStorageProvider";
import { MEDIA_VERIFY_RETRYABLE } from "../lib/mediaVerify";
import type { CreateListingSchema } from "../validators/schemas";
import type { z } from "zod";

const objectStorageService = getObjectStorageService();

type CreateListingInput = z.infer<typeof import("../validators/schemas").CreateListingSchema>;

// Mirror of the mobile client cap (banco-mobile lib/listingMedia.ts
// MAX_VIDEO_MB). The presigned PUT can't enforce size and the client check can
// be bypassed, so this is the authoritative gate that keeps an oversized video
// from ever becoming public listing media.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

type StoredMediaMeta = { contentType: string | null; size: number | null };

/**
 * Reject media whose ACTUAL stored object is an oversized video before it can be
 * persisted/promoted to a public listing. The media kind is derived from the
 * STORED content type (`metaLookup`), never the client-declared `media.type`, so
 * a client can't smuggle an oversized video past the gate by labeling it an
 * image. `metaLookup` returns null for URLs that aren't ours (external hosts —
 * skipped); a THROWN lookup means a first-party object we couldn't verify, so we
 * fail closed (an unverifiable upload must never become public listing media).
 */
export async function assertVideosWithinSizeLimit(
  media: Array<{ url: string }>,
  metaLookup: (url: string) => Promise<StoredMediaMeta | null>,
  maxBytes: number = MAX_VIDEO_BYTES
): Promise<void> {
  const maxMb = Math.round(maxBytes / (1024 * 1024));
  await Promise.all(
    media.map(async (m) => {
      let meta: StoredMediaMeta | null;
      try {
        meta = await metaLookup(m.url);
      } catch (err) {
        // A transient storage read failure must not discard an otherwise-valid
        // listing — propagate it so the caller returns 503 and the client can
        // retry, rather than telling the seller their media is invalid.
        if ((err as { code?: string } | null)?.code === MEDIA_VERIFY_RETRYABLE) {
          throw err;
        }
        // First-party object that couldn't be verified (missing/unreadable) —
        // fail closed: an unverifiable upload must never become public media.
        throw Object.assign(
          new Error("Could not verify uploaded media. Please re-upload and try again."),
          { code: "INVALID_DATA" }
        );
      }
      if (!meta) return; // Not our upload URL (external host) — nothing to gate.
      const isVideo = (meta.contentType ?? "").toLowerCase().startsWith("video/");
      // Reject confirmed-oversize videos. A stored video whose size can't be
      // read is also rejected (fail closed) — size is always present for real
      // GCS objects, so a missing size means we can't prove it's within limit.
      if (isVideo && (meta.size == null || meta.size > maxBytes)) {
        throw Object.assign(
          new Error(`Video exceeds the maximum allowed size of ${maxMb} MB`),
          { code: "INVALID_DATA" }
        );
      }
    })
  );
}

// Authoritative server-side cap for stored IMAGE objects. The presigned PUT
// can't enforce size and the mobile client downscales but can be bypassed, so
// this is the gate that keeps an oversized image from becoming public media.
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Reject media whose ACTUAL stored object is an oversized image before it can be
 * persisted/promoted to public media. Mirrors assertVideosWithinSizeLimit: kind
 * is derived from the STORED content-type, never the client-declared type;
 * `metaLookup` returning null = external host (skipped); a THROWN lookup = a
 * first-party object we couldn't verify, so we fail closed.
 */
export async function assertImagesWithinSizeLimit(
  media: Array<{ url: string }>,
  metaLookup: (url: string) => Promise<StoredMediaMeta | null>,
  maxBytes: number = MAX_IMAGE_BYTES
): Promise<void> {
  const maxMb = Math.round(maxBytes / (1024 * 1024));
  await Promise.all(
    media.map(async (m) => {
      let meta: StoredMediaMeta | null;
      try {
        meta = await metaLookup(m.url);
      } catch (err) {
        // Transient storage read failure → propagate (caller maps to 503/retry).
        if ((err as { code?: string } | null)?.code === MEDIA_VERIFY_RETRYABLE) {
          throw err;
        }
        // Unverifiable first-party object (missing/unreadable) → fail closed.
        throw Object.assign(
          new Error("Could not verify uploaded media. Please re-upload and try again."),
          { code: "INVALID_DATA" }
        );
      }
      if (!meta) return;
      const isImage = (meta.contentType ?? "").toLowerCase().startsWith("image/");
      if (isImage && (meta.size == null || meta.size > maxBytes)) {
        throw Object.assign(
          new Error(`Image exceeds the maximum allowed size of ${maxMb} MB`),
          { code: "INVALID_DATA" }
        );
      }
    })
  );
}

/* ── Attribute Validation ──────────────────────────────── */

export function validateAttributes(
  category: "car" | "real_estate" | "industrial",
  specs: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const required: Record<string, string[]> = {
    car: ["mileage", "condition"],
    real_estate: ["area"],
    industrial: ["capacity"],
  };

  const requiredKeys = [...(required[category] ?? [])];
  // Real-estate: a room count is meaningful for built units but not for raw land
  // or bare commercial plots — require `rooms` for everything EXCEPT those, so a
  // land listing is never forced to invent one. Mirrors the mobile gate
  // (requiredSpecKeysFor / REAL_ESTATE_NO_ROOMS_TYPES).
  if (category === "real_estate") {
    const noRooms = ["land", "shop", "office", "clinic"];
    const pt = typeof specs.property_type === "string" ? specs.property_type : "";
    if (!noRooms.includes(pt)) requiredKeys.push("rooms");
  }
  for (const key of requiredKeys) {
    if (!(key in specs) || specs[key] === null || specs[key] === undefined || specs[key] === "") {
      errors.push(`Missing required attribute for ${category}: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ── Create Listing (transactional) ────────────────────── */

export async function createListing(
  input: {
    title: string;
    description?: string;
    category: "car" | "real_estate" | "industrial";
    // Optional only for request/wanted posts; the schema requires it otherwise.
    base_price_cash?: number;
    // Buyer "request/wanted" post (looking to buy). Relaxes the price requirement.
    is_request?: boolean;
    location: string;
    // Optional precise pin (overrides the area centroid for near-me + map).
    latitude?: number;
    longitude?: number;
    specs: Record<string, unknown>;
    media: Array<{ type: "image" | "video"; url: string; thumbnail_url?: string; is_thumbnail?: boolean }>;
    payment_options: Array<{
      mode: "cash" | "seller_installment" | "bank_finance";
      down_payment?: number;
      monthly_payment?: number;
      duration_months?: number;
      is_islamic_compliant?: boolean;
    }>;
    // Additive (Task #40): optional logistics & delivery, all nullable.
    logistics?: {
      delivery_time_days?: number | null;
      origin_type?: "local" | "imported" | null;
      country_of_origin?: string | null;
      shipping_method?: "container" | "bulk" | "air" | null;
    };
  },
  userId: string,
  meta?: { ip?: string }
): Promise<{ id: string }> {
  // Buyer "request/wanted" posts only say WHAT the buyer is looking for — they
  // carry no seller-side category specs (mileage/condition/area/rooms/capacity)
  // and photos are optional. The CreateListingSchema already relaxes price +
  // media for requests (superRefine); mirror that here so a valid request can't
  // be 400'd by the attribute/media floors meant for real sale listings. Sale
  // listings keep BOTH guards exactly as before.
  if (!input.is_request) {
    const validation = validateAttributes(input.category, input.specs);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.errors.join(", ")), { code: "INVALID_DATA" });
    }

    if (input.media.length === 0) {
      throw Object.assign(new Error("At least one media file is required"), { code: "INVALID_DATA" });
    }
  }

  // Server-side guard: an oversized video must never become public listing
  // media. Verifies the actual stored object metadata (type + size) before
  // persisting — never trusts the client-declared media type.
  await assertVideosWithinSizeLimit(input.media, (url) =>
    objectStorageService.getServingObjectMetadata(url)
  );
  await assertImagesWithinSizeLimit(input.media, (url) =>
    objectStorageService.getServingObjectMetadata(url)
  );

  // Ensure DB user exists
  const [user] = await db
    .select({ id: users.id, isVerified: users.isVerified, role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  if (!user) {
    throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });
  }

  // Per-user publish rate limit (revenue protection / spam control).
  const rate = await checkListingRate({ userId: user.id, ip: meta?.ip });
  if (!rate.ok) {
    throw Object.assign(new Error("Too many listings created. Please slow down and try again later."), {
      code: "RATE_LIMITED",
    });
  }

  // Normalize & validate: resolve taxonomy, standardize attributes, validate
  // media, detect duplicates and compute trust score before persisting.
  const normalized = await normalizeListing(
    {
      title: input.title,
      description: input.description,
      category: input.category,
      base_price_cash: input.base_price_cash ?? 0,
      location: input.location,
      specs: input.specs,
      media: input.media,
    },
    {
      sellerId: user.id,
      sellerVerified: !!user.isVerified,
      // Buyer requests may legitimately carry no photos; downgrade trust on
      // missing media instead of rejecting (sale listings still require media).
      requireMedia: !(input.is_request ?? false),
      // ALWAYS-PUBLISH (product decision): an unmatched controlled value
      // (location/brand/model/industrial_type that isn't in the taxonomy yet)
      // must NOT 400 the listing. lenient records a warning and leaves the value
      // unresolved, so the listing still publishes; the unresolved taxonomy then
      // lowers trustScore, which demotes it in ranking — i.e. "unclassified
      // enters at a lower rank" rather than being rejected. The minimal quality
      // floors above (validateAttributes required specs + media) still apply.
      lenient: true,
      // Interactive seller: a genuinely-new car brand is learned into the
      // catalogue (searchable/pickable for everyone) and the listing ranks
      // slightly lower. Bulk import does NOT auto-learn.
      autoLearn: true,
    }
  );

  const created = await db.transaction(async (tx) => {
    // Step 0: Enforce the user's plan listing limits (monthly quota + active
    // cap). Runs in-transaction so the counts are consistent with the insert.
    await checkListingQuota(tx, { userId: user.id, role: user.role as UserRole });

    // Step 1: Insert listing
    const [listing] = await tx
      .insert(listings)
      .values({
        userId: user.id,
        title: normalized.title,
        description: normalized.description,
        category: input.category,
        // Requests have no asking price; store a 0 placeholder and surface a
        // "price requested" label downstream (never shown as "0 EGP").
        basePriceCash: String(input.base_price_cash ?? 0),
        isRequest: input.is_request ?? false,
        location: normalized.locationCanonical ?? input.location,
        locationId: normalized.locationId,
        // Optional precise pin from the seller; both-or-neither so a lone axis
        // never yields a half-coordinate. Absent → near-me uses the area centroid.
        latitude:
          input.latitude != null && input.longitude != null ? String(input.latitude) : null,
        longitude:
          input.latitude != null && input.longitude != null ? String(input.longitude) : null,
        status: "active",
        trustScore: normalized.trustScore,
        isDuplicate: normalized.isDuplicate,
        duplicateOfId: normalized.duplicateOfId,
        isFlagged: normalized.isFlagged,
        flagReason: normalized.flagReason,
      })
      .returning({ id: listings.id });

    // Step 2: Insert attributes (specs + resolved taxonomy)
    await tx.insert(listingAttributes).values({
      listingId: listing.id,
      specs: normalized.specs,
      brandId: normalized.taxonomy.brandId,
      modelId: normalized.taxonomy.modelId,
      variantId: normalized.taxonomy.variantId,
      fuelType: normalized.taxonomy.fuelType,
      condition: normalized.taxonomy.condition,
      bodyType: normalized.taxonomy.bodyType,
      transmission: normalized.taxonomy.transmission,
      propertyType: normalized.taxonomy.propertyType,
      finishingType: normalized.taxonomy.finishingType,
      ownershipType: normalized.taxonomy.ownershipType,
      industrialType: normalized.taxonomy.industrialType,
      industry: normalized.taxonomy.industry,
      propertyTypeId: normalized.taxonomy.propertyTypeId,
      finishingTypeId: normalized.taxonomy.finishingTypeId,
      ownershipTypeId: normalized.taxonomy.ownershipTypeId,
      industrialTypeId: normalized.taxonomy.industrialTypeId,
      industryId: normalized.taxonomy.industryId,
      // Additive (Task #40): logistics & delivery (nullable, seller-provided).
      deliveryTimeDays: input.logistics?.delivery_time_days ?? null,
      originType: input.logistics?.origin_type ?? null,
      countryOfOrigin: input.logistics?.country_of_origin ?? null,
      shippingMethod: input.logistics?.shipping_method ?? null,
    } as typeof listingAttributes.$inferInsert);

    // Step 3: Insert media. Guard the empty case: a buyer request may carry no
    // photos (the schema only requires media for SALE listings), and Drizzle
    // throws on .values([]) — so a photo-less request must skip this insert
    // rather than crash the whole publish.
    if (input.media.length > 0) {
      const mediaValues = input.media.map((m, idx) => ({
        listingId: listing.id,
        type: m.type,
        url: m.url,
        thumbnailUrl: m.thumbnail_url ?? null,
        isThumbnail: m.is_thumbnail ?? idx === 0,
        sortOrder: idx,
      }));
      await tx.insert(listingMedia).values(mediaValues);
    }

    // Step 4: Insert payment options
    if (input.payment_options.length > 0) {
      await tx.insert(paymentOptions).values(
        input.payment_options.map((p) => ({
          listingId: listing.id,
          mode: p.mode,
          downPayment: p.down_payment ? String(p.down_payment) : null,
          monthlyPayment: p.monthly_payment ? String(p.monthly_payment) : null,
          durationMonths: p.duration_months ?? null,
          isIslamicCompliant: p.is_islamic_compliant ?? false,
        }))
      );
    }

    // Step 5: Init interactions counter
    await tx.insert(interactions).values({
      listingId: listing.id,
      views: 0,
      clicks: 0,
    });

    return { id: listing.id };
  });

  // Durable audit trail for any abuse-flagged/demoted listing.
  await auditListingFlag({
    listingId: created.id,
    sellerId: user.id,
    isFlagged: normalized.isFlagged,
    flagReason: normalized.flagReason,
    spamFlags: normalized.spamFlags,
    isPriceOutlier: normalized.isPriceOutlier,
    ip: meta?.ip,
  });

  // Market-insights signal: record this listing's price point (best-effort,
  // post-commit — never blocks or rolls back the publish). Skipped for requests
  // (no asking price) by recordPriceObservation itself.
  if (!(input.is_request ?? false)) {
    await recordPriceObservation({
      listingId: created.id,
      category: input.category,
      priceCash: input.base_price_cash,
      specs: normalized.specs,
      location: normalized.locationCanonical ?? input.location,
      source: "listing_publish",
    });
  }

  // Best-effort: promote all media objects to public ACL so they can be served
  // by the ACL-gated serve handler without authentication. Uses Promise.all
  // since promoteServingUrlToPublic already handles failures silently — a
  // failed promotion means the object won't be publicly accessible, but it
  // must not fail the listing creation that already committed.
  await Promise.all(
    input.media.map((m) =>
      objectStorageService.promoteServingUrlToPublic(m.url, userId)
    )
  );

  // Adaptive learning (best-effort, fire-and-forget): track free-form custom spec
  // keys so ones repeated across enough distinct sellers graduate into official
  // filters. Never blocks/affects the publish that already committed.
  void trackCandidateAttributes({ category: input.category, userId: user.id, specs: input.specs });

  // Listing quality contributes to the dealer quality score.
  recomputeDealerQuality(user.id);

  // Best-effort: alert owners of matching alerts-enabled saved searches.
  void notifyNewMatch({
    id: created.id,
    category: input.category,
    price: input.base_price_cash ?? 0,
    title: normalized.title,
    sellerId: user.id,
  });

  return created;
}

// Recycle/renew cooldown: an owner may bump a given listing at most once per
// window. bumped_at itself is the clock, so no extra tracking table is needed.
const BUMP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Recycle ("renew") a listing: lift it back to the top of recency-ordered feeds
 * and search by setting bumped_at = now. NEVER touches created_at, so the true
 * publish date — and the owner-facing "Listed on <date>" caption — is preserved.
 * Owner-scoped; only an active, non-flagged listing is eligible; per-listing
 * cooldown enforced. Honest by construction: it changes ORDER, not the post date.
 */
export async function bumpListing(
  clerkId: string,
  listingId: string
): Promise<{ id: string; bumped_at: string; next_bump_available_at: string }> {
  const [user] = await db
    .select({ id: users.id, isShadowBanned: users.isShadowBanned })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });

  const [listing] = await db
    .select({
      id: listings.id,
      userId: listings.userId,
      status: listings.status,
      isFlagged: listings.isFlagged,
      bumpedAt: listings.bumpedAt,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!listing) throw Object.assign(new Error("Listing not found"), { code: "NOT_FOUND" });
  if (listing.userId !== user.id)
    throw Object.assign(new Error("You do not own this listing"), { code: "FORBIDDEN" });

  // Recycle is a visibility action, so it must honor the FULL public-visibility
  // contract: only an active, non-flagged listing whose seller is NOT
  // shadow-banned can be lifted. Because bump is owner-scoped, the caller IS the
  // seller, so the caller's shadow-ban flag is the listing's seller flag. A
  // hidden listing reports NOT_FOUND — never a false "renewed" success — so a
  // shadow-banned seller can't probe or fake resurfacing.
  if (listing.status !== "active" || listing.isFlagged || user.isShadowBanned) {
    throw Object.assign(new Error("Listing is not eligible to recycle"), { code: "NOT_FOUND" });
  }

  // Cooldown is measured from the LAST recycle. A listing that has never been
  // recycled can be bumped immediately — that is the whole point (lifting an old
  // listing); a fresh one is already at the top so the bump is effectively a no-op.
  const now = Date.now();
  const last = listing.bumpedAt ? new Date(listing.bumpedAt).getTime() : null;
  if (last !== null && now - last < BUMP_COOLDOWN_MS) {
    throw Object.assign(
      new Error("This listing was recycled recently. Please try again later."),
      {
        code: "RATE_LIMITED",
        nextBumpAvailableAt: new Date(last + BUMP_COOLDOWN_MS).toISOString(),
      }
    );
  }

  const bumpedAt = new Date(now);
  await db.update(listings).set({ bumpedAt }).where(eq(listings.id, listingId));

  return {
    id: listingId,
    bumped_at: bumpedAt.toISOString(),
    next_bump_available_at: new Date(now + BUMP_COOLDOWN_MS).toISOString(),
  };
}

/* ── Get Listing Detail ────────────────────────────────── */

export async function getListingDetail(listingId: string, viewerClerkId?: string) {
  const [listing] = await db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      category: listings.category,
      base_price_cash: listings.basePriceCash,
      location: listings.location,
      status: listings.status,
      created_at: listings.createdAt,
      user_id: listings.userId,
      seller_clerk_id: users.clerkId,
      seller_name: users.name,
      seller_role: users.role,
      // seller_phone intentionally excluded — phone reveal is gated behind
      // POST /leads/contact so that every access is a server-observed contact event.
      is_verified: users.isVerified,
      views: interactions.views,
      clicks: interactions.clicks,
      latitude: listings.latitude,
      longitude: listings.longitude,
      loc_latitude: locations.latitude,
      loc_longitude: locations.longitude,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(interactions, eq(interactions.listingId, listings.id))
    .leftJoin(locations, eq(listings.locationId, locations.id))
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!listing) return null;

  // Non-active listings are only visible to their owner.
  // Public and authenticated non-owner callers receive a 404 to prevent
  // access to withdrawn inventory and seller contact details.
  if (listing.status !== "active" && viewerClerkId !== listing.seller_clerk_id) {
    return null;
  }

  const isOwner = viewerClerkId && viewerClerkId === listing.seller_clerk_id;

  const [mediaRows, paymentRows, attrRows, linkedListings, contactToken] = await Promise.all([
    db.select().from(listingMedia).where(eq(listingMedia.listingId, listingId)),
    db.select().from(paymentOptions).where(eq(paymentOptions.listingId, listingId)),
    db.select().from(listingAttributes).where(eq(listingAttributes.listingId, listingId)).limit(1),
    getLinksForListing(listingId),
    // Mint a single-use contact token for non-owner authenticated viewers.
    // The token must be presented to POST /leads/contact, ensuring every phone
    // reveal is preceded by a server-observed listing view.
    viewerClerkId && !isOwner
      ? mintContactToken(viewerClerkId, listingId)
      : Promise.resolve(null),
  ]);

  const payment = normalizePaymentOptions(paymentRows);
  // Additive (Task #32): rich financing offers + best offer, and display
  // coordinates (listing override → area centroid). numeric → string from PG.
  const offerResult = computeOffers(paymentRows, listing.base_price_cash);
  const detailLat =
    listing.latitude != null
      ? Number(listing.latitude)
      : listing.loc_latitude != null
        ? Number(listing.loc_latitude)
        : null;
  const detailLng =
    listing.longitude != null
      ? Number(listing.longitude)
      : listing.loc_longitude != null
        ? Number(listing.loc_longitude)
        : null;
  const coordinates =
    detailLat != null && detailLng != null && Number.isFinite(detailLat) && Number.isFinite(detailLng)
      ? { lat: detailLat, lng: detailLng }
      : null;
  const specs = attrRows[0]?.specs ?? {};

  // Additive (Task #40): logistics & delivery block. Emitted only when the
  // seller set at least one field; otherwise null. Never affects FeedItem.
  const attr = attrRows[0];
  const logistics =
    attr &&
    (attr.deliveryTimeDays != null ||
      attr.originType != null ||
      attr.countryOfOrigin != null ||
      attr.shippingMethod != null)
      ? {
          delivery_time_days: attr.deliveryTimeDays ?? null,
          origin_type: attr.originType ?? null,
          country_of_origin: attr.countryOfOrigin ?? null,
          shipping_method: attr.shippingMethod ?? null,
        }
      : null;

  function formatEGP(v: string) {
    const n = Number(v);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")}M EGP`;
    if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}K EGP`;
    return `${n.toLocaleString()} EGP`;
  }

  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    price_display: formatEGP(listing.base_price_cash),
    // Additive: the raw numeric cash price. For furnished/daily rentals it is the
    // per-night rate the booking widget multiplies by the night count for a
    // pre-booking estimate (the server stays authoritative on the real total).
    price_cash:
      typeof listing.base_price_cash === "number" ? listing.base_price_cash : null,
    location: listing.location,
    status: listing.status,
    created_at: listing.created_at?.toISOString() ?? new Date().toISOString(),
    media: mediaRows.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      thumbnail_url: m.thumbnailUrl,
      is_thumbnail: m.isThumbnail ?? false,
    })),
    specs: specs as Record<string, unknown>,
    payment,
    offers: offerResult.offers,
    best_offer: offerResult.best_offer,
    coordinates,
    seller: {
      id: listing.user_id ?? "",
      name: listing.seller_name ?? "Unknown",
      role: listing.seller_role ?? "individual",
      is_verified: listing.is_verified ?? false,
    },
    interactions: {
      views: listing.views ?? 0,
      clicks: listing.clicks ?? 0,
    },
    // Additive (Task #33): bidirectional supply-chain neighbours. Empty array
    // for non-industrial / unconnected listings.
    linked_listings: linkedListings,
    // Additive (Task #40): logistics & delivery; null when none provided.
    logistics,
    is_saved: false, // populated by controller
    // Single-use token for POST /leads/contact. Null for owners and guests.
    contact_token: contactToken,
    // Opt-in only — true only when the seller explicitly enabled WhatsApp.
    whatsapp_enabled: (specs as Record<string, unknown>).whatsapp_enabled === true,
  };
}

/* ── Public SEO Page Data ──────────────────────────────── */

// Mirror of BffService's request price label so the public web page, the feed,
// and the mobile preview all read identically for "wanted" listings.
const REQUEST_PRICE_DISPLAY = "طلب سعر / Price requested";

function formatSeoPriceEGP(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return REQUEST_PRICE_DISPLAY;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")}M EGP`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}K EGP`;
  return `${n.toLocaleString()} EGP`;
}

export type SeoListing = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  location: string | null;
  price_display: string;
  is_request: boolean;
  created_at: string;
  updated_at: string;
  /** Relative serving path of the best image (caller makes it absolute). */
  image_path: string | null;
};

/**
 * Fetch the minimal data needed to render a public, indexable listing page.
 * Applies the FULL public visibility contract (active + not flagged + seller not
 * shadow-banned) so hidden/abuse-controlled inventory can never be served to
 * crawlers or shared links. Returns null when the listing is missing or not
 * publicly visible — the caller turns that into a 404 + noindex.
 */
export async function getSeoListing(listingId: string): Promise<SeoListing | null> {
  const [row] = await db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      category: listings.category,
      location: listings.location,
      base_price_cash: listings.basePriceCash,
      is_request: listings.isRequest,
      created_at: listings.createdAt,
      bumped_at: listings.bumpedAt,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(
      and(
        eq(listings.id, listingId),
        eq(listings.status, "active"),
        ...publicVisibilityConditions(),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Prefer an explicit cover image, then any image, then a video's poster.
  const mediaRows = await db
    .select({
      type: listingMedia.type,
      url: listingMedia.url,
      thumbnail_url: listingMedia.thumbnailUrl,
      is_thumbnail: listingMedia.isThumbnail,
    })
    .from(listingMedia)
    .where(eq(listingMedia.listingId, listingId));

  const cover = mediaRows.find((m) => m.is_thumbnail && m.type === "image");
  const firstImage = mediaRows.find((m) => m.type === "image");
  const videoPoster = mediaRows.find((m) => m.type === "video" && m.thumbnail_url);
  const image_path =
    cover?.url ?? firstImage?.url ?? videoPoster?.thumbnail_url ?? null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    price_display: row.is_request
      ? REQUEST_PRICE_DISPLAY
      : formatSeoPriceEGP(row.base_price_cash),
    is_request: row.is_request,
    created_at: (row.created_at ?? new Date()).toISOString(),
    updated_at: (row.bumped_at ?? row.created_at ?? new Date()).toISOString(),
    image_path,
  };
}

/**
 * IDs + last-modified timestamps of every publicly visible listing, for the
 * sitemap. Recently-recycled listings report bumped_at as lastmod. Capped so the
 * sitemap stays within the 50k-URL limit; newest (by recency) first.
 */
export async function getSitemapListings(
  limit = 10000,
): Promise<Array<{ id: string; updated_at: string }>> {
  const rows = await db
    .select({
      id: listings.id,
      created_at: listings.createdAt,
      bumped_at: listings.bumpedAt,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(and(eq(listings.status, "active"), ...publicVisibilityConditions()))
    .orderBy(desc(sql`COALESCE(${listings.bumpedAt}, ${listings.createdAt})`))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    updated_at: (r.bumped_at ?? r.created_at ?? new Date()).toISOString(),
  }));
}

/* ── Dealer Listing Management ─────────────────────────── */

export async function getDealerListings(
  dbUserId: string,
  options: { cursor?: string; limit?: number; status?: string; sort?: string; order?: string }
) {
  const { cursor, limit = 20, status, sort = "created_at", order = "desc" } = options;

  const conditions = [eq(listings.userId, dbUserId)];
  if (status) conditions.push(eq(listings.status, status as "active" | "sold" | "archived"));
  if (cursor) conditions.push(sql`${listings.createdAt} < ${new Date(cursor)}`);

  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      category: listings.category,
      base_price_cash: listings.basePriceCash,
      location: listings.location,
      status: listings.status,
      created_at: listings.createdAt,
      views: interactions.views,
      clicks: interactions.clicks,
    })
    .from(listings)
    .leftJoin(interactions, eq(interactions.listingId, listings.id))
    .where(and(...conditions))
    .orderBy(order === "asc" ? sql`${listings.createdAt} ASC` : desc(listings.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasNext && page.length > 0 ? page[page.length - 1].created_at?.toISOString() : undefined;

  // Count leads per listing
  const { leadHistory } = await import("@workspace/db/schema");
  const leadCounts = await db
    .select({ listing_id: leadHistory.listingId, cnt: count() })
    .from(leadHistory)
    .where(eq(leadHistory.sellerId, dbUserId))
    .groupBy(leadHistory.listingId);

  const leadMap = new Map(leadCounts.map((l) => [l.listing_id, Number(l.cnt)]));

  function fmt(v: string) {
    const n = Number(v);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M EGP`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K EGP`;
    return `${n.toLocaleString()} EGP`;
  }

  return {
    items: page.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      price_display: fmt(r.base_price_cash),
      price_raw: r.base_price_cash,
      location: r.location,
      status: r.status,
      created_at: r.created_at?.toISOString(),
      views: r.views ?? 0,
      clicks: r.clicks ?? 0,
      leads: leadMap.get(r.id) ?? 0,
    })),
    cursor: nextCursor,
    has_next: hasNext,
  };
}

/**
 * Role-agnostic owner listing management. Resolves the DB owner from the
 * caller's Clerk id and delegates to getDealerListings, which is already
 * strictly owner-scoped. This lets individuals (who have no dealer endpoint)
 * see and manage their OWN catalogue with the same rich fields (status,
 * created_at, views, clicks, leads, price_display) — without the dealer-role
 * gate. Dealer-only analytics / leads / bulk routes stay dealer-gated.
 */
export async function getMyManagedListings(
  clerkId: string,
  options: { cursor?: string; limit?: number; status?: string; sort?: string; order?: string }
) {
  const { users } = await import("@workspace/db/schema");
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) return { items: [], cursor: undefined, has_next: false };
  return getDealerListings(user.id, options);
}

export async function bulkUpdateListingStatus(
  dbUserId: string,
  listingIds: string[],
  action: "activate" | "archive" | "delete"
) {
  const statusMap = { activate: "active", archive: "archived" } as const;

  if (action === "delete") {
    for (const id of listingIds) {
      await db
        .delete(listings)
        .where(and(eq(listings.id, id), eq(listings.userId, dbUserId)));
    }
  } else {
    const newStatus = statusMap[action];
    for (const id of listingIds) {
      await db
        .update(listings)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(and(eq(listings.id, id), eq(listings.userId, dbUserId)));
    }
  }
  return { updated: listingIds.length };
}

/* ── Public Listing Browse ─────────────────────────────── */

export async function getPublicListings(options: {
  cursor?: string;
  limit?: number;
  category?: "car" | "real_estate" | "industrial";
}) {
  const { enrichListings } = await import("./SearchService");
  const { transformFeedItems } = await import("./BffService");

  const { cursor, limit = 20, category } = options;

  const conditions: ReturnType<typeof eq>[] = [eq(listings.status, "active")];
  if (category) conditions.push(eq(listings.category, category));
  if (cursor) conditions.push(sql`${listings.createdAt} < ${new Date(cursor)}` as ReturnType<typeof eq>);
  // Hide abuse-controlled inventory (flagged listings + shadow-banned sellers).
  conditions.push(...(publicVisibilityConditions() as ReturnType<typeof eq>[]));

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
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(and(...(conditions as Parameters<typeof and>)))
    .orderBy(desc(listings.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor =
    hasNext && page.length > 0 ? page[page.length - 1].created_at?.toISOString() : undefined;

  const enriched = await enrichListings(page);
  const items = transformFeedItems(enriched);

  return { items, cursor: nextCursor, has_next: hasNext };
}

/* ── Update Listing ────────────────────────────────────── */

export async function updateListing(
  id: string,
  clerkUserId: string,
  updates: {
    title?: string;
    description?: string;
    base_price_cash?: number;
    location?: string;
    // Lifecycle status patch (Task #71): seller marks the deal closed/hidden.
    status?: "active" | "sold" | "archived";
    specs?: Record<string, unknown>;
    // Additive (Task #40): optional logistics & delivery patch, all nullable.
    logistics?: {
      delivery_time_days?: number | null;
      origin_type?: "local" | "imported" | null;
      country_of_origin?: string | null;
      shipping_method?: "container" | "bulk" | "air" | null;
    };
  }
): Promise<{ id: string; updated: boolean }> {
  const [user] = await db
    .select({ id: users.id, isVerified: users.isVerified })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);

  if (!user) throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });

  const [listing] = await db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      category: listings.category,
      basePriceCash: listings.basePriceCash,
      location: listings.location,
    })
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.userId, user.id)))
    .limit(1);

  if (!listing) throw Object.assign(new Error("Listing not found or access denied"), { code: "NOT_FOUND" });

  // Build the effective listing (existing merged with updates) and re-run the
  // normalization pipeline so taxonomy, trust score and duplicate flags stay
  // consistent after edits.
  const [existingAttr] = await db
    .select({ specs: listingAttributes.specs })
    .from(listingAttributes)
    .where(eq(listingAttributes.listingId, id))
    .limit(1);

  const mediaRows = await db
    .select({ type: listingMedia.type, url: listingMedia.url })
    .from(listingMedia)
    .where(eq(listingMedia.listingId, id));

  const mergedSpecs = {
    ...((existingAttr?.specs as Record<string, unknown>) ?? {}),
    ...(updates.specs ?? {}),
  };

  const normalized = await normalizeListing(
    {
      title: updates.title ?? listing.title,
      description: updates.description ?? listing.description ?? undefined,
      category: listing.category,
      base_price_cash: updates.base_price_cash ?? Number(listing.basePriceCash),
      location: updates.location ?? listing.location,
      specs: mergedSpecs,
      media: mediaRows.map((m) => ({ type: m.type, url: m.url })),
    },
    // Always-publish (see createListing): edits never 400 on an unmatched
    // controlled value — it warns + ranks lower instead of rejecting.
    { sellerId: user.id, sellerVerified: !!user.isVerified, excludeListingId: id, lenient: true, autoLearn: true }
  );

  // Additive (Task #40): only patch logistics when the caller provided it, so an
  // unrelated edit never wipes existing logistics back to null.
  const logisticsPatch =
    updates.logistics !== undefined
      ? {
          deliveryTimeDays: updates.logistics.delivery_time_days ?? null,
          originType: updates.logistics.origin_type ?? null,
          countryOfOrigin: updates.logistics.country_of_origin ?? null,
          shippingMethod: updates.logistics.shipping_method ?? null,
        }
      : {};

  // Atomic edit: the listings row and its 1:1 attributes sidecar are written in a
  // single transaction so a mid-edit failure can never leave them inconsistent
  // (e.g. a new title with stale specs/taxonomy). Mirrors createListing.
  await db.transaction(async (tx) => {
    await tx
      .update(listings)
      .set({
        title: normalized.title,
        description: normalized.description,
        basePriceCash: updates.base_price_cash !== undefined ? String(updates.base_price_cash) : listing.basePriceCash,
        location: normalized.locationCanonical ?? updates.location ?? listing.location,
        locationId: normalized.locationId,
        trustScore: normalized.trustScore,
        isDuplicate: normalized.isDuplicate,
        duplicateOfId: normalized.duplicateOfId,
        isFlagged: normalized.isFlagged,
        flagReason: normalized.flagReason,
        // Only patch status when the caller provided it (mark sold / archive).
        ...(updates.status ? { status: updates.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(listings.id, id));

    await tx
      .update(listingAttributes)
      .set({
        specs: normalized.specs,
        brandId: normalized.taxonomy.brandId,
        modelId: normalized.taxonomy.modelId,
        variantId: normalized.taxonomy.variantId,
        fuelType: normalized.taxonomy.fuelType,
        condition: normalized.taxonomy.condition,
        bodyType: normalized.taxonomy.bodyType,
        transmission: normalized.taxonomy.transmission,
        propertyType: normalized.taxonomy.propertyType,
        finishingType: normalized.taxonomy.finishingType,
        ownershipType: normalized.taxonomy.ownershipType,
        industrialType: normalized.taxonomy.industrialType,
        industry: normalized.taxonomy.industry,
        propertyTypeId: normalized.taxonomy.propertyTypeId,
        finishingTypeId: normalized.taxonomy.finishingTypeId,
        ownershipTypeId: normalized.taxonomy.ownershipTypeId,
        industrialTypeId: normalized.taxonomy.industrialTypeId,
        industryId: normalized.taxonomy.industryId,
        ...logisticsPatch,
      } as Partial<typeof listingAttributes.$inferInsert>)
      .where(eq(listingAttributes.listingId, id));
  });

  // Durable audit trail for any abuse-flagged/demoted listing on edit.
  await auditListingFlag({
    listingId: id,
    sellerId: user.id,
    isFlagged: normalized.isFlagged,
    flagReason: normalized.flagReason,
    spamFlags: normalized.spamFlags,
    isPriceOutlier: normalized.isPriceOutlier,
  });

  recomputeDealerQuality(user.id);

  // Best-effort: notify savers when the cash price actually dropped.
  if (updates.base_price_cash !== undefined && updates.base_price_cash < Number(listing.basePriceCash)) {
    void notifyPriceDrop({
      id,
      title: normalized.title,
      oldPrice: Number(listing.basePriceCash),
      newPrice: updates.base_price_cash,
      sellerId: user.id,
    });
  }

  // Market-insights signal: a confirmed sale is the strongest price point.
  // Best-effort and separate from the publish observation (its own source), so
  // a segment reflects both asking and realised prices. Never blocks the update.
  if (updates.status === "sold") {
    await recordPriceObservation({
      listingId: id,
      category: listing.category as "car" | "real_estate" | "industrial",
      priceCash: updates.base_price_cash ?? Number(listing.basePriceCash),
      specs: normalized.specs,
      location: normalized.locationCanonical ?? updates.location ?? listing.location,
      source: "listing_sold",
    });
  }

  return { id, updated: true };
}

/* ── Delete Listing ────────────────────────────────────── */

export async function deleteListing(
  id: string,
  clerkUserId: string
): Promise<{ id: string; deleted: boolean }> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);

  if (!user) throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });

  const [listing] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.userId, user.id)))
    .limit(1);

  if (!listing) throw Object.assign(new Error("Listing not found or access denied"), { code: "NOT_FOUND" });

  await db.delete(listings).where(eq(listings.id, id));

  return { id, deleted: true };
}
