import { z } from "zod";

/* ── Global Response Shape ─────────────────────────────── */

export const GlobalResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    error: z
      .object({
        code: z.enum(["INVALID_DATA", "NOT_FOUND", "UNAUTHORIZED", "INTERNAL_ERROR"]),
        message: z.string(),
      })
      .nullable(),
    meta: z.object({
      cursor: z.string().optional(),
      has_next: z.boolean().optional(),
      total: z.number().optional(),
    }),
  });

export type GlobalResponse<T> = {
  data: T;
  error: { code: string; message: string } | null;
  meta: { cursor?: string; has_next?: boolean; total?: number };
};

export function successResponse<T>(
  data: T,
  meta: { cursor?: string; has_next?: boolean; total?: number } = {}
): GlobalResponse<T> {
  return { data, error: null, meta };
}

export function errorResponse(
  code:
    | "INVALID_DATA"
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "INTERNAL_ERROR"
    | "FORBIDDEN"
    | "RATE_LIMITED"
    | "INVALID_TOKEN",
  message: string
): GlobalResponse<never[]> {
  return { data: [], error: { code, message }, meta: {} };
}

/**
 * Validate the response payload against a Zod schema before sending.
 * Throws a non-Zod Error on contract violation (→ caught as INTERNAL_ERROR).
 * Fails closed: never sends a broken payload silently.
 */
export function validateResponse<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown
): z.infer<S> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const msg = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw Object.assign(
      new Error(`Response contract violation: ${msg}`),
      { code: "RESPONSE_CONTRACT_VIOLATION" as const }
    );
  }
  return result.data;
}

/* ── Media Upload Contract ─────────────────────────────── */

export const UploadUrlResultSchema = z
  .object({
    upload_url: z.string(),
    object_path: z.string(),
    url: z.string(),
  })
  .strict();

export type UploadUrlResult = z.infer<typeof UploadUrlResultSchema>;

// Promote a previously-uploaded first-party object to a public ACL so it can be
// served without auth (profile covers, company logos, chat images). The body is
// just the serving URL returned by request-url.
export const PromoteUploadBodySchema = z
  .object({ url: z.string().url() })
  .strict();

export type PromoteUploadBody = z.infer<typeof PromoteUploadBodySchema>;

export const PromoteUploadResultSchema = z
  .object({ url: z.string(), promoted: z.boolean() })
  .strict();

export type PromoteUploadResult = z.infer<typeof PromoteUploadResultSchema>;

// Read-only pre-publish check: confirm a previously-uploaded first-party object
// actually landed in storage with an allowed kind (image|video) and within the
// size cap, using the AUTHORITATIVE stored metadata. The mobile client gates
// Publish on this so a transient storage blip surfaces as a retry (503) instead
// of a silently-broken or rejected listing.
export const VerifyUploadBodySchema = z
  .object({ url: z.string().url() })
  .strict();

export type VerifyUploadBody = z.infer<typeof VerifyUploadBodySchema>;

export const VerifyUploadResultSchema = z
  .object({
    url: z.string(),
    ok: z.boolean(),
    type: z.enum(["image", "video"]).nullable(),
    content_type: z.string().nullable(),
    size: z.number().nullable(),
  })
  .strict();

export type VerifyUploadResult = z.infer<typeof VerifyUploadResultSchema>;

/* ── User State (DB = source of truth) ─────────────────── */

export const UserStateSchema = z
  .object({
    id: z.string(),
    clerk_id: z.string(),
    // Internal default account number (e.g. "BNC-…"), auto-assigned per user.
    account_number: z.string().nullable(),
    role: z.enum(["individual", "dealer", "company", "enterprise"]),
    // Internal staff role (separate axis from `role`). "user" = no staff access.
    staff_role: z.enum(["owner", "admin", "moderator", "support", "user"]),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    is_verified: z.boolean(),
    is_admin: z.boolean(),
    wallet_balance: z.string(),
    created_at: z.string(),
  })
  .strict();

export type UserState = z.infer<typeof UserStateSchema>;

/* ── Shared display schemas (additive, Task #32) ───────── */

// A resolved map point. Listings without their own coordinates fall back to the
// area centroid; null when neither is known.
export const CoordinatesSchema = z
  .object({ lat: z.number(), lng: z.number() })
  .strict();

// A display-ready financing offer. NOTE: there is intentionally NO rate/APR
// field — Islamic offers must never carry or imply one. All money is
// pre-formatted server-side.
export const OfferSchema = z
  .object({
    id: z.string(),
    financing_type: z.enum(["islamic", "conventional"]),
    provider: z.enum(["seller", "bank", "dealer", "supplier"]),
    provider_badge: z.string(),
    monthly_display: z.string(),
    duration_months: z.number(),
    down_payment_display: z.string().nullable(),
    total_payable_display: z.string(),
    is_best: z.boolean(),
  })
  .strict();

export type Offer = z.infer<typeof OfferSchema>;

// A compact node in the industrial supply-chain graph (Task #33), surfaced on
// listing detail. `direction` is RELATIVE to the viewed listing: "outgoing" =
// the viewed listing is the edge source (e.g. a raw material that feeds_into
// this machine appears as "incoming"); "incoming" = it is the edge target.
// `relation` is the edge kind; `supplier` is the linked listing's owning company
// (deep-link target), null when unknown.
export const LinkedListingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    price_display: z.string(),
    thumbnail: z.string().nullable(),
    category: z.enum(["car", "real_estate", "industrial"]),
    industrial_type: z.string().nullable(),
    relation: z.enum(["feeds_into", "part_of", "compatible_with"]),
    direction: z.enum(["incoming", "outgoing"]),
    supplier: z
      .object({
        id: z.string(),
        name: z.string(),
        is_verified: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type LinkedListing = z.infer<typeof LinkedListingSchema>;

/* ── FeedItem Contract ─────────────────────────────────── */
// The original 11 core fields are immutable in v1 — never renamed, removed, or
// repurposed (breaking changes go to /v2/*). Task #32 permits ADDING new
// display-ready optional fields; the server always emits them, the contract
// marks them optional so existing clients are unaffected.

export const FeedItemSchema = z
  .object({
    id: z.string(),
    media_preview: z.string(),
    price_display: z.string(),
    installment_badge: z.string().nullable(),
    title: z.string(),
    location: z.string(),
    urgency_signal: z.string().nullable(),
    trust_signal: z.string(),
    smart_badge: z.string().nullable(),
    has_video: z.boolean(),
    is_sponsored: z.boolean(),
    // Additive (Task #32): map point + provider-tagged best-offer hook.
    coordinates: CoordinatesSchema.nullable(),
    best_offer_badge: z.string().nullable(),
    // Additive: industrial sub-type for client-side category grouping.
    industrial_type: z.string().nullable(),
    // Additive: the listing's main section — lets clients adapt per-section UI
    // (e.g. the save glyph) without re-deriving it from other fields.
    category: z.enum(["car", "real_estate", "industrial"]).nullable().optional(),
    // Additive: true when status === "active". Owner-facing FeedItem surfaces
    // (profile grid) use it to gate the Promote control without ListingDetail.
    is_active: z.boolean().nullable(),
    // Additive: seller opted this listing in to WhatsApp contact (opt-in only,
    // default false). Surfaces gate any WhatsApp action on it.
    whatsapp_enabled: z.boolean().nullable(),
    // Additive: listing creation timestamp (ISO 8601). Owner-facing grids
    // (profile, "my listings") render a "Listed <date>" caption. Null only if
    // the source row somehow lacks it; public feeds always carry it.
    created_at: z.string().nullable(),
    // Additive: buyer "request/wanted" post (looking to buy) rather than a sale
    // listing. Surfaces render a "طلب / Wanted" badge and the requests filter
    // keys off it. Null only when the source row lacks the flag.
    is_request: z.boolean().nullable(),
    // Additive: furnished/daily rental that can be reserved (hotel model) →
    // drives the "قابل للحجز / Bookable" badge on cards + map pins.
    is_bookable: z.boolean().nullable().optional(),
  })
  .strict();

export type FeedItem = z.infer<typeof FeedItemSchema>;

/* ── ListingDetail Contract ────────────────────────────── */

// Additive (Task #40): optional logistics & delivery block on a listing. All
// fields nullable/seller-provided. The whole block is null when the seller set
// no logistics. Never affects the FeedItem contract — detail-only.
export const LogisticsSchema = z
  .object({
    delivery_time_days: z.number().int().nullable(),
    origin_type: z.enum(["local", "imported"]).nullable(),
    country_of_origin: z.string().nullable(),
    shipping_method: z.enum(["container", "bulk", "air"]).nullable(),
  })
  .strict();

export type Logistics = z.infer<typeof LogisticsSchema>;

// Write shape for logistics on listing create/update — all optional/nullable so
// it is purely additive to the listing payload.
export const LogisticsInputSchema = z
  .object({
    delivery_time_days: z.number().int().min(0).max(3650).nullable().optional(),
    origin_type: z.enum(["local", "imported"]).nullable().optional(),
    country_of_origin: z.string().trim().max(80).nullable().optional(),
    shipping_method: z.enum(["container", "bulk", "air"]).nullable().optional(),
  })
  .strict();

export const ListingDetailSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    category: z.enum(["car", "real_estate", "industrial"]),
    price_display: z.string(),
    // Additive: raw numeric cash price (per-night rate for furnished/daily rent).
    price_cash: z.number().nullable().optional(),
    location: z.string(),
    status: z.enum(["active", "sold", "archived"]),
    created_at: z.string(),
    media: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(["image", "video"]),
          url: z.string(),
          thumbnail_url: z.string().nullable(),
          is_thumbnail: z.boolean(),
        })
        .strict()
    ),
    specs: z.record(z.unknown()),
    payment: z
      .object({
        has_installment: z.boolean(),
        options: z.array(
          z
            .object({
              mode: z.string(),
              down_payment: z.string().nullable(),
              monthly_payment: z.string().nullable(),
              duration_months: z.number().nullable(),
              is_islamic_compliant: z.boolean(),
            })
            .strict()
        ),
        lowest_monthly: z.string().nullable(),
        lowest_down_payment: z.string().nullable(),
        badge: z.string().nullable(),
      })
      .strict(),
    seller: z
      .object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        is_verified: z.boolean(),
        // phone intentionally omitted — only obtainable via POST /leads/contact
        // to ensure every phone reveal is a server-observed billable contact event.
      })
      .strict(),
    interactions: z
      .object({
        views: z.number(),
        clicks: z.number(),
      })
      .strict(),
    is_saved: z.boolean(),
    // Additive (Task #32): display coordinates + rich financing offers. The
    // existing `payment` block above is left byte-identical for back-compat.
    coordinates: CoordinatesSchema.nullable(),
    offers: z.array(OfferSchema),
    best_offer: OfferSchema.nullable(),
    // Additive (Task #33): bidirectional supply-chain graph neighbours. Always
    // emitted (possibly empty); contract marks it optional in OpenAPI.
    linked_listings: z.array(LinkedListingSchema),
    // Additive (Task #40): logistics & delivery. Null when none provided;
    // contract marks it optional in OpenAPI.
    logistics: LogisticsSchema.nullable(),
    // Single-use token minted server-side for authenticated non-owner viewers.
    // Required by POST /leads/contact to prevent forged leads.
    // Null for owners and unauthenticated viewers.
    contact_token: z.string().nullable(),
    // Additive: seller opted this listing in to WhatsApp contact (opt-in only,
    // default false). The detail CTA gates the WhatsApp button on it.
    whatsapp_enabled: z.boolean().nullable(),
  })
  .strict();

export type ListingDetail = z.infer<typeof ListingDetailSchema>;

/* ── Dealer Response Schemas ───────────────────────────── */

export const DealerStatsSchema = z
  .object({
    active_listings: z.number(),
    total_listings: z.number(),
    leads_today: z.number(),
    conversion_rate: z.string(),
    total_views: z.number(),
    leads_chart: z.array(
      z.object({ date: z.string(), leads: z.number() }).strict()
    ),
  })
  .strict();

export const DealerListingItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.enum(["car", "real_estate", "industrial"]),
    price_display: z.string(),
    price_raw: z.string(),
    location: z.string(),
    status: z.enum(["active", "sold", "archived"]).nullable(),
    created_at: z.string().nullable().optional(),
    views: z.number(),
    clicks: z.number(),
    leads: z.number(),
  })
  .strict();

export const DealerLeadItemSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    listing_title: z.string(),
    action_type: z.enum(["whatsapp", "call", "chat", "finance_request"]),
    status: z.enum(["new", "contacted", "closed"]),
    buyer_name: z.string().nullable(),
    buyer_phone: z.string().nullable(),
    created_at: z.string().nullable().optional(),
  })
  .strict();

export const AdBoostResultSchema = z
  .object({
    ad_id: z.string(),
    listing_id: z.string(),
    ad_type: z.enum(["featured", "native_feed", "top_search"]),
    expires_at: z.string(),
    duration_days: z.number(),
    promo_used: z.string(),
    wallet_charged: z.string(),
  })
  .strict();

export const BulkActionResultSchema = z
  .object({
    updated: z.number(),
  })
  .strict();

export const ImportResultSchema = z
  .object({
    success_count: z.number(),
    failed_count: z.number(),
    errors: z.array(
      z.object({
        batch_index: z.number(),
        rows_in_batch: z.number(),
        message: z.string(),
      }).strict()
    ),
  })
  .strict();

/* ── Save/Lead Response Schemas ────────────────────────── */

export const SaveToggleResultSchema = z
  .object({ saved: z.boolean() })
  .strict();

export const TrackLeadResultSchema = z
  .object({ tracked: z.boolean() })
  .strict();

export const BehaviorSignalResultSchema = z
  .object({ received: z.boolean() })
  .strict();

export const UpdateLeadResultSchema = z
  .object({ updated: z.boolean() })
  .strict();

export const CreateListingResultSchema = z
  .object({ id: z.string() })
  .strict();

export const DeleteAccountResultSchema = z
  .object({ deleted: z.boolean() })
  .strict();

/* ── Messaging Response Schemas ────────────────────────── */

export const ConversationSummarySchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    listing_title: z.string().nullable(),
    listing_thumb: z.string().nullable(),
    counterparty_id: z.string(),
    counterparty_name: z.string(),
    last_message_text: z.string().nullable(),
    last_message_at: z.string().nullable(),
    unread: z.number(),
    viewer_role: z.enum(["buyer", "seller"]),
  })
  .strict();

export const MessageReplyPreviewSchema = z
  .object({
    id: z.string(),
    body: z.string(),
    sender_id: z.string(),
  })
  .strict();

export const MessageListingRefSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    thumb: z.string().nullable(),
    price: z.string().nullable(),
  })
  .strict();

export const MessageItemSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string(),
    sender_id: z.string(),
    body: z.string(),
    is_mine: z.boolean(),
    created_at: z.string(),
    read_at: z.string().nullable().optional(),
    media_url: z.string().nullable().optional(),
    // Social-chat fields (additive; older clients ignore unknown keys).
    media_kind: z.string().nullable().optional(),
    reactions: z.record(z.string(), z.number()).optional().default({}),
    my_reactions: z.array(z.string()).optional().default([]),
    reply_to: MessageReplyPreviewSchema.nullable().optional(),
    listing_ref: MessageListingRefSchema.nullable().optional(),
  })
  .strict();

export const MarkReadResultSchema = z.object({ read: z.boolean() }).strict();

// Body for toggling a reaction; result echoes the updated counts + viewer's set.
export const ReactToMessageSchema = z
  .object({ emoji: z.string().min(1).max(8) })
  .strict();

export const ReactionResultSchema = z
  .object({
    reactions: z.record(z.string(), z.number()),
    my_reactions: z.array(z.string()),
  })
  .strict();

export const DeleteConversationResultSchema = z
  .object({ deleted: z.boolean() })
  .strict();

/* ── Notification Response Schemas ─────────────────────── */

export const NotificationTypeEnum = z.enum([
  "message",
  "lead",
  "system",
  "rfq",
  "new_match",
  "price_drop",
  "comment",
  "review",
  "investment",
  "global_supply",
]);

export const NotificationItemSchema = z
  .object({
    id: z.string(),
    type: NotificationTypeEnum,
    title: z.string(),
    body: z.string(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    read_at: z.string().nullable().optional(),
    created_at: z.string(),
  })
  .strict();

/* ── Identity: metrics / social links / prefs / saved searches (Task #38) ─ */

// Real seller metrics for my own profile. Mirrors CompanyStats in the contract;
// every value is computed from the DB — never faked.
export const MyMetricsSchema = z
  .object({
    active_listings: z.number(),
    total_listings: z.number(),
    member_since: z.string(),
    years_active: z.number(),
    response_rate: z.number().nullable(),
  })
  .strict();

export const SocialPlatformEnum = z.enum([
  "instagram",
  "linkedin",
  "website",
  "whatsapp",
]);

export const SocialLinkSchema = z
  .object({
    platform: SocialPlatformEnum,
    value: z.string().trim().min(1).max(300),
  })
  .strict();

export const SetSocialLinksSchema = z
  .object({ links: z.array(SocialLinkSchema).max(10) })
  .strict();

export const NotificationPreferenceSchema = z
  .object({
    type: NotificationTypeEnum,
    in_app: z.boolean(),
    email: z.boolean(),
  })
  .strict();

export const SetNotificationPreferencesSchema = z
  .object({ preferences: z.array(NotificationPreferenceSchema).max(20) })
  .strict();

export const SavedSearchSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    query: z.string().nullable().optional(),
    category: z.enum(["car", "real_estate", "industrial"]).nullable().optional(),
    filters: z.record(z.string(), z.unknown()).nullable().optional(),
    price_min: z.string().nullable().optional(),
    price_max: z.string().nullable().optional(),
    alerts_enabled: z.boolean(),
    created_at: z.string(),
  })
  .strict();

export const CreateSavedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    query: z.string().trim().max(200).nullable().optional(),
    category: z.enum(["car", "real_estate", "industrial"]).nullable().optional(),
    filters: z.record(z.string(), z.unknown()).nullable().optional(),
    price_min: z.string().trim().max(30).nullable().optional(),
    price_max: z.string().trim().max(30).nullable().optional(),
    alerts_enabled: z.boolean().optional(),
  })
  .strict();

export const UpdateSavedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    price_min: z.string().trim().max(30).nullable().optional(),
    price_max: z.string().trim().max(30).nullable().optional(),
    alerts_enabled: z.boolean().optional(),
  })
  .strict();

export const DeleteSavedSearchResultSchema = z
  .object({ deleted: z.boolean() })
  .strict();

/* ── Request Input Schemas ─────────────────────────────── */

export const CreateConversationSchema = z
  .object({ listing_id: z.string().uuid() })
  .strict();

export const SendMessageSchema = z
  .object({
    body: z.string().trim().max(4000).optional().default(""),
    // Optional single attachment (Task #71). When present, body may be empty.
    media_url: z.string().url().max(2000).nullable().optional(),
    // Attachment kind for the renderer: image | video | audio (voice note).
    media_kind: z.enum(["image", "video", "audio"]).nullable().optional(),
    // Reply/quote target (must be a message in the same conversation).
    reply_to_id: z.string().uuid().nullable().optional(),
    // A listing shared as a card inside the chat.
    listing_ref_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((d) => (d.body && d.body.length > 0) || !!d.media_url || !!d.listing_ref_id, {
    message: "Message must contain text, media, or a shared listing",
  });

export const MarkNotificationsReadSchema = z
  .object({ id: z.string().uuid().optional() })
  .strict();

/* ── Push tokens (Task #102) ───────────────────────────── */

export const RegisterPushTokenSchema = z
  .object({
    token: z.string().trim().min(1).max(300),
    platform: z.enum(["ios", "android", "web"]).nullable().optional(),
  })
  .strict();

export const RegisterPushTokenResultSchema = z
  .object({ registered: z.boolean() })
  .strict();

export const UnregisterPushTokenSchema = z
  .object({ token: z.string().trim().min(1).max(300) })
  .strict();

export const UnregisterPushTokenResultSchema = z
  .object({ removed: z.boolean() })
  .strict();

/* ── Comments / Q&A (Task #39) ─────────────────────────── */

export const CommentSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    parent_id: z.string().nullable(),
    author_id: z.string(),
    author_name: z.string(),
    is_seller: z.boolean(),
    body: z.string(),
    created_at: z.string(),
  })
  .strict();

export const CommentBodySchema = z
  .object({
    body: z.string().trim().min(1).max(1000),
    parent_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const CommentDeleteResultSchema = z
  .object({ deleted: z.boolean() })
  .strict();

/* ── Seller Reviews (Task #39) ─────────────────────────── */

export const SellerReviewSchema = z
  .object({
    id: z.string(),
    seller_id: z.string(),
    author_id: z.string(),
    author_name: z.string(),
    rating: z.number().int().min(1).max(5),
    body: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

export const ReviewSummarySchema = z
  .object({
    average: z.number().nullable(),
    count: z.number(),
  })
  .strict();

export const ReviewsResponseSchema = z
  .object({
    items: z.array(SellerReviewSchema),
    summary: ReviewSummarySchema,
    can_review: z.boolean(),
    my_rating: z.number().int().min(1).max(5).nullable(),
  })
  .strict();

export const ReviewBodySchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

/* ── Story Response Schemas ────────────────────────────── */

export const StoryItemSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    user_name: z.string(),
    user_avatar: z.string().nullable().optional(),
    media_url: z.string(),
    caption: z.string().nullable().optional(),
    listing_id: z.string().nullable().optional(),
    created_at: z.string(),
    expires_at: z.string(),
    seen: z.boolean(),
    is_mine: z.boolean(),
    view_count: z.number().optional(),
  })
  .strict();

export const StoryViewResultSchema = z.object({ viewed: z.boolean() }).strict();

export const CreateStorySchema = z
  .object({
    media_url: z.string().trim().min(1).max(1000),
    listing_id: z.string().uuid().optional(),
    caption: z.string().trim().max(280).optional(),
  })
  .strict();


// Query-string booleans arrive as the literal strings "true"/"false";
// z.coerce.boolean() would treat "false" as truthy, so parse explicitly.
const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");

// Industrial subtypes backing the two browse "groups" (facilities / materials).
// A request may carry a single subtype or a comma-separated list (a whole
// group), parsed into a validated array so the membership test is pushed into
// the DB — never client-side post-filtering that can false-empty a page.
const INDUSTRIAL_SUBTYPES = [
  "factory",
  "warehouse",
  "land",
  "production_line",
  "raw_material",
  "machine",
] as const;

const industrialTypeParam = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.enum(INDUSTRIAL_SUBTYPES)).min(1))
  .optional();

// Shared per-section "engine" filters, applied identically by feed + search so
// every chip returns the same truthful result set.
const engineFilterFields = {
  condition: z.enum(["new", "used"]).optional(),
  payment_plan: z.enum(["installment", "bank", "direct", "islamic"]).optional(),
  property_type: z.string().trim().max(40).optional(),
  finishing_type: z.string().trim().max(40).optional(),
  compound: boolParam.optional(),
  furnished: boolParam.optional(),
  // Real-estate offer type: sale (تمليك / ownership) vs rent (إيجار). Stored in
  // specs.offer_type; the primary real-estate split in the EG/Gulf markets.
  offer_type: z.enum(["sale", "rent"]).optional(),
  // Rental system within rent — the country's legal/duration regime (EG:
  // furnished_daily / new_law / old_law; Gulf: annual_contract). Free string on
  // purpose: the catalog is client-side and grows per country (adaptive data).
  rental_term: z.string().max(40).optional(),
  // Car engine filters. fuel_type / transmission are real enum columns (with a
  // specs JSON fallback); brand / model match the English listing title (titles
  // are canonical "<Brand> <Model> <Year>") so `q` stays free for NLP text;
  // min_year / max_year filter the numeric specs.year.
  fuel_type: z.enum(["petrol", "diesel", "hybrid", "electric", "natural_gas"]).optional(),
  transmission: z.enum(["manual", "automatic", "cvt"]).optional(),
  brand: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  min_year: z.coerce.number().int().min(1950).max(2100).optional(),
  max_year: z.coerce.number().int().min(1950).max(2100).optional(),
  // Industrial engine filters (real enum columns).
  industry: z
    .enum([
      "food",
      "beverage",
      "plastic",
      "textile",
      "pharmaceutical",
      "chemical",
      "engineering",
      "other",
    ])
    .optional(),
  origin_type: z.enum(["local", "imported"]).optional(),
} as const;

// Result ordering for the search results screen. `recommended` (default) and
// `newest` keep the created_at keyset cursor (backward compatible); the others
// switch to offset pagination since their sort key isn't the cursor column.
export const SearchSortValues = [
  "recommended",
  "newest",
  "price_asc",
  "price_desc",
  "popular",
] as const;

export const FeedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
  // Buyer request/wanted filter. Omit → both; true → only requests; false → only sales.
  is_request: boolParam.optional(),
  industrial_type: industrialTypeParam,
  ...engineFilterFields,
  session_id: z.string().optional(),
});

/* ── Banco Business / profile update ───────────────────── */
// PATCH /v1/me body. The server is the sole authority that maps a business
// signup to a role (always `dealer`) — a raw `role` is never accepted.
export const UpdateMeSchema = z
  .object({
    account_type: z.enum(["individual", "dealer", "company"]).optional(),
    phone: z.string().trim().min(4).max(30).nullable().optional(),
    business: z
      .object({
        activity_type: z.enum([
          "car_dealer",
          "real_estate_developer",
          "factory",
          "supplier",
        ]),
        business_name: z.string().trim().min(2).max(120),
        // Optional trade/brand name shown publicly and the owner/decision-maker
        // name captured for verification. Both stored in companyDetails.
        trade_name: z.string().trim().min(2).max(120).optional(),
        owner_name: z.string().trim().min(2).max(120).optional(),
        city: z.string().trim().min(2).max(80),
        // Optional verification document/photo URLs (already uploaded to object
        // storage) submitted for admin review. Stored in companyDetails.
        documents: z.array(z.string().url()).max(8).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;

export const SearchQuerySchema = z.object({
  // Optional: a section results screen may search by filters alone (no text).
  q: z.string().max(200).optional(),
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
  // Buyer request/wanted filter. Omit → both; true → only requests; false → only sales.
  is_request: boolParam.optional(),
  min_price: z.coerce.number().optional(),
  max_price: z.coerce.number().optional(),
  location: z.string().optional(),
  // Near-me / radius search — all three together; lat/lng in degrees, radius km.
  near_lat: z.coerce.number().min(-90).max(90).optional(),
  near_lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().min(0.1).max(500).optional(),
  has_installment: z.coerce.boolean().optional(),
  industrial_type: industrialTypeParam,
  ...engineFilterFields,
  sort: z.enum(SearchSortValues).default("recommended"),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// GET /v1/search/map — server-side clustered pins for the current viewport.
// SAME filters as search (so map and list stay consistent) PLUS the bounding box
// + zoom. Inherits every engine filter, incl. offer_type (rent/sale) so the
// Booking-style "rentals on a map" works for real-estate, land and factories.
export const MapClustersQuerySchema = SearchQuerySchema.extend({
  min_lat: z.coerce.number().min(-90).max(90),
  max_lat: z.coerce.number().min(-90).max(90),
  min_lng: z.coerce.number().min(-180).max(180),
  max_lng: z.coerce.number().min(-180).max(180),
  zoom: z.coerce.number().min(0).max(22),
});

export const MapClusterSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    count: z.number(),
    listing_id: z.string().nullable(),
  })
  .strict();

// GET /v1/listings/:id/insights — a listing's price vs its market segment.
// Figures are null (and rating "insufficient_data") until the segment has enough
// real observations — the response never carries a fabricated number.
export const PriceHistoryPointSchema = z
  .object({
    month: z.string(),
    count: z.number(),
    average: z.number().nullable(),
    median: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
  })
  .strict();

export const DealInsightsSchema = z
  .object({
    rating: z.enum(["great_deal", "good_deal", "fair", "above_market", "insufficient_data"]),
    segment_key: z.string(),
    sample_size: z.number(),
    currency: z.string(),
    median: z.number().nullable(),
    average: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    delta_pct: z.number().nullable(),
    trend_pct: z.number().nullable(),
    history: z.array(PriceHistoryPointSchema),
  })
  .strict();

// GET /v1/reference/places — autocomplete over the geo/real-estate reference set.
export const PlaceSuggestionSchema = z
  .object({
    id: z.string(),
    global_id: z.string(),
    place_type: z.string(),
    name_en: z.string(),
    name_ar: z.string().nullable(),
    iso_country_code: z.string().nullable(),
    popularity: z.number(),
  })
  .strict();

// Short‑stay bookings (furnished/daily rental — hotel model).
export const AvailabilityRangeSchema = z
  .object({ check_in: z.string(), check_out: z.string() })
  .strict();

export const BookingSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    check_in: z.string(),
    check_out: z.string(),
    nights: z.number(),
    guests: z.number(),
    price_per_night: z.number().nullable(),
    total_price: z.number().nullable(),
    currency: z.string(),
    status: z.string(),
    created_at: z.string().nullable(),
  })
  .strict();

export const CreateBookingSchema = z
  .object({
    check_in: z.string(),
    check_out: z.string(),
    guests: z.number().int().positive().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

export const BookingListItemSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    check_in: z.string(),
    check_out: z.string(),
    nights: z.number(),
    guests: z.number(),
    price_per_night: z.number().nullable(),
    total_price: z.number().nullable(),
    currency: z.string(),
    status: z.string(),
    created_at: z.string().nullable(),
    listing_title: z.string(),
    listing_location: z.string().nullable(),
    counterparty_name: z.string().nullable(),
  })
  .strict();

export const ListBookingsQuerySchema = z.object({
  role: z.enum(["guest", "host"]).default("guest"),
});

export const UpdateBookingSchema = z
  .object({ action: z.enum(["confirm", "reject", "cancel"]) })
  .strict();

// GET /v1/search/facets — per-value counts of the currently-visible inventory,
// optionally scoped to a category. The client gates chips on count > 0 so it
// never offers a filter that would return an empty page.
export const FacetsQuerySchema = z.object({
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
});

const FacetMap = z.record(z.number());

export const FacetCountsSchema = z.object({
  total: z.number(),
  category: FacetMap,
  condition: FacetMap,
  fuel_type: FacetMap,
  transmission: FacetMap,
  payment_plan: FacetMap,
  property_type: FacetMap,
  finishing_type: FacetMap,
  offer_type: FacetMap,
  industrial_type: FacetMap,
  industry: FacetMap,
  origin_type: FacetMap,
  compound: z.number(),
  furnished: z.number(),
  has_installment: z.number(),
});

export type FacetCounts = z.infer<typeof FacetCountsSchema>;

/* ── Admin plan management (control keys) ──────────────── */
const planMoney = z.number().min(0).max(100_000_000);
const planAudience = z.enum(["individual", "dealer", "company", "enterprise"]);

// All-optional patch (snake_case wire shape). Only provided keys are changed.
export const PlanUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    name_ar: z.string().trim().max(120).nullable().optional(),
    audience: planAudience.optional(),
    is_baseline: z.boolean().optional(),
    monthly_price: planMoney.optional(),
    listing_quota: z.number().int().min(0).max(1_000_000).nullable().optional(),
    active_listing_cap: z.number().int().min(0).max(1_000_000).nullable().optional(),
    boost_price: planMoney.optional(),
    cpl_whatsapp: planMoney.optional(),
    cpl_call: planMoney.optional(),
    cpl_chat: planMoney.optional(),
    cpl_finance_request: planMoney.optional(),
    ranking_weight: z.number().min(0).max(100).optional(),
    features: z.unknown().nullable().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

// Create requires slug + name; everything else falls back to column defaults.
export const PlanCreateSchema = PlanUpdateSchema.extend({
  slug: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
});

export const PlanItemSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    name_ar: z.string().nullable(),
    audience: z.string(),
    is_baseline: z.boolean(),
    monthly_price: z.number(),
    listing_quota: z.number().nullable(),
    active_listing_cap: z.number().nullable(),
    boost_price: z.number(),
    cpl_whatsapp: z.number(),
    cpl_call: z.number(),
    cpl_chat: z.number(),
    cpl_finance_request: z.number(),
    ranking_weight: z.number(),
    features: z.unknown().nullable(),
    is_active: z.boolean(),
    sort_order: z.number(),
  })
  .strict();

export const CreateListingSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(["car", "real_estate", "industrial"]),
  // Required for normal sale listings; optional only for request/wanted posts.
  // The superRefine below enforces "required unless is_request".
  base_price_cash: z.number().positive().optional(),
  // Buyer "request/wanted" post. When true, price is optional and a description
  // is required (see refine). The listing still belongs to its category.
  is_request: z.boolean().optional().default(false),
  location: z.string().min(2).max(100),
  // Optional precise pin (the seller's "use my location"). When set it overrides
  // the area centroid for near-me search + map display. Both axes or neither.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  specs: z.record(z.unknown()),
  media: z
    .array(
      z.object({
        type: z.enum(["image", "video"]),
        url: z.string().url(),
        thumbnail_url: z.string().url().optional(),
        is_thumbnail: z.boolean().default(false),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      })
    )
    // Sale listings must carry at least one media item (enforced in superRefine);
    // buyer requests may omit photos entirely.
    .default([]),
  payment_options: z
    .array(
      z.object({
        mode: z.enum(["cash", "seller_installment", "bank_finance"]),
        down_payment: z.number().optional(),
        monthly_payment: z.number().optional(),
        duration_months: z.number().int().optional(),
        is_islamic_compliant: z.boolean().default(false),
      })
    )
    .optional()
    .default([]),
  // Additive (Task #40): optional logistics & delivery for the listing.
  logistics: LogisticsInputSchema.optional(),
})
  .superRefine((data, ctx) => {
    // Price is mandatory for real sale listings; relaxed only for requests.
    if (!data.is_request && data.base_price_cash === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["base_price_cash"],
        message: "base_price_cash is required unless the listing is a request",
      });
    }
    // A request must say what the buyer is looking for.
    if (
      data.is_request &&
      (!data.description || data.description.trim().length < 3)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "description is required for request listings",
      });
    }
    // Sale listings need at least one photo/video; requests may omit media.
    if (!data.is_request && data.media.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "at least one media item is required unless the listing is a request",
      });
    }
  });

// POST /v1/listings/:id/bump result. bumped_at is the new effective-recency
// timestamp; next_bump_available_at is when the owner may recycle again.
export const BumpListingResultSchema = z.object({
  id: z.string(),
  bumped_at: z.string(),
  next_bump_available_at: z.string(),
});

/**
 * Atomic contact-reveal schema. The server simultaneously records the lead
 * and returns the seller's phone number — binding the billable event to the
 * server-observed contact request.
 */
export const ContactLeadBodySchema = z.object({
  listing_id: z.string().uuid(),
  action_type: z.enum(["whatsapp", "call", "chat", "finance_request"]),
  /** Single-use token minted by GET /listings/:id — proves the user viewed the listing before contacting. */
  contact_token: z.string().uuid("contact_token must be a valid UUID"),
  buyer_name: z.string().optional(),
  buyer_phone: z.string().optional(),
});

export const ContactLeadResultSchema = z
  .object({
    // Phone number for call/whatsapp actions; null for chat/finance_request.
    phone: z.string().nullable(),
  })
  .strict();

export const BehaviorSignalSchema = z.object({
  session_id: z.string().max(128),
  listing_id: z.string().uuid().optional(),
  action: z.enum([
    "view",
    "click",
    "scroll_fast",
    "scroll_slow",
    "category_tap",
    "open_detail",
    // B-reaction signals (long-press on the identity B): explicit interest and
    // explicit rejection — both feed the adaptive feed's personalization.
    "interested",
    "angry",
  ]),
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
  price: z.number().optional(),
});

export const SaveListingSchema = z.object({
  listing_id: z.string().uuid(),
});

export const DealerListingsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["active", "sold", "archived"]).optional(),
  sort: z
    .enum(["created_at", "price", "views", "leads"])
    .default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const BulkActionSchema = z.object({
  listing_ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["activate", "archive", "delete"]),
});

// Boost pricing is server-side ONLY (read from the seller's plan). The client
// may NOT supply prices/budgets — those fields are intentionally absent.
export const BoostListingSchema = z.object({
  listing_id: z.string().uuid(),
  ad_type: z
    .enum(["featured", "native_feed", "top_search"])
    .default("native_feed"),
  duration_days: z.number().int().min(1).max(30).default(7),
  idempotency_key: z.string().min(1).max(200).optional(),
});

export const ImpressionSchema = z.object({
  session_id: z.string().min(1),
  device_id: z.string().optional(),
});

export const AdImpressionResultSchema = z
  .object({
    counted: z.boolean(),
    billable: z.boolean(),
    reason: z.string().optional(),
    deactivated: z.boolean(),
  })
  .strict();

export const UpdateLeadStatusSchema = z.object({
  status: z.enum(["new", "contacted", "closed"]),
});

export const DealerLeadsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["new", "contacted", "closed"]).optional(),
  action_type: z
    .enum(["whatsapp", "call", "chat", "finance_request"])
    .optional(),
});

/* ── Listing CRUD schemas ───────────────────────────────── */

export const UpdateListingSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().max(2000).optional(),
    base_price_cash: z.number().positive().optional(),
    location: z.string().min(2).max(100).optional(),
    // Lifecycle status patch (Task #71). Sellers mark a deal closed ("sold")
    // or hide a listing ("archived").
    status: z.enum(["active", "sold", "archived"]).optional(),
    specs: z.record(z.unknown()).optional(),
    // Additive (Task #40): optional logistics & delivery patch.
    logistics: LogisticsInputSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const UpdateListingResultSchema = z
  .object({ id: z.string(), updated: z.boolean() })
  .strict();

export const DeleteListingResultSchema = z
  .object({ id: z.string(), deleted: z.boolean() })
  .strict();

export const PublicListingsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
});

/* ── Wallet & Billing schemas ──────────────────────────── */

// Egyptian payment rails available for external top-up (excludes `wallet`,
// which denotes an internal wallet-funded charge with no external rail).
export const EgyptianRailSchema = z.enum([
  "vodafone_cash",
  "fawry",
  "instapay",
  "bank_transfer",
]);

export const TopupCreateSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  method: EgyptianRailSchema,
});

export const WalletTransactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export const WalletStateSchema = z
  .object({
    balance: z.string(),
    currency: z.literal("EGP"),
  })
  .strict();

export const TopupIntentResultSchema = z
  .object({
    intent_id: z.string(),
    amount: z.string(),
    method: EgyptianRailSchema,
    status: z.enum(["pending", "completed", "failed", "expired"]),
    provider_ref: z.string().nullable(),
    checkout_url: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

export const TopupConfirmResultSchema = z
  .object({
    intent_id: z.string(),
    status: z.enum(["pending", "completed", "failed", "expired"]),
    transaction_id: z.string().nullable(),
    balance: z.string(),
    already_processed: z.boolean(),
  })
  .strict();

export const WalletTransactionSchema = z
  .object({
    id: z.string(),
    type: z.enum([
      "wallet_topup",
      "boost_charge",
      "subscription_charge",
      "lead_charge",
      "refund",
      "adjustment",
    ]),
    amount: z.string(),
    balance_after: z.string(),
    payment_method: z
      .enum(["vodafone_cash", "fawry", "instapay", "bank_transfer", "wallet"])
      .nullable(),
    reference_type: z.string().nullable(),
    reference_id: z.string().nullable(),
    description: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

/* ── Subscription & Plan schemas ───────────────────────── */

// Subscribe by plan slug only — the server reads the price from the plans
// table. No client-supplied pricing is ever accepted. payment_method picks the
// funding source: "wallet" charges the balance immediately; an Egyptian rail
// creates a pending payment intent that must be confirmed.
export const SubscribeSchema = z.object({
  plan_slug: z.string().min(1).max(64),
  payment_method: z
    .enum(["wallet", "vodafone_cash", "fawry", "instapay", "bank_transfer"])
    .default("wallet"),
});

export const PlanSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    name_ar: z.string().nullable(),
    audience: z.enum(["individual", "dealer", "company", "enterprise"]),
    is_baseline: z.boolean(),
    monthly_price: z.string(),
    listing_quota: z.number().nullable(),
    active_listing_cap: z.number().nullable(),
    boost_price: z.string(),
    cpl_whatsapp: z.string(),
    cpl_call: z.string(),
    cpl_chat: z.string(),
    cpl_finance_request: z.string(),
    ranking_weight: z.string(),
    features: z.record(z.boolean()).nullable(),
    sort_order: z.number().nullable(),
  })
  .strict();

export const SubscriptionSchema = z
  .object({
    id: z.string(),
    status: z.enum(["active", "expired", "cancelled", "pending"]),
    plan: PlanSchema,
    price_paid: z.string(),
    starts_at: z.string(),
    expires_at: z.string(),
    auto_renew: z.boolean(),
    cancelled_at: z.string().nullable(),
  })
  .strict();

// Pending subscription payment via an Egyptian rail (mirrors the wallet top-up
// intent shape, plus the plan being purchased).
export const SubscriptionIntentResultSchema = z
  .object({
    intent_id: z.string(),
    plan_slug: z.string(),
    amount: z.string(),
    method: EgyptianRailSchema,
    status: z.enum(["pending", "completed", "failed", "expired"]),
    provider_ref: z.string().nullable(),
    checkout_url: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

// Result of POST /subscriptions: either the subscription is active immediately
// (wallet) or a payment intent was created (external rail).
export const SubscribeResultSchema = z
  .object({
    mode: z.enum(["active", "intent"]),
    subscription: SubscriptionSchema.nullable(),
    intent: SubscriptionIntentResultSchema.nullable(),
  })
  .strict();

export const SubscriptionConfirmResultSchema = z
  .object({
    intent_id: z.string(),
    status: z.enum(["pending", "completed", "failed", "expired"]),
    subscription: SubscriptionSchema.nullable(),
    balance: z.string(),
    already_processed: z.boolean(),
  })
  .strict();

export const SubscriptionUsageSchema = z
  .object({
    listings_this_month: z.number(),
    active_listings: z.number(),
    listing_quota: z.number().nullable(),
    active_listing_cap: z.number().nullable(),
  })
  .strict();

// GET /subscriptions/me — the effective plan (active sub or free baseline), the
// active subscription record if any, and the current usage against quotas.
export const SubscriptionMeSchema = z
  .object({
    plan: PlanSchema,
    subscription: SubscriptionSchema.nullable(),
    usage: SubscriptionUsageSchema,
  })
  .strict();

/* ── Invoice & Billing report schemas ──────────────────── */

export const InvoiceLineItemSchema = z
  .object({
    label: z.string(),
    amount: z.string(),
  })
  .strict();

// An invoice is the customer-facing receipt for one ledger transaction. The
// linked transaction's `type` is surfaced so a client can label the document
// (e.g. "Subscription", "Boost") without a second lookup.
export const InvoiceSchema = z
  .object({
    id: z.string(),
    invoice_number: z.string(),
    amount: z.string(),
    status: z.enum(["paid", "void"]),
    transaction_id: z.string(),
    transaction_type: z
      .enum([
        "wallet_topup",
        "boost_charge",
        "subscription_charge",
        "lead_charge",
        "refund",
        "adjustment",
      ])
      .nullable(),
    description: z.string().nullable(),
    line_items: InvoiceLineItemSchema.array().nullable(),
    issued_at: z.string().nullable(),
    created_at: z.string().nullable(),
  })
  .strict();

export const BillingInvoicesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// Report month as `YYYY-MM` (UTC). Omitted ⇒ the current calendar month.
export const BillingReportQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM")
    .optional(),
});

export const BillingReportLineSchema = z
  .object({
    type: z.enum([
      "wallet_topup",
      "boost_charge",
      "subscription_charge",
      "lead_charge",
      "refund",
      "adjustment",
    ]),
    // Signed EGP total for this type over the period (credits +, debits −).
    total: z.string(),
    count: z.number(),
  })
  .strict();

// Monthly billing summary for the authenticated user. `total_charged` is the
// magnitude of all debits (money spent); `total_topped_up` is the sum of all
// credits (money added). `by_type` is the per-type ledger breakdown.
export const BillingReportSchema = z
  .object({
    month: z.string(),
    currency: z.literal("EGP"),
    total_charged: z.string(),
    total_topped_up: z.string(),
    transaction_count: z.number(),
    by_type: BillingReportLineSchema.array(),
  })
  .strict();

/* ── Public Report / Support input + Report response ───── */

export const CreateReportSchema = z.object({
  listing_id: z.string().uuid(),
  reason: z.enum(["fake_price", "wrong_data", "scam", "duplicate", "other"]),
  details: z.string().max(2000).optional(),
});

export const CreateSupportTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  message: z.string().min(1).max(4000),
  category: z.string().max(100).optional(),
});

export const ReportSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    listing_title: z.string().nullable(),
    reason: z.enum(["fake_price", "wrong_data", "scam", "duplicate", "other"]),
    details: z.string().nullable(),
    status: z.enum(["open", "reviewing", "resolved", "dismissed"]),
    reporter_name: z.string().nullable(),
    resolution_note: z.string().nullable(),
    created_at: z.string(),
    resolved_at: z.string().nullable(),
  })
  .strict();

export const SupportMessageSchema = z
  .object({
    id: z.string(),
    body: z.string(),
    is_admin: z.boolean(),
    author_name: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

export const SupportTicketSchema = z
  .object({
    id: z.string(),
    subject: z.string(),
    category: z.string().nullable(),
    status: z.enum(["open", "closed"]),
    user_id: z.string().nullable(),
    user_name: z.string().nullable(),
    message_count: z.number(),
    last_reply_at: z.string().nullable(),
    created_at: z.string(),
    messages: z.array(SupportMessageSchema),
  })
  .strict();

/* ── Admin: shared listing enums ───────────────────────── */

const adminListingStatusEnum = z.enum([
  "active",
  "sold",
  "archived",
  "draft",
  "pending_approval",
  "pending_review",
  "approved",
  "rejected",
  "flagged",
]);

/* ── Admin request (query/body) schemas ────────────────── */

export const AdminUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(["individual", "dealer", "company", "enterprise"]).optional(),
  banned: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const SetUserBanSchema = z.object({
  banned: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const SetUserRoleSchema = z.object({
  role: z.enum(["owner", "admin", "moderator", "support", "user"]),
});

export const SetUserVerifiedSchema = z.object({
  verified: z.boolean(),
});

export const AdminListingsQuerySchema = z.object({
  search: z.string().optional(),
  status: adminListingStatusEnum.optional(),
  flagged: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const ModerationQueueQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const ModerateListingSchema = z.object({
  action: z.enum(["approve", "reject", "archive", "flag", "unflag"]),
  reason: z.string().max(500).optional(),
});

export const AdminLeadsQuerySchema = z.object({
  action_type: z.enum(["whatsapp", "call", "chat", "finance_request"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const AdminAdsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const AdminReportsQuerySchema = z.object({
  status: z.enum(["open", "reviewing", "resolved", "dismissed"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const ResolveReportSchema = z.object({
  status: z.enum(["resolved", "dismissed", "reviewing"]),
  note: z.string().max(2000).optional(),
});

export const SupportTicketsQuerySchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const RespondSupportTicketSchema = z.object({
  message: z.string().min(1).max(4000),
});

export const ResolveSupportTicketSchema = z.object({
  status: z.enum(["open", "closed"]),
});

/* ── Admin response schemas ────────────────────────────── */

export const AdminUserSchema = z
  .object({
    id: z.string(),
    account_number: z.string().nullable(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    role: z.enum(["individual", "dealer", "company", "enterprise"]),
    staff_role: z.enum(["owner", "admin", "moderator", "support", "user"]),
    is_admin: z.boolean(),
    is_verified: z.boolean(),
    is_shadow_banned: z.boolean(),
    wallet_balance: z.string(),
    listing_count: z.number(),
    created_at: z.string(),
  })
  .strict();

export const AdminListingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    price_display: z.string(),
    category: z.string(),
    status: adminListingStatusEnum,
    is_flagged: z.boolean(),
    seller_id: z.string().nullable(),
    seller_name: z.string().nullable(),
    seller_shadow_banned: z.boolean(),
    media_preview: z.string().nullable(),
    report_count: z.number(),
    view_count: z.number(),
    lead_count: z.number(),
    location: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

export const AdminLeadSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    listing_title: z.string(),
    action_type: z.enum(["whatsapp", "call", "chat", "finance_request"]),
    status: z.enum(["new", "contacted", "closed"]),
    buyer_name: z.string().nullable(),
    buyer_phone: z.string().nullable(),
    created_at: z.string().nullable().optional(),
  })
  .strict();

/* ── Admin: financing CRM ──────────────────────────────── */

export const financingStatusEnum = z.enum([
  "new",
  "forwarded",
  "contacted",
  "closed",
  "rejected",
]);

export const FinancingRequestsQuerySchema = z.object({
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
  status: financingStatusEnum.optional(),
  search: z.string().optional(),
  // Inclusive requested-at date range (YYYY-MM-DD or any Date-parseable string).
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const UpdateFinancingRequestSchema = z
  .object({
    status: financingStatusEnum.optional(),
    // Pass a string to assign an intermediary, null to clear the assignment,
    // or omit to leave it unchanged.
    intermediary_id: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.intermediary_id !== undefined ||
      v.notes !== undefined,
    { message: "At least one field must be provided" },
  );

export const CreateFinancingIntermediarySchema = z.object({
  name: z.string().min(1).max(200),
  contact_email: z.string().email().max(320).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const UpdateFinancingIntermediarySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    contact_email: z.string().email().max(320).nullable().optional(),
    contact_phone: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export const FinancingIntermediarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    contact_email: z.string().nullable(),
    contact_phone: z.string().nullable(),
    notes: z.string().nullable(),
    is_active: z.boolean(),
    created_at: z.string().nullable(),
  })
  .strict();

export const FinancingRequestSchema = z
  .object({
    // Keyed by the underlying finance_request lead — the stable identity the
    // CRM mutates against (the sidecar row is created lazily).
    lead_id: z.string(),
    status: financingStatusEnum,
    listing_id: z.string(),
    listing_title: z.string(),
    category: z.enum(["car", "real_estate", "industrial"]),
    buyer_name: z.string().nullable(),
    buyer_phone: z.string().nullable(),
    // Asset (listing) cash price — the amount being financed.
    asset_price: z.string().nullable(),
    // Bank-finance plan terms for the listing, when one is published.
    down_payment: z.string().nullable(),
    monthly_payment: z.string().nullable(),
    duration_months: z.number().nullable(),
    provider_name: z.string().nullable(),
    intermediary_id: z.string().nullable(),
    intermediary_name: z.string().nullable(),
    notes: z.string().nullable(),
    assigned_at: z.string().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .strict();

export const AdminAdSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    listing_title: z.string().nullable(),
    seller_id: z.string().nullable(),
    seller_name: z.string().nullable(),
    ad_type: z.string(),
    is_active: z.boolean(),
    budget_total: z.string().nullable(),
    budget_spent: z.string(),
    impressions: z.number(),
    billable_impressions: z.number(),
    starts_at: z.string().nullable(),
    expires_at: z.string(),
    created_at: z.string().nullable(),
  })
  .strict();

export const RevenueSummarySchema = z
  .object({
    total_mtd: z.string(),
    total_all_time: z.string(),
    currency: z.string(),
    by_channel: z.array(
      z.object({
        channel: z.string(),
        amount: z.string(),
        note: z.string().nullable(),
      })
    ),
    timeseries: z.array(
      z.object({
        date: z.string(),
        amount: z.string(),
      })
    ),
  })
  .strict();

export const AdminAnalyticsSchema = z
  .object({
    conversion_rate: z.number(),
    total_listings: z.number(),
    active_listings: z.number(),
    sold_listings: z.number(),
    total_leads: z.number(),
    top_categories: z.array(
      z.object({
        category: z.string(),
        listing_count: z.number(),
        lead_count: z.number(),
      })
    ),
    best_sellers: z.array(
      z.object({
        user_id: z.string(),
        name: z.string(),
        sold_count: z.number(),
        lead_count: z.number(),
      })
    ),
    trending_listings: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        view_count: z.number(),
        lead_count: z.number(),
      })
    ),
  })
  .strict();

export const FraudSignalSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    severity: z.enum(["info", "warning", "critical"]),
    title: z.string(),
    description: z.string(),
    subject_id: z.string().nullable(),
    count: z.number(),
    created_at: z.string(),
  })
  .strict();

export const AlertSchema = z
  .object({
    id: z.string(),
    type: z.enum(["lead_drop", "error_spike", "fraud_spike", "payment_failure"]),
    severity: z.enum(["info", "warning", "critical"]),
    title: z.string(),
    description: z.string(),
    value: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

export const MonitoringSchema = z
  .object({
    uptime_seconds: z.number(),
    total_requests: z.number(),
    throughput_per_min: z.number(),
    error_rate: z.number(),
    latency_p50_ms: z.number(),
    latency_p95_ms: z.number(),
    feed_latency_p50_ms: z.number(),
    feed_latency_p95_ms: z.number(),
    endpoints: z.array(
      z.object({
        path: z.string(),
        count: z.number(),
        error_count: z.number(),
        p50_ms: z.number(),
        p95_ms: z.number(),
      })
    ),
  })
  .strict();

export const AdminOverviewSchema = z
  .object({
    total_users: z.number(),
    total_listings: z.number(),
    active_listings: z.number(),
    total_leads: z.number(),
    open_reports: z.number(),
    moderation_queue_count: z.number(),
    open_tickets: z.number(),
    revenue_mtd: z.string(),
    active_alerts: z.number(),
    fraud_signals: z.number(),
    error_rate: z.number(),
  })
  .strict();

/* ── Payment provider config (admin-managed PSP credentials) ── */

// Request body. Secret fields are write-only: omit or send "" to keep existing.
export const PaymentConfigUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["test", "live"]).optional(),
    public_key: z.string().max(500).nullable().optional(),
    integration_ids: z.string().max(500).nullable().optional(),
    api_base: z.string().max(500).nullable().optional(),
    secret_key: z.string().max(2000).optional(),
    hmac_secret: z.string().max(2000).optional(),
  })
  .strict();

// Response: masked view — never carries raw secret material.
export const PaymentConfigViewSchema = z
  .object({
    provider: z.string(),
    source: z.enum(["db", "env", "none"]),
    configured: z.boolean(),
    enabled: z.boolean(),
    mode: z.enum(["test", "live"]),
    public_key: z.string().nullable(),
    integration_ids: z.string(),
    api_base: z.string().nullable(),
    has_secret_key: z.boolean(),
    has_hmac_secret: z.boolean(),
    updated_at: z.string().nullable(),
    updated_by: z.string().nullable(),
  })
  .strict();

export const PaymentConfigTestResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    mode: z.enum(["test", "live"]),
    source: z.enum(["db", "env", "none"]),
  })
  .strict();

/* ── Email provider config (admin-managed delivery credentials) ── */

// Request body. The API key is write-only: omit or send "" to keep existing.
export const EmailConfigUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    from_name: z.string().max(200).nullable().optional(),
    from_email: z.string().max(320).nullable().optional(),
    sending_domain: z.string().max(255).nullable().optional(),
    reply_to: z.string().max(320).nullable().optional(),
    public_app_url: z.string().max(500).nullable().optional(),
    api_key: z.string().max(2000).optional(),
  })
  .strict();

// Response: masked view — never carries the raw API key.
export const EmailConfigViewSchema = z
  .object({
    provider: z.string(),
    source: z.enum(["db", "env", "none"]),
    configured: z.boolean(),
    enabled: z.boolean(),
    active_transport: z.enum(["resend", "log"]),
    from_name: z.string().nullable(),
    from_email: z.string().nullable(),
    sending_domain: z.string().nullable(),
    reply_to: z.string().nullable(),
    public_app_url: z.string().nullable(),
    has_api_key: z.boolean(),
    updated_at: z.string().nullable(),
    updated_by: z.string().nullable(),
  })
  .strict();

export const EmailConfigTestResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    active_transport: z.enum(["resend", "log"]),
    source: z.enum(["db", "env", "none"]),
  })
  .strict();

/* ── Promo ad-credit campaign (separate virtual ad-only credit) ── */

// Admin request to upsert/renew the campaign. Amounts are non-negative numeric
// strings; duration is bounded (mirrors PromoAdCreditService normalizers).
export const PromoCampaignUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    verified_monthly_amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Must be a non-negative number")
      .optional(),
    unverified_monthly_amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Must be a non-negative number")
      .optional(),
    duration_months: z.number().int().min(1).max(24).optional(),
  })
  .strict();

export const PromoCampaignViewSchema = z
  .object({
    enabled: z.boolean(),
    verified_monthly_amount: z.string(),
    unverified_monthly_amount: z.string(),
    duration_months: z.number(),
    campaign_version: z.number(),
    starts_at: z.string(),
    updated_at: z.string().nullable(),
    updated_by: z.string().nullable(),
    status: z.enum(["disabled", "upcoming", "active", "ended"]),
    current_month_index: z.number(),
    months_remaining: z.number(),
  })
  .strict();

export const PromoAdSummarySchema = z
  .object({
    balance: z.string(),
    expires_at: z.string().nullable(),
    campaign_enabled: z.boolean(),
    campaign_active: z.boolean(),
    monthly_amount: z.string(),
    months_remaining: z.number(),
  })
  .strict();

/* ── B2B: Supply-chain links (Task #33) ────────────────── */

// POST /v1/listings/:id/links — connect the path listing (the edge source) to
// another listing. The server guards ownership of the source listing.
export const CreateListingLinkSchema = z
  .object({
    to_listing_id: z.string().uuid(),
    relation: z.enum(["feeds_into", "part_of", "compatible_with"]),
  })
  .strict();

export const CreateListingLinkResultSchema = z
  .object({ id: z.string(), created: z.boolean() })
  .strict();

/* ── B2B: Company / supplier profile (Task #33) ────────── */

// Public seller stats, safe to expose (no lead PII). response_rate is null when
// not yet computed.
export const CompanyStatsSchema = z
  .object({
    active_listings: z.number(),
    total_listings: z.number(),
    member_since: z.string(),
    years_active: z.number(),
    response_rate: z.number().nullable(),
    is_verified: z.boolean(),
  })
  .strict();

// Structured B2B trade block. Null on the profile when the seller has no company
// profile (e.g. an individual). All values are display-ready or raw-but-safe.
export const CompanyTradeSchema = z
  .object({
    about: z.string().nullable(),
    year_established: z.number().nullable(),
    countries_import_from: z.array(z.string()),
    countries_export_to: z.array(z.string()),
    min_order_value: z.string().nullable(),
    min_order_unit: z.string().nullable(),
    monthly_capacity: z.string().nullable(),
    lead_time_days: z.number().nullable(),
    certifications: z.array(z.string()),
    website_url: z.string().nullable(),
    logo_url: z.string().nullable(),
    cover_url: z.string().nullable(),
    // Additive (Task #40): directory facets.
    industry: z.string().nullable(),
    hq_country: z.string().nullable(),
  })
  .strict();

export const CompanyProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    is_verified: z.boolean(),
    stats: CompanyStatsSchema,
    company: CompanyTradeSchema.nullable(),
    // Additive (Task #40): supplier-directory social proof. Optional in the
    // contract; is_following is viewer-relative (false when unauthenticated).
    follower_count: z.number().optional(),
    is_following: z.boolean().optional(),
    // Additive: the seller's newest visible listing — lets a profile visitor
    // start a conversation directly (conversations are listing-anchored).
    latest_listing_id: z.string().nullable().optional(),
  })
  .strict();

export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const CompanyListingsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// PATCH /v1/me/company — owner upsert of the rich B2B block. All fields
// optional; at least one required. URLs and lengths are bounded.
export const UpsertCompanyProfileSchema = z
  .object({
    about: z.string().trim().max(2000).nullable().optional(),
    year_established: z.number().int().min(1800).max(2100).nullable().optional(),
    countries_import_from: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    countries_export_to: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    min_order_value: z.number().positive().max(1_000_000_000).nullable().optional(),
    min_order_unit: z.string().trim().max(40).nullable().optional(),
    monthly_capacity: z.string().trim().max(120).nullable().optional(),
    lead_time_days: z.number().int().min(0).max(3650).nullable().optional(),
    certifications: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    website_url: z.string().trim().url().max(300).nullable().optional(),
    logo_url: z.string().trim().url().max(1000).nullable().optional(),
    cover_url: z.string().trim().url().max(1000).nullable().optional(),
    // Additive (Task #40): directory facets. Inline enum — industryEnumZ is
    // declared later in this module (RFQ block), so it is not yet in scope here.
    industry: z
      .enum([
        "food",
        "beverage",
        "plastic",
        "textile",
        "pharmaceutical",
        "chemical",
        "engineering",
        "other",
      ])
      .nullable()
      .optional(),
    hq_country: z.string().trim().max(80).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  });

export const UpsertCompanyProfileResultSchema = z
  .object({ updated: z.boolean() })
  .strict();

/* ── B2B: RFQ engine (Task #33) ────────────────────────── */

const industryEnumZ = z.enum([
  "food",
  "beverage",
  "plastic",
  "textile",
  "pharmaceutical",
  "chemical",
  "engineering",
  "other",
]);

const industrialTypeEnumZ = z.enum([
  "factory",
  "warehouse",
  "machine",
  "production_line",
  "land",
  "raw_material",
]);

// An RFQ summary (list item + base of the detail). offer_count lets buyers and
// suppliers gauge competition without exposing the offers themselves.
export const RfqSchema = z
  .object({
    id: z.string(),
    buyer_id: z.string(),
    buyer_name: z.string().nullable(),
    category: z.enum(["car", "real_estate", "industrial"]),
    title: z.string(),
    description: z.string().nullable(),
    quantity: z.string().nullable(),
    unit: z.string().nullable(),
    target_price_max: z.string().nullable(),
    destination_country: z.string().nullable(),
    industry: z.string().nullable(),
    industrial_type: z.string().nullable(),
    status: z.enum(["open", "awarded", "closed", "cancelled"]),
    deadline: z.string().nullable(),
    offer_count: z.number(),
    created_at: z.string(),
  })
  .strict();

export const RfqOfferSchema = z
  .object({
    id: z.string(),
    rfq_id: z.string(),
    supplier_id: z.string(),
    supplier_name: z.string().nullable(),
    supplier_is_verified: z.boolean(),
    price_quote: z.string(),
    currency: z.string(),
    lead_time_days: z.number().nullable(),
    moq: z.string().nullable(),
    message: z.string().nullable(),
    status: z.enum(["pending", "accepted", "rejected", "withdrawn"]),
    is_mine: z.boolean(),
    created_at: z.string(),
  })
  .strict();

// RFQ detail. `offers` visibility is enforced server-side: the buyer sees ALL
// offers; a supplier sees only their own; the public sees none.
export const RfqDetailSchema = RfqSchema.extend({
  offers: z.array(RfqOfferSchema),
  viewer_is_buyer: z.boolean(),
}).strict();

export type Rfq = z.infer<typeof RfqSchema>;
export type RfqOffer = z.infer<typeof RfqOfferSchema>;
export type RfqDetail = z.infer<typeof RfqDetailSchema>;

export const RfqsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
  industry: industryEnumZ.optional(),
  industrial_type: industrialTypeEnumZ.optional(),
});

export const CreateRfqSchema = z
  .object({
    category: z.enum(["car", "real_estate", "industrial"]).default("industrial"),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional(),
    quantity: z.number().positive().max(1_000_000_000).optional(),
    unit: z.string().trim().max(40).optional(),
    target_price_max: z.number().positive().max(1_000_000_000).optional(),
    destination_country: z.string().trim().max(80).optional(),
    industry: industryEnumZ.optional(),
    industrial_type: industrialTypeEnumZ.optional(),
    deadline: z.string().datetime().optional(),
  })
  .strict();

export const RfqCreateResultSchema = z.object({ id: z.string() }).strict();

export const SubmitOfferSchema = z
  .object({
    price_quote: z.number().positive().max(1_000_000_000),
    currency: z.string().trim().min(1).max(8).default("EGP"),
    lead_time_days: z.number().int().min(0).max(3650).optional(),
    moq: z.number().positive().max(1_000_000_000).optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .strict();

export const SubmitOfferResultSchema = z
  .object({ id: z.string(), submitted: z.boolean() })
  .strict();

export const AcceptOfferResultSchema = z
  .object({ rfq_id: z.string(), offer_id: z.string(), awarded: z.boolean() })
  .strict();

/* ────────────────────────────────────────────────────────────────────────
 * B2B SUPPLY-CHAIN & INVESTMENT SURFACES (Task #40) — additive validators.
 * snake_case DTOs; numeric columns surface as strings (PG numeric → string).
 * No fabricated figures: financials are seller-provided or labelled `estimate`
 * via figures_source so every surface can render the non-advice disclaimer.
 * Appended after the RFQ block so `industryEnumZ` is already in scope.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── Investment Opportunities ──────────────────────────── */

export const InvestmentTypeEnumZ = z.enum([
  "factory_sale",
  "business_sale",
  "production_line_investment",
  "franchise",
  "partnership",
]);

export const InvestmentStatusEnumZ = z.enum([
  "draft",
  "active",
  "under_offer",
  "closed",
]);

export const FiguresSourceEnumZ = z.enum(["seller_provided", "estimate"]);

export const InvestmentSummarySchema = z
  .object({
    id: z.string(),
    owner_id: z.string(),
    owner_name: z.string().nullable(),
    owner_is_verified: z.boolean(),
    investment_type: InvestmentTypeEnumZ,
    title: z.string(),
    description: z.string().nullable(),
    industry: z.string().nullable(),
    location: z.string(),
    total_value_amount: z.string(),
    total_value_display: z.string(),
    currency: z.string(),
    // All financials nullable + seller-provided / estimate (never invented).
    expected_roi_pct: z.string().nullable(),
    payback_years: z.string().nullable(),
    revenue_range_min: z.string().nullable(),
    revenue_range_max: z.string().nullable(),
    figures_source: FiguresSourceEnumZ,
    cover_url: z.string().nullable(),
    status: InvestmentStatusEnumZ,
    created_at: z.string(),
  })
  .strict();

export const InvestmentDetailSchema = InvestmentSummarySchema.extend({
  cost_structure_note: z.string().nullable(),
  growth_potential_note: z.string().nullable(),
  interest_count: z.number(),
  viewer_has_interest: z.boolean(),
  viewer_is_owner: z.boolean(),
}).strict();

export type InvestmentSummary = z.infer<typeof InvestmentSummarySchema>;
export type InvestmentDetail = z.infer<typeof InvestmentDetailSchema>;

export const InvestmentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  investment_type: InvestmentTypeEnumZ.optional(),
  industry: industryEnumZ.optional(),
  location: z.string().trim().max(100).optional(),
  status: InvestmentStatusEnumZ.optional(),
});

export const CreateInvestmentSchema = z
  .object({
    investment_type: InvestmentTypeEnumZ,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(5000).optional(),
    industry: industryEnumZ.optional(),
    location: z.string().trim().min(2).max(100),
    total_value_amount: z.number().positive().max(1_000_000_000_000),
    currency: z.string().trim().min(1).max(8).default("EGP"),
    expected_roi_pct: z.number().min(0).max(1000).nullable().optional(),
    payback_years: z.number().min(0).max(100).nullable().optional(),
    revenue_range_min: z.number().min(0).max(1_000_000_000_000).nullable().optional(),
    revenue_range_max: z.number().min(0).max(1_000_000_000_000).nullable().optional(),
    cost_structure_note: z.string().trim().max(2000).nullable().optional(),
    growth_potential_note: z.string().trim().max(2000).nullable().optional(),
    figures_source: FiguresSourceEnumZ.default("seller_provided"),
    cover_url: z.string().trim().url().max(1000).nullable().optional(),
  })
  .strict();

export const UpdateInvestmentSchema = CreateInvestmentSchema.partial()
  .extend({ status: InvestmentStatusEnumZ.optional() })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  });

export const InvestmentCreateResultSchema = z.object({ id: z.string() }).strict();
export const InvestmentUpdateResultSchema = z
  .object({ id: z.string(), updated: z.boolean() })
  .strict();

export const SubmitInvestmentInterestSchema = z
  .object({
    kind: z.enum(["interest", "request_details", "contact"]).default("interest"),
    message: z.string().trim().max(2000).optional(),
    contact_phone: z.string().trim().max(40).optional(),
  })
  .strict();

export const InvestmentInterestResultSchema = z
  .object({ id: z.string(), submitted: z.boolean() })
  .strict();

/* ── Suppliers & Companies Directory ───────────────────── */

export const CompanyDirectoryItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    is_verified: z.boolean(),
    industry: z.string().nullable(),
    hq_country: z.string().nullable(),
    logo_url: z.string().nullable(),
    cover_url: z.string().nullable(),
    active_listings: z.number(),
    follower_count: z.number(),
    is_following: z.boolean(),
  })
  .strict();

export type CompanyDirectoryItem = z.infer<typeof CompanyDirectoryItemSchema>;

export const CompaniesDirectoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  q: z.string().trim().max(100).optional(),
  industry: industryEnumZ.optional(),
  hq_country: z.string().trim().max(80).optional(),
  verified: z.coerce.boolean().optional(),
});

export const FollowingQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export const FollowResultSchema = z
  .object({ following: z.boolean(), follower_count: z.number() })
  .strict();

/* ── Global Supply / Import-Export ─────────────────────── */

export const GlobalSupplyStatusEnumZ = z.enum([
  "open",
  "fulfilled",
  "closed",
  "cancelled",
]);

export const GlobalSupplyResponseStatusEnumZ = z.enum([
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
]);

export const IncotermsEnumZ = z.enum([
  "exw",
  "fca",
  "fob",
  "cfr",
  "cif",
  "dap",
  "ddp",
]);

export const GlobalSupplyRequestSchema = z
  .object({
    id: z.string(),
    buyer_id: z.string(),
    buyer_name: z.string().nullable(),
    product_text: z.string(),
    category: z.enum(["car", "real_estate", "industrial"]).nullable(),
    industry: z.string().nullable(),
    quantity: z.string().nullable(),
    unit: z.string().nullable(),
    destination_country: z.string(),
    budget_max: z.string().nullable(),
    currency: z.string(),
    incoterms: z.string().nullable(),
    notes: z.string().nullable(),
    status: GlobalSupplyStatusEnumZ,
    response_count: z.number(),
    created_at: z.string(),
  })
  .strict();

export const GlobalSupplyResponseSchema = z
  .object({
    id: z.string(),
    request_id: z.string(),
    supplier_id: z.string(),
    supplier_name: z.string().nullable(),
    supplier_is_verified: z.boolean(),
    country_of_origin: z.string().nullable(),
    moq: z.string().nullable(),
    shipping_time_days: z.number().nullable(),
    incoterms: z.string().nullable(),
    delivery_estimate: z.string().nullable(),
    price_quote: z.string().nullable(),
    currency: z.string(),
    message: z.string().nullable(),
    status: GlobalSupplyResponseStatusEnumZ,
    is_mine: z.boolean(),
    created_at: z.string(),
  })
  .strict();

// A ranked directory supplier surfaced for a request. match_reason explains the
// ranking ("industry + exports to EG"), never a fabricated score.
export const SupplierMatchSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_verified: z.boolean(),
    industry: z.string().nullable(),
    hq_country: z.string().nullable(),
    logo_url: z.string().nullable(),
    match_reason: z.string(),
  })
  .strict();

export const GlobalSupplyDetailSchema = GlobalSupplyRequestSchema.extend({
  responses: z.array(GlobalSupplyResponseSchema),
  supplier_matches: z.array(SupplierMatchSchema),
  viewer_is_buyer: z.boolean(),
}).strict();

export type GlobalSupplyRequestDTO = z.infer<typeof GlobalSupplyRequestSchema>;
export type GlobalSupplyResponseDTO = z.infer<typeof GlobalSupplyResponseSchema>;
export type GlobalSupplyDetailDTO = z.infer<typeof GlobalSupplyDetailSchema>;

export const GlobalSupplyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  status: GlobalSupplyStatusEnumZ.optional(),
  industry: industryEnumZ.optional(),
  destination_country: z.string().trim().max(80).optional(),
});

export const CreateGlobalSupplySchema = z
  .object({
    product_text: z.string().trim().min(3).max(500),
    category: z.enum(["car", "real_estate", "industrial"]).optional(),
    industry: industryEnumZ.optional(),
    quantity: z.number().positive().max(1_000_000_000).nullable().optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    destination_country: z.string().trim().min(2).max(80),
    budget_max: z.number().positive().max(1_000_000_000_000).nullable().optional(),
    currency: z.string().trim().min(1).max(8).default("EGP"),
    incoterms: IncotermsEnumZ.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const GlobalSupplyCreateResultSchema = z.object({ id: z.string() }).strict();

export const RespondGlobalSupplySchema = z
  .object({
    country_of_origin: z.string().trim().max(80).nullable().optional(),
    moq: z.number().positive().max(1_000_000_000).nullable().optional(),
    shipping_time_days: z.number().int().min(0).max(3650).nullable().optional(),
    incoterms: IncotermsEnumZ.nullable().optional(),
    delivery_estimate: z.string().trim().max(200).nullable().optional(),
    price_quote: z.number().positive().max(1_000_000_000_000).nullable().optional(),
    currency: z.string().trim().min(1).max(8).default("EGP"),
    message: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const GlobalSupplyResponseResultSchema = z
  .object({ id: z.string(), submitted: z.boolean() })
  .strict();

/* ── Market Intelligence ───────────────────────────────── */

// A single trend computed LIVE from real listings/interactions/leads. Never a
// fabricated figure: low samples honestly report direction "insufficient" and
// data_quality "insufficient". `segment` is a stable key the client localizes.
export const MarketTrendSchema = z
  .object({
    segment: z.string(),
    segment_label: z.string(),
    metric: z.enum(["avg_price", "listing_volume", "demand", "lead_volume"]),
    direction: z.enum(["up", "down", "stable", "insufficient"]),
    change_pct: z.number().nullable(),
    change_display: z.string(),
    current_value_display: z.string().nullable(),
    period_label: z.string(),
    sample_size: z.number(),
    data_quality: z.enum(["high", "medium", "low", "insufficient"]),
  })
  .strict();

export type MarketTrend = z.infer<typeof MarketTrendSchema>;

// LIVE market intelligence payload. period_label + generated_at travel in the
// body (not envelope meta) so the client can render provenance honestly.
export const MarketTrendsResultSchema = z
  .object({
    trends: z.array(MarketTrendSchema),
    period_label: z.string(),
    generated_at: z.string(),
  })
  .strict();

export const MarketTrendsQuerySchema = z.object({
  category: z.enum(["car", "real_estate", "industrial"]).optional(),
  metric: z.enum(["avg_price", "listing_volume", "demand", "lead_volume"]).optional(),
});

