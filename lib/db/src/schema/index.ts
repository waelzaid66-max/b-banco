import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── ENUMS ─────────────────────────────────────────────── */

export const userRoleEnum = pgEnum("user_role", [
  "individual",
  "dealer",
  "company",
  "enterprise",
]);

// Internal staff role for the BANCO team. This is a SEPARATE axis from
// `userRoleEnum` (the business/account type). It drives the server-enforced
// permission matrix for the Admin Control Center. "user" = no staff access.
export const staffRoleEnum = pgEnum("staff_role", [
  "owner",
  "admin",
  "moderator",
  "support",
  "user",
]);

export const listingCategoryEnum = pgEnum("listing_category", [
  "car",
  "real_estate",
  "industrial",
]);

export const listingStatusEnum = pgEnum("listing_status", [
  "active",
  "sold",
  "archived",
  "draft",
  "pending_approval",
  // Moderation lifecycle (Admin Control Center). `pending_review` is the queue
  // entry state for user-flagged / high-risk listings; admins move them to
  // `approved` / `rejected` / `flagged` (or `archived`).
  "pending_review",
  "approved",
  "rejected",
  "flagged",
]);

export const mediaTypeEnum = pgEnum("media_type", ["image", "video"]);

export const paymentModeEnum = pgEnum("payment_mode", [
  "cash",
  "seller_installment",
  "bank_finance",
]);

// Who underwrites a financing option. Drives the provider badge shown on the
// offer (e.g. "CIB Auto Finance" vs an in-house seller plan). Default "seller"
// keeps existing seller-installment rows valid without a backfill.
export const paymentProviderEnum = pgEnum("payment_provider", [
  "seller",
  "bank",
  "dealer",
  "supplier",
]);

export const leadActionEnum = pgEnum("lead_action", [
  "whatsapp",
  "call",
  "chat",
  "finance_request",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "closed",
]);

// CRM workflow status for the admin bank-financing pipeline. A SEPARATE axis
// from the generic lead_status: a finance-request lead flows new → forwarded
// (handed to an intermediary bank/financier) → contacted → closed, with
// rejected as a terminal negative outcome.
export const financingStatusEnum = pgEnum("financing_status", [
  "new",
  "forwarded",
  "contacted",
  "closed",
  "rejected",
]);

export const adTypeEnum = pgEnum("ad_type", [
  "featured",
  "native_feed",
  "top_search",
]);

export const auditEventEnum = pgEnum("audit_event_type", [
  "blocked_lead",
  "suspicious_click",
  "invalid_impression",
  "flagged_listing",
  "price_outlier",
  "spam_content",
  "rate_limit_exceeded",
  "shadow_ban",
  // Manual moderation/admin action taken from the Admin Control Center
  // (approve/reject/archive/remove-duplicate listing, ban/unban user).
  "admin_action",
]);

export const auditSeverityEnum = pgEnum("audit_severity", [
  "info",
  "warning",
  "critical",
]);

/* ── ADMIN / MODERATION / SUPPORT ENUMS ────────────────── */

export const reportReasonEnum = pgEnum("report_reason", [
  "fake_price",
  "wrong_data",
  "scam",
  "duplicate",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
]);

export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open",
  "closed",
]);

// Public seller/company social link platforms shown on the profile (Task #38).
export const socialPlatformEnum = pgEnum("social_platform", [
  "instagram",
  "linkedin",
  "website",
  "whatsapp",
]);

/* ── TAXONOMY ENUMS (controlled vocabularies) ──────────── */

export const fuelTypeEnum = pgEnum("fuel_type", [
  "petrol",
  "diesel",
  "hybrid",
  "electric",
  "natural_gas",
]);

export const conditionEnum = pgEnum("condition", ["new", "used"]);

export const bodyTypeEnum = pgEnum("body_type", [
  "sedan",
  "suv",
  "hatchback",
  "coupe",
  "pickup",
  "van",
  "crossover",
  "minivan",
  "convertible",
]);

export const transmissionEnum = pgEnum("transmission", [
  "manual",
  "automatic",
  "cvt",
]);

export const propertyTypeEnum = pgEnum("property_type", [
  "apartment",
  "villa",
  "townhouse",
  "twinhouse",
  "penthouse",
  "duplex",
  "studio",
  "chalet",
  "office",
  "clinic",
  "shop",
  "land",
]);

export const finishingTypeEnum = pgEnum("finishing_type", [
  "finished",
  "semi_finished",
  "core_shell",
  "super_lux",
]);

export const ownershipTypeEnum = pgEnum("ownership_type", [
  "resale",
  "primary",
  "installment_ready",
]);

export const industrialTypeEnum = pgEnum("industrial_type", [
  "factory",
  "warehouse",
  "machine",
  "production_line",
  "land",
  // Additive (Task #33): raw materials are the upstream root of the industrial
  // supply-chain graph (raw_material → machine → production_line → factory).
  "raw_material",
]);

export const industryEnum = pgEnum("industry", [
  "food",
  "beverage",
  "plastic",
  "textile",
  "pharmaceutical",
  "chemical",
  "engineering",
  "other",
]);

export const zoneTypeEnum = pgEnum("zone_type", [
  "urban",
  "suburb",
  "coastal",
  "industrial",
  "new_city",
]);

// Logistics & delivery (Task #40, additive). Declared here — BEFORE
// listingAttributes — because that table references them. All optional/nullable;
// seller-provided, never required by the normalization taxonomy pipeline.
export const originTypeEnum = pgEnum("origin_type", ["local", "imported"]);

export const shippingMethodEnum = pgEnum("shipping_method", [
  "container",
  "bulk",
  "air",
]);

/* ── BILLING / MONETIZATION ENUMS ──────────────────────── */

// Ledger entry kind. The transactions table is an append-only journal of
// completed money facts — there is no per-row status (pending state lives in
// payment_intents). Reversals are NEW rows (refund/adjustment), never updates.
export const transactionTypeEnum = pgEnum("transaction_type", [
  "wallet_topup", // credit: money added to the wallet (top-up settled)
  "boost_charge", // debit: paid to promote a listing
  "subscription_charge", // debit: paid for a subscription period
  "lead_charge", // debit: cost-per-lead billed to a business seller
  "refund", // credit: reversal of a prior charge
  "adjustment", // credit/debit: manual/opening correction
]);

// Promo ad credit ledger entry types. Movements of the SEPARATE virtual
// ad-only allowance — never mixed with the real-money transaction_type enum.
export const promoAdTransactionTypeEnum = pgEnum("promo_ad_transaction_type", [
  "grant", // credit: monthly promo allowance granted
  "consume", // debit: promo spent on a boost
  "expire", // debit: unused balance cleared at month rollover / expiry
  "reset", // debit: balance zeroed on campaign renew/reset
]);

// Egyptian payment rails for wallet top-up / subscription. `wallet` denotes an
// internal wallet-funded charge (no external rail). Real PSP settlement is
// handled behind a stubbed provider boundary (PaymentProvider).
export const paymentMethodEnum = pgEnum("payment_method", [
  "vodafone_cash",
  "fawry",
  "instapay",
  "bank_transfer",
  "wallet",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "expired",
  "cancelled",
  "pending",
]);

// Outcome of attempting to bill a captured lead. Only valid leads (passing
// AbuseService.validateLead) ever reach billing; an unaffordable charge records
// `failed` but never blocks lead capture; individuals are `not_billable`.
export const leadBillingStatusEnum = pgEnum("lead_billing_status", [
  "charged",
  "failed",
  "not_billable",
]);

export const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "pending",
  "completed",
  "failed",
  "expired",
]);

export const paymentIntentPurposeEnum = pgEnum("payment_intent_purpose", [
  "wallet_topup",
  "subscription",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "paid",
  "void",
]);

/* ── MASTER DATA / REFERENCE TABLES ────────────────────── */

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Canonical / English display name. Kept as-is so every existing query,
    // insert and the auto-learn path (learnBrand) stay byte-compatible.
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    category: listingCategoryEnum("category").notNull().default("car"),
    // ── Global brand-reference metadata (ADDITIVE, all optional/defaulted) ──
    // Enriches the SAME table the marketplace already runs on, so search,
    // filters, the create form and admin pick it up with no API/logic change and
    // ZERO duplication. Auto-learned brands simply carry the defaults until an
    // admin enriches them. Kept flat here (not a parallel table) precisely to
    // avoid a second source of truth; the brand→model→…→variant hierarchy already
    // exists via the models / car_variants tables below.
    nameAr: text("name_ar"),
    country: text("country"),
    parentCompany: text("parent_company"),
    foundedYear: integer("founded_year"),
    logoUrl: text("logo_url"),
    isActive: boolean("is_active").notNull().default(true),
    isPremium: boolean("is_premium").notNull().default(false),
    isElectric: boolean("is_electric").notNull().default(false),
    isCommercial: boolean("is_commercial").notNull().default(false),
    popularity: integer("popularity").notNull().default(0),
    searchKeywords: jsonb("search_keywords").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_brands_slug").on(table.slug),
    index("idx_brands_category").on(table.category),
    index("idx_brands_active").on(table.isActive),
    index("idx_brands_popularity").on(table.popularity),
  ]
);

export const models = pgTable(
  "models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .references(() => brands.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    bodyType: bodyTypeEnum("body_type"),
    yearStart: integer("year_start"),
    yearEnd: integer("year_end"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_models_brand").on(table.brandId),
    index("idx_models_slug").on(table.slug),
  ]
);

export const carVariants = pgTable(
  "car_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelId: uuid("model_id")
      .references(() => models.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("idx_variants_model").on(table.modelId)]
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    city: text("city").notNull(),
    area: text("area").notNull(),
    slug: text("slug").notNull().unique(),
    zoneType: zoneTypeEnum("zone_type").notNull().default("urban"),
    // Area centroid. Listings without their own coordinates fall back to this
    // so a future map view can plot every item. numeric(10,7) ≈ 1cm precision.
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_locations_slug").on(table.slug),
    index("idx_locations_city").on(table.city),
  ]
);

/* ── REAL-ESTATE / INDUSTRIAL TAXONOMY REFERENCE TABLES ── */

export const propertyTypes = pgTable("property_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const finishingTypes = pgTable("finishing_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ownershipTypes = pgTable("ownership_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const industrialTypes = pgTable("industrial_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const industries = pgTable("industries", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

/* ── USERS ─────────────────────────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Internal default account number, assigned automatically to every user.
  // Deterministically derived from the user's id (12 hex chars) so it is
  // stable, unique, and computed by Postgres for new and existing rows alike —
  // no application code or backfill required. Surfaced on /me and in the Admin
  // Control Center for internal account management.
  accountNumber: text("account_number")
    .generatedAlwaysAs(
      sql`'BNC-' || upper(substring(replace(id::text, '-', '') from 1 for 12))`,
    )
    .unique(),
  clerkId: text("clerk_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("individual"),
  // Admin Control Center access. Orthogonal to `role`: an admin may also be a
  // dealer/individual. Server-side admin guard gates every admin endpoint on
  // this flag; the admin web app gates on the `is_admin` field of /v1/me.
  isAdmin: boolean("is_admin").notNull().default(false),
  // Internal staff role (Owner/Admin/Moderator/Support) — a separate axis from
  // `role` (the business/account type). Drives the server-enforced permission
  // matrix for the Admin Control Center. The coarse `isAdmin` flag is kept in
  // lock-step as a derived mirror of (staffRole !== 'user'): it stays the gate
  // every admin route checks first, while staffRole grades what each staff
  // member may do. Default 'user' = an ordinary marketplace account.
  staffRole: staffRoleEnum("staff_role").notNull().default("user"),
  isVerified: boolean("is_verified").default(false),
  walletBalance: numeric("wallet_balance").notNull().default("0"),
  // ── Promo ad credit (separate VIRTUAL ad-only allowance) ─────────────
  // NOT real money, NOT withdrawable, and NEVER part of the
  // wallet_balance == SUM(transactions.amount) invariant. Auto-granted
  // monthly, tiered by verification, use-it-or-lose-it. Mutated ONLY by
  // PromoAdCreditService and mirrored by the signed-delta
  // promo_ad_transactions ledger. Consumed before the real wallet on boost.
  promoAdBalance: numeric("promo_ad_balance", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  // When the current promo balance lapses (use-it-or-lose-it). Null = none.
  promoAdBalanceExpiresAt: timestamp("promo_ad_balance_expires_at"),
  // Abuse control: a shadow-banned user's listings are hidden from the public
  // feed/search without notifying them. Set by automated escalation or admins.
  isShadowBanned: boolean("is_shadow_banned").notNull().default(false),
  // Dealer quality score (0..100): blend of response rate, lead conversion and
  // listing quality. Used as a ranking/visibility modifier; null = not computed.
  qualityScore: integer("quality_score"),
  companyDetails: jsonb("company_details"),
  createdAt: timestamp("created_at").defaultNow(),
  // Soft-delete timestamp for Google Play account-deletion compliance.
  // Non-null => the user requested deletion; PII is anonymized in the same
  // atomic transaction and the auth-provider account is removed afterwards.
  deletedAt: timestamp("deleted_at"),
});

/* ── LISTINGS ──────────────────────────────────────────── */

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    category: listingCategoryEnum("category").notNull(),
    basePriceCash: numeric("base_price_cash").notNull(),
    location: text("location").notNull(),
    locationId: uuid("location_id").references(() => locations.id),
    // Listing-level coordinate override; falls back to the location centroid
    // when null. Lets a specific unit sit on its exact spot on the map.
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    status: listingStatusEnum("status").default("active"),
    trustScore: integer("trust_score").default(0),
    isDuplicate: boolean("is_duplicate").default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    // Abuse control: a flagged listing (spam keywords, severe abuse) is hidden
    // from the public feed/search. flagReason records why for the audit trail.
    isFlagged: boolean("is_flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    // Recycle/renew: when set, the listing sorts by bumped_at instead of
    // created_at in recency feeds (COALESCE(bumped_at, created_at)). NEVER
    // overwrites created_at, so the true publish date is preserved.
    bumpedAt: timestamp("bumped_at"),
    // Buyer "request/wanted" post (image + description, price optional). A
    // boolean — not a new category — so it composes with the car/real_estate/
    // industrial verticals and the existing feed/search/cursor paths.
    isRequest: boolean("is_request").notNull().default(false),
    // Denormalized engagement counter maintained by SaveService on toggle. Feeds
    // the ranking score so the most-saved listings resurface — applied on the
    // next fetch (no fake realtime push).
    savesCount: integer("saves_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_listings_created_at").on(table.createdAt),
    index("idx_listings_price").on(table.basePriceCash),
    index("idx_listings_status").on(table.status),
    index("idx_listings_category").on(table.category),
    index("idx_listings_user").on(table.userId),
    index("idx_listings_location").on(table.locationId),
    index("idx_listings_trust").on(table.trustScore),
    index("idx_listings_duplicate").on(table.isDuplicate),
    index("idx_listings_flagged").on(table.isFlagged),
    index("idx_listings_is_request").on(table.isRequest),
    index("idx_listings_saves").on(table.savesCount),
    // GIN trigram indexes — accelerate the search engine's ILIKE '%term%' on
    // title/description at catalog scale WITHOUT changing query semantics.
    // Require pg_trgm (created by api-server bootstrap; also self-healed there
    // via CREATE INDEX IF NOT EXISTS for environments that predate this schema).
    index("idx_listings_title_trgm").using("gin", table.title.op("gin_trgm_ops")),
    index("idx_listings_description_trgm").using(
      "gin",
      table.description.op("gin_trgm_ops"),
    ),
    // Recency ordering uses COALESCE(bumped_at, created_at) DESC, id; this
    // composite covers the status-filtered sort prefix.
    index("idx_listings_recency").on(
      table.status,
      table.bumpedAt,
      table.createdAt,
    ),
    // Composite index matching the common feed/search filter pattern:
    // status (active) + category + price range.
    index("idx_listings_feed_filter").on(
      table.status,
      table.category,
      table.basePriceCash,
    ),
  ]
);

/* ── LISTING ATTRIBUTES (JSONB) ─────────────────────────── */

export const listingAttributes = pgTable(
  "listing_attributes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .unique()
      .notNull(),
    specs: jsonb("specs").notNull(),
    // Controlled taxonomy references (resolved by the normalization pipeline)
    brandId: uuid("brand_id").references(() => brands.id),
    modelId: uuid("model_id").references(() => models.id),
    variantId: uuid("variant_id").references(() => carVariants.id),
    // Car enums
    fuelType: fuelTypeEnum("fuel_type"),
    condition: conditionEnum("condition"),
    bodyType: bodyTypeEnum("body_type"),
    transmission: transmissionEnum("transmission"),
    // Real-estate enums
    propertyType: propertyTypeEnum("property_type"),
    finishingType: finishingTypeEnum("finishing_type"),
    ownershipType: ownershipTypeEnum("ownership_type"),
    // Industrial enums
    industrialType: industrialTypeEnum("industrial_type"),
    industry: industryEnum("industry"),
    // Taxonomy reference FKs (resolved alongside the enums by normalization)
    propertyTypeId: uuid("property_type_id").references(() => propertyTypes.id),
    finishingTypeId: uuid("finishing_type_id").references(() => finishingTypes.id),
    ownershipTypeId: uuid("ownership_type_id").references(() => ownershipTypes.id),
    industrialTypeId: uuid("industrial_type_id").references(() => industrialTypes.id),
    industryId: uuid("industry_id").references(() => industries.id),
    // Logistics & delivery (Task #40, additive optional). Seller-provided,
    // nullable, validated as an optional passthrough (not the strict taxonomy
    // path). Surfaced only as ListingDetail.logistics.
    deliveryTimeDays: integer("delivery_time_days"),
    originType: originTypeEnum("origin_type"),
    countryOfOrigin: text("country_of_origin"),
    shippingMethod: shippingMethodEnum("shipping_method"),
  },
  (table) => [
    index("idx_listing_attributes_specs").using("gin", table.specs),
    index("idx_listing_attributes_brand").on(table.brandId),
    index("idx_listing_attributes_model").on(table.modelId),
    index("idx_listing_attributes_property_type").on(table.propertyType),
  ]
);

/* ── CANDIDATE ATTRIBUTES (adaptive learning — Market is the Source of Truth) ──
 * Free-form custom spec keys sellers add (Phase A) are tracked here per category.
 * A key used across enough listings BY ENOUGH DISTINCT USERS graduates from
 * "candidate" → "graduated" (a future official filter). Purely additive +
 * best-effort: nothing here ever blocks publishing. */
export const candidateAttributes = pgTable(
  "candidate_attributes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    category: listingCategoryEnum("category").notNull(),
    // Normalized (lower-cased, trimmed) custom spec key, e.g. "power capacity".
    attrKey: text("attr_key").notNull(),
    // A representative value, for human review of what this attribute holds.
    sampleValue: text("sample_value"),
    // Total listings that used this key; distinct users who used it.
    usageCount: integer("usage_count").notNull().default(0),
    userCount: integer("user_count").notNull().default(0),
    // "candidate" → tracked/searchable; "graduated" → promoted to official.
    status: text("status").notNull().default("candidate"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_candidate_attr").on(table.category, table.attrKey),
    index("idx_candidate_attr_status").on(table.status),
  ]
);

// One row per (candidate, user) — lets userCount reflect DISTINCT users so a
// single seller can't inflate a key into graduation on their own.
export const candidateAttributeSeen = pgTable(
  "candidate_attribute_seen",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .references(() => candidateAttributes.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("uniq_candidate_seen").on(table.candidateId, table.userId)]
);

/* ── LISTING MEDIA ─────────────────────────────────────── */

export const listingMedia = pgTable(
  "listing_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    type: mediaTypeEnum("type").notNull(),
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    isThumbnail: boolean("is_thumbnail").default(false),
    sortOrder: integer("sort_order").default(0),
  },
  (table) => [index("idx_media_listing").on(table.listingId)]
);

/* ── PAYMENT OPTIONS ───────────────────────────────────── */

export const paymentOptions = pgTable(
  "payment_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    mode: paymentModeEnum("mode").notNull(),
    downPayment: numeric("down_payment"),
    monthlyPayment: numeric("monthly_payment"),
    durationMonths: integer("duration_months"),
    isIslamicCompliant: boolean("is_islamic_compliant").default(false),
    // Provider + display name behind this option (e.g. bank "CIB Auto Finance").
    provider: paymentProviderEnum("provider").notNull().default("seller"),
    providerName: text("provider_name"),
    // Conventional (reducing-balance) nominal annual rate %. Mutually exclusive
    // with profitRatePct. The financing engine amortizes from this.
    annualRatePct: numeric("annual_rate_pct"),
    // Islamic flat total profit margin %. NEVER surfaced as a rate/APR to the
    // client — the engine converts it to a fixed total + monthly only.
    profitRatePct: numeric("profit_rate_pct"),
  },
  (table) => [index("idx_payment_listing").on(table.listingId)]
);

/* ── INTERACTIONS ──────────────────────────────────────── */

export const interactions = pgTable(
  "interactions",
  {
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .primaryKey(),
    views: integer("views").default(0),
    clicks: integer("clicks").default(0),
    whatsappClicks: integer("whatsapp_clicks").default(0),
    callClicks: integer("call_clicks").default(0),
    financeRequests: integer("finance_requests").default(0),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("idx_interactions_listing").on(table.listingId)]
);

/* ── ADS ───────────────────────────────────────────────── */

export const ads = pgTable(
  "ads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    sellerId: uuid("seller_id").references(() => users.id).notNull(),
    adType: adTypeEnum("ad_type").notNull().default("native_feed"),
    isActive: boolean("is_active").default(true),
    startsAt: timestamp("starts_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    // Ad-budget protection. Only impressions from real users with a valid
    // session consume budget; bot/invalid impressions are dropped. When
    // budgetSpent reaches budgetTotal the ad auto-deactivates.
    budgetTotal: numeric("budget_total"),
    budgetSpent: numeric("budget_spent").notNull().default("0"),
    costPerImpression: numeric("cost_per_impression").notNull().default("0"),
    // Snapshot of the seller's plan ranking multiplier at boost time. The feed
    // surfaces higher-weighted boosts first, but ONLY while the ad is active and
    // unexpired (time-bound), so the weight expires with the boost.
    rankingWeight: numeric("ranking_weight").notNull().default("1"),
    impressions: integer("impressions").notNull().default(0),
    billableImpressions: integer("billable_impressions").notNull().default(0),
    // Idempotency guard for a boost request: a retried boostListing with the
    // same key returns THIS ad and never re-consumes promo or re-charges the
    // wallet. Unique when non-null (Postgres allows multiple nulls).
    boostIdempotencyKey: text("boost_idempotency_key").unique(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_ads_active").on(table.isActive),
    index("idx_ads_expires").on(table.expiresAt),
    index("idx_ads_seller").on(table.sellerId),
  ]
);

/* ── AUDIT LOG ─────────────────────────────────────────── */

// Durable, shared audit trail for abuse/revenue-protection events. Written by
// the abuse-control layer (blocked leads, invalid impressions, flagged
// listings, rate-limit hits, shadow bans) and later consumed read-only by the
// Admin Control Center. Intentionally append-only.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: auditEventEnum("event_type").notNull(),
    severity: auditSeverityEnum("severity").notNull().default("warning"),
    // The actor who triggered the event (e.g. the clicking buyer). Nullable for
    // anonymous traffic identified only by ip/deviceId.
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    // The user the event is about (e.g. the dealer being protected, or the
    // shadow-banned user).
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    adId: uuid("ad_id").references(() => ads.id, { onDelete: "set null" }),
    ip: text("ip"),
    deviceId: text("device_id"),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_audit_event").on(table.eventType),
    index("idx_audit_created").on(table.createdAt),
    index("idx_audit_subject_user").on(table.subjectUserId),
    index("idx_audit_actor_user").on(table.actorUserId),
    index("idx_audit_listing").on(table.listingId),
  ]
);

/* ── DURABLE ABUSE COUNTERS ────────────────────────────── */

/**
 * Backing store for the sliding-window rate/abuse counters (AbuseService).
 * One row per event; the count within a window is `count(*) WHERE event_at >
 * now() - window`. Durable so the limits survive a process restart and are
 * shared across instances (a restart can no longer reset an abuser's budget).
 * `counter_name` namespaces independent counters so their keys never collide.
 */
export const rateEvents = pgTable(
  "rate_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    counterName: text("counter_name").notNull(),
    bucketKey: text("bucket_key").notNull(),
    eventAt: timestamp("event_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_rate_events_lookup").on(table.counterName, table.bucketKey, table.eventAt),
    index("idx_rate_events_at").on(table.eventAt),
  ]
);

/**
 * Backing store for last-seen-timestamp dedup ("was this key seen within the
 * TTL?"). Durable counterpart of the in-memory DedupStore. `store_name`
 * namespaces independent dedup stores; (store_name, dedup_key) is the PK so an
 * atomic INSERT … ON CONFLICT decides duplicate-vs-new in a single round trip.
 */
export const dedupKeys = pgTable(
  "dedup_keys",
  {
    storeName: text("store_name").notNull(),
    dedupKey: text("dedup_key").notNull(),
    seenAt: timestamp("seen_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.storeName, table.dedupKey] }),
    index("idx_dedup_keys_seen_at").on(table.seenAt),
  ]
);

export type RateEvent = typeof rateEvents.$inferSelect;
export type DedupKeyRow = typeof dedupKeys.$inferSelect;

/* ── LEAD HISTORY ──────────────────────────────────────── */

export const leadHistory = pgTable(
  "lead_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    buyerId: uuid("buyer_id").references(() => users.id),
    sellerId: uuid("seller_id").references(() => users.id).notNull(),
    actionType: leadActionEnum("action_type").notNull(),
    status: leadStatusEnum("status").default("new"),
    buyerName: text("buyer_name"),
    buyerPhone: text("buyer_phone"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_lead_listing").on(table.listingId),
    index("idx_lead_seller").on(table.sellerId),
    index("idx_lead_created").on(table.createdAt),
  ]
);

/* ── LEAD TOKENS ────────────────────────────────────── */

// Single-use tokens embedded in the listing-detail response for authenticated
// non-owner viewers. POST /leads/contact requires one, ensuring a phone reveal
// can only happen after the server has observed a listing-detail load.
// This prevents forged billable leads via direct API calls.
export const leadTokens = pgTable(
  "lead_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    viewerClerkId: text("viewer_clerk_id").notNull(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_lead_tokens_viewer").on(table.viewerClerkId, table.listingId),
    index("idx_lead_tokens_expires").on(table.expiresAt),
  ]
);
export type LeadToken = typeof leadTokens.$inferSelect;

/* ── SAVED LISTINGS ────────────────────────────────────── */

export const savedListings = pgTable(
  "saved_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    // One save per (user, listing). This is the integrity anchor for the
    // denormalized listings.saves_count: with it, the toggle's
    // onConflictDoNothing increment + delete-gated decrement can never
    // double-count or create duplicate saves under concurrency.
    uniqueIndex("uniq_saved_user_listing").on(table.userId, table.listingId),
    index("idx_saved_listing").on(table.listingId),
  ]
);

/* ── LISTING COMMENTS / Q&A (Task #39) ─────────────────── */

// Public questions & answers on a listing. A flat thread: a top-level comment
// has `parentId = null` (a question); a reply (typically the seller's answer)
// references its parent. Any authenticated user may ask; the listing owner is
// notified of new questions and the question author of new replies. Deleting a
// listing (or a parent comment) cascades its comments/replies.
export const listingComments = pgTable(
  "listing_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    authorId: uuid("author_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => listingComments.id, {
      onDelete: "cascade",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_comment_listing").on(table.listingId),
    index("idx_comment_parent").on(table.parentId),
    index("idx_comment_created").on(table.createdAt),
  ]
);

/* ── SELLER REVIEWS / RATINGS (Task #39) ───────────────── */

// A buyer's rating + optional written review of a seller. Restricted (enforced
// in the service) to authors who have a real interaction with the seller (a
// conversation or a recorded lead) — never a self-review. One review per
// (seller, author) tuple; re-submitting updates the existing row. Aggregated
// into the seller's public rating and folded into the dealer quality score.
export const sellerReviews = pgTable(
  "seller_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    authorId: uuid("author_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    rating: integer("rating").notNull(),
    body: text("body"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_seller_review_author").on(table.sellerId, table.authorId),
    index("idx_review_seller").on(table.sellerId),
    index("idx_review_created").on(table.createdAt),
    check("rating_range", sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
  ]
);

/* ── MESSAGING (internal direct chat) ──────────────────── */

// A conversation is the unique 3-tuple (listing, buyer, seller). The buyer is
// the party who initiates contact on a listing; the seller is the listing
// owner. Unread counters are denormalized per side so the inbox list can show
// badges without scanning the messages table.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    buyerId: uuid("buyer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    sellerId: uuid("seller_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    lastMessageText: text("last_message_text"),
    lastMessageAt: timestamp("last_message_at"),
    buyerUnread: integer("buyer_unread").notNull().default(0),
    sellerUnread: integer("seller_unread").notNull().default(0),
    // Per-participant soft-hide (Task #71). "Delete conversation" hides the thread
    // only for the requester; the counterparty keeps it. A new message clears both
    // so the thread reappears for whoever had hidden it.
    buyerDeletedAt: timestamp("buyer_deleted_at"),
    sellerDeletedAt: timestamp("seller_deleted_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_conversation_tuple").on(
      table.listingId,
      table.buyerId,
      table.sellerId
    ),
    index("idx_conversation_buyer").on(table.buyerId),
    index("idx_conversation_seller").on(table.sellerId),
    index("idx_conversation_last_msg").on(table.lastMessageAt),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    senderId: uuid("sender_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").notNull(),
    // Optional single image attachment (Task #71). Stores the public serving URL
    // returned by /v1/uploads/request-url. Text-only messages leave this null.
    mediaUrl: text("media_url"),
    // Kind of the mediaUrl attachment: "image" | "video" | "audio" (voice note).
    // Null for text-only or legacy image messages (treated as image).
    mediaKind: text("media_kind"),
    // Emoji reactions, shaped { "<emoji>": [userId, ...] }. Null/absent = none.
    reactions: jsonb("reactions"),
    // Reply/quote: the in-conversation message this one replies to (nullable).
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    // Shared listing card: a listing referenced inside the chat (nullable).
    listingRefId: uuid("listing_ref_id").references(() => listings.id, {
      onDelete: "set null",
    }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_message_conversation").on(table.conversationId),
    index("idx_message_created").on(table.createdAt),
  ]
);

/* ── NOTIFICATIONS (in-app) ────────────────────────────── */

export const notificationTypeEnum = pgEnum("notification_type", [
  "message",
  "lead",
  "system",
  // Additive (Task #33): RFQ lifecycle events (new offer received / offer
  // accepted) so the mobile client can route distinctly on tap.
  "rfq",
  // Additive (Task #38): saved-search match ("new listing in your interest")
  // and price-drop alerts on saved listings. Per-category mute keys off these.
  "new_match",
  "price_drop",
  // Additive (Task #39): a new question/answer on the seller's listing, and a
  // new rating/review left on the seller's profile.
  "comment",
  "review",
  // Additive (Task #40): a new interest on the owner's investment opportunity,
  // and a supplier response to the buyer's global-supply request. Distinct so
  // the mobile client deep-links to the correct B2B surface on tap.
  "investment",
  "global_supply",
]);

// In-app notification feed. `data` holds typed deep-link ids (conversation_id,
// listing_id, lead_id) the mobile client uses to route on tap. This powers the
// in-app bell + badge via polling, and (Task #102) is the single chokepoint
// that also fans out to remote push via registered device tokens (see
// pushTokens below). Per-category mute on notification_preferences suppresses
// BOTH the in-app row and the push for that category.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_notification_user").on(table.userId),
    index("idx_notification_created").on(table.createdAt),
  ]
);

// Per-device Expo push tokens (Task #102). One row per physical device token;
// `token` is globally unique so re-registering the same device under a new
// user reassigns ownership (onConflictDoUpdate on token). Tokens are pruned
// when Expo reports DeviceNotRegistered. `platform` is a free-form hint
// (ios/android/web) used only for diagnostics.
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull(),
    platform: text("platform"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_push_token").on(table.token),
    index("idx_push_token_user").on(table.userId),
  ]
);

/* ── IDENTITY: SOCIAL LINKS / NOTIF PREFS / SAVED SEARCHES (Task #38) ─ */

// Public seller/company social links shown on the profile. One row per
// (user, platform); value is a URL (website/linkedin/instagram) or a phone
// (whatsapp) — validated/normalized server-side. Display-ready.
export const userSocialLinks = pgTable(
  "user_social_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    platform: socialPlatformEnum("platform").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_user_social_platform").on(table.userId, table.platform),
    index("idx_user_social_user").on(table.userId),
  ]
);

// Per-user, per-category notification preferences. Absence of a row = enabled
// (defaults are implicit). `type` mirrors notification_type so muting a
// category suppresses creation of that notification type for the user.
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: notificationTypeEnum("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_notif_pref").on(table.userId, table.type),
    index("idx_notif_pref_user").on(table.userId),
  ]
);

// A saved search + optional price-tracking. `filters` holds the structured
// query (category, location, price range, taxonomy ids) the search screen
// builds. New-match alerts fire when a newly created listing matches an
// alerts-enabled saved search; lastNotifiedListingAt dedupes them.
export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    query: text("query"),
    category: listingCategoryEnum("category"),
    filters: jsonb("filters"),
    priceMin: numeric("price_min"),
    priceMax: numeric("price_max"),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    lastNotifiedListingAt: timestamp("last_notified_listing_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_saved_search_user").on(table.userId),
    index("idx_saved_search_alerts").on(table.alertsEnabled),
  ]
);

/* ── STORIES (24h ephemeral media) ─────────────────────── */

// Ephemeral 24h media posts shown in a feed "stories" rail. Optionally linked
// to a listing for a tap-through. Expired rows are filtered at read time
// (expiresAt > now); a background sweep is out of scope. Shadow-banned authors'
// stories are hidden from everyone but themselves (see StoryService).
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    listingId: uuid("listing_id").references(() => listings.id, {
      onDelete: "set null",
    }),
    mediaUrl: text("media_url").notNull(),
    caption: text("caption"),
    createdAt: timestamp("created_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    index("idx_story_user").on(table.userId),
    index("idx_story_expires").on(table.expiresAt),
    index("idx_story_created").on(table.createdAt),
  ]
);

// One row per (story, viewer) so the rail can show seen/unseen state and a
// per-story view count without double counting.
export const storyViews = pgTable(
  "story_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .references(() => stories.id, { onDelete: "cascade" })
      .notNull(),
    viewerId: uuid("viewer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_story_view").on(table.storyId, table.viewerId),
    index("idx_story_view_story").on(table.storyId),
  ]
);

/* ── USER BEHAVIOR ─────────────────────────────────────── */

export const userBehavior = pgTable(
  "user_behavior",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    sessionId: text("session_id"),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_behavior_user").on(table.userId),
    index("idx_behavior_listing").on(table.listingId),
    index("idx_behavior_created").on(table.createdAt),
  ]
);

/* ── PLANS (governed monetization tiers) ───────────────── */

// Governed plan/tier reference data, seeded idempotently (slug = idempotent
// key). A user's effective plan is their active subscription's plan, or the
// free baseline plan for their role. ALL pricing (subscription price, boost
// price, CPL rates) is read from here server-side — never from the client.
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    // Role this plan targets; also drives free-baseline resolution.
    audience: userRoleEnum("audience").notNull().default("dealer"),
    // Whether this is the free baseline for its audience (no subscription).
    isBaseline: boolean("is_baseline").notNull().default(false),
    // Monthly price in EGP ("0" for free baselines).
    monthlyPrice: numeric("monthly_price").notNull().default("0"),
    // Max NEW listings created per calendar month (null = unlimited).
    listingQuota: integer("listing_quota"),
    // Max concurrently-active listings (null = unlimited).
    activeListingCap: integer("active_listing_cap"),
    // Flat price per boost purchase, in EGP.
    boostPrice: numeric("boost_price").notNull().default("0"),
    // Cost-per-lead rates by action type, in EGP (0 = not billed).
    cplWhatsapp: numeric("cpl_whatsapp").notNull().default("0"),
    cplCall: numeric("cpl_call").notNull().default("0"),
    cplChat: numeric("cpl_chat").notNull().default("0"),
    cplFinanceRequest: numeric("cpl_finance_request").notNull().default("0"),
    // Ranking/exposure multiplier (1 = baseline; higher = more visibility).
    rankingWeight: numeric("ranking_weight").notNull().default("1"),
    // Feature flags (analytics, bulk_import, priority_support, featured_badge…).
    features: jsonb("features"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_plans_slug").on(table.slug),
    index("idx_plans_audience").on(table.audience),
  ]
);

/* ── TRANSACTIONS (append-only money ledger) ───────────── */

// Immutable journal of every wallet money movement. balance == running SUM of
// all amounts for a user. Each row snapshots balanceAfter for auditability.
// A unique idempotency_key makes provider callbacks / replays safe (the second
// insert violates the constraint and is treated as a no-op by the caller).
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: transactionTypeEnum("type").notNull(),
    // Signed EGP amount: positive = credit (into wallet), negative = debit.
    amount: numeric("amount").notNull(),
    // Wallet balance immediately AFTER this entry was applied.
    balanceAfter: numeric("balance_after").notNull(),
    // Null for internal wallet-funded charges; set for external top-ups.
    paymentMethod: paymentMethodEnum("payment_method"),
    // Polymorphic link to the originating entity (ad / subscription /
    // lead_billing / payment_intent). referenceType names the source.
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    description: text("description"),
    idempotencyKey: text("idempotency_key").unique(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_transactions_user_created").on(table.userId, table.createdAt),
    index("idx_transactions_type").on(table.type),
    index("idx_transactions_reference").on(table.referenceType, table.referenceId),
  ]
);

/* ── SUBSCRIPTIONS ─────────────────────────────────────── */

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    planId: uuid("plan_id")
      .references(() => plans.id)
      .notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    // Snapshot of the price paid at purchase (plan price may change later).
    pricePaid: numeric("price_paid").notNull().default("0"),
    startsAt: timestamp("starts_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    autoRenew: boolean("auto_renew").notNull().default(false),
    // The wallet transaction that paid for this period (null if free/pending).
    transactionId: uuid("transaction_id"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_subscriptions_user").on(table.userId),
    index("idx_subscriptions_status").on(table.status),
    index("idx_subscriptions_expires").on(table.expiresAt),
    // At most one ACTIVE subscription per user.
    uniqueIndex("uq_subscriptions_active_user")
      .on(table.userId)
      .where(sql`status = 'active'`),
  ]
);

/* ── LEAD BILLING (cost-per-lead) ──────────────────────── */

// One row per captured lead. leadId UNIQUE makes CPL charging idempotent: a
// lead is billed exactly once. Written atomically with the lead in the same
// transaction; `failed` means the seller's wallet was short (lead still kept).
export const leadBilling = pgTable(
  "lead_billing",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .references(() => leadHistory.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    sellerId: uuid("seller_id")
      .references(() => users.id)
      .notNull(),
    buyerId: uuid("buyer_id").references(() => users.id),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    actionType: leadActionEnum("action_type").notNull(),
    status: leadBillingStatusEnum("status").notNull(),
    amountCharged: numeric("amount_charged").notNull().default("0"),
    // The ledger transaction recording the charge (null unless charged).
    transactionId: uuid("transaction_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_lead_billing_seller").on(table.sellerId),
    index("idx_lead_billing_status").on(table.status),
    index("idx_lead_billing_created").on(table.createdAt),
  ]
);

/* ── PAYMENT INTENTS (stubbed PSP boundary) ────────────── */

// Pending external payments (wallet top-up / subscription) via Egyptian rails.
// This is the clearly-stubbed provider boundary: a real PSP (Paymob/Fawry/
// Kashier) plugs in by driving status pending→completed and supplying
// providerRef. Confirmation credits the wallet / activates the subscription
// atomically and idempotently.
export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    amount: numeric("amount").notNull(),
    method: paymentMethodEnum("method").notNull(),
    purpose: paymentIntentPurposeEnum("purpose").notNull(),
    status: paymentIntentStatusEnum("status").notNull().default("pending"),
    // Reference the buyer uses to pay at the PSP (e.g. a Fawry code).
    providerRef: text("provider_ref"),
    // For subscription intents: the plan being purchased.
    planId: uuid("plan_id").references(() => plans.id),
    completedAt: timestamp("completed_at"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_payment_intents_user").on(table.userId),
    index("idx_payment_intents_status").on(table.status),
  ]
);

/* ── PAYMENT PROVIDER CONFIG (admin-managed PSP credentials) ─
 * One row per provider (e.g. "paymob"). Admin-editable from the Control Center
 * so credentials/mode can be set, swapped, and toggled without redeploying or
 * touching the secrets manager. Secret material (secret key + HMAC secret) is
 * stored ONLY as AES-256-GCM ciphertext (see lib/secretCrypto) and is never
 * returned to any client. The payment seam reads this row first and falls back
 * to environment variables when no enabled+complete row exists. */
export const paymentProviderConfig = pgTable("payment_provider_config", {
  // Provider key, e.g. "paymob". One row per provider.
  provider: text("provider").primaryKey(),
  // When false the seam ignores this row and falls back to env config.
  enabled: boolean("enabled").notNull().default(false),
  // "test" (sandbox) | "live".
  mode: text("mode").notNull().default("test"),
  // Public (non-secret) key used to build the hosted checkout URL.
  publicKey: text("public_key"),
  // Comma-separated Paymob integration ids offered at checkout.
  integrationIds: text("integration_ids"),
  // Optional API host override (default https://accept.paymob.com).
  apiBase: text("api_base"),
  // AES-256-GCM ciphertext of the PSP secret key. NEVER returned to a client.
  encSecretKey: text("enc_secret_key"),
  // AES-256-GCM ciphertext of the webhook HMAC secret. NEVER returned.
  encHmacSecret: text("enc_hmac_secret"),
  // The admin who last saved this configuration (audit pointer).
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/* ── EMAIL PROVIDER CONFIG (admin-managed delivery credentials) ─
 * One row (provider = "resend"). Admin-editable from the Control Center so the
 * transactional-email provider key, sender identity, and public app URL used in
 * email CTA links can be set/rotated/toggled without redeploying or touching the
 * secrets manager. The API key is stored ONLY as AES-256-GCM ciphertext (see
 * lib/secretCrypto) and is never returned to any client. EmailService reads this
 * row first and falls back to environment variables when no enabled row exists.
 * When no API key resolves the service stays in honest log-only mode. */
export const emailProviderConfig = pgTable("email_provider_config", {
  // Provider key, e.g. "resend". One row per provider.
  provider: text("provider").primaryKey(),
  // When false the service ignores this row and falls back to env config.
  enabled: boolean("enabled").notNull().default(false),
  // Display name in the From header, e.g. "BANCO".
  fromName: text("from_name"),
  // Sender email address, e.g. "noreply@banco.it". Must be on a verified domain.
  fromEmail: text("from_email"),
  // Verified sending domain (informational/display), e.g. "banco.it".
  sendingDomain: text("sending_domain"),
  // Optional Reply-To address shown to recipients.
  replyTo: text("reply_to"),
  // Public base URL used to build CTA links inside emails (PUBLIC_APP_URL).
  publicAppUrl: text("public_app_url"),
  // AES-256-GCM ciphertext of the provider API key. NEVER returned to a client.
  encApiKey: text("enc_api_key"),
  // The admin who last saved this configuration (audit pointer).
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/* ── PROMO AD CREDIT ───────────────────────────────────── */

// Admin-managed singleton campaign config (DB-first, like
// payment_provider_config). Exactly one row, id = 'singleton'.
export const promoAdCampaignConfig = pgTable(
  "promo_ad_campaign_config",
  {
    id: text("id").primaryKey().default("singleton"),
    // Master switch. When false the monthly grant job is a no-op.
    enabled: boolean("enabled").notNull().default(false),
    // Monthly allowance (EGP) for verified vs unverified accounts.
    verifiedMonthlyAmount: numeric("verified_monthly_amount", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("10000"),
    unverifiedMonthlyAmount: numeric("unverified_monthly_amount", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("5000"),
    // Number of monthly grants the campaign runs (monthIndex 0..N-1).
    durationMonths: integer("duration_months").notNull().default(4),
    // Bumped on every admin renew/reset so old grant ledgers can't collide
    // and a fresh campaign starts cleanly.
    campaignVersion: integer("campaign_version").notNull().default(1),
    // Campaign anchor; monthIndex is computed from this in Africa/Cairo.
    startsAt: timestamp("starts_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    check("promo_cfg_singleton", sql`${table.id} = 'singleton'`),
    check(
      "promo_cfg_amounts_nonneg",
      sql`${table.verifiedMonthlyAmount} >= 0 AND ${table.unverifiedMonthlyAmount} >= 0`,
    ),
    check(
      "promo_cfg_duration_range",
      sql`${table.durationMonths} >= 1 AND ${table.durationMonths} <= 24`,
    ),
  ],
);

// Immutable signed-delta ledger for promo credit movements. Reconciles to
// users.promo_ad_balance. NEVER mixed with the real-money transactions table.
export const promoAdTransactions = pgTable(
  "promo_ad_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: promoAdTransactionTypeEnum("type").notNull(),
    // Signed EGP delta: positive = grant, negative = consume/expire/reset.
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    // Promo balance immediately AFTER this entry was applied.
    balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
    campaignVersion: integer("campaign_version").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    description: text("description"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_promo_ad_tx_user_created").on(table.userId, table.createdAt),
    index("idx_promo_ad_tx_campaign").on(
      table.campaignVersion,
      table.createdAt,
    ),
  ],
);

// Idempotency ledger for the monthly grant job: exactly one row per
// (user, campaignVersion, monthIndex). The job inserts ON CONFLICT DO NOTHING
// and only grants for rows it actually created.
export const promoAdGrants = pgTable(
  "promo_ad_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    campaignVersion: integer("campaign_version").notNull(),
    monthIndex: integer("month_index").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_promo_grant").on(
      table.userId,
      table.campaignVersion,
      table.monthIndex,
    ),
  ],
);

/* ── INVOICES (one per ledger transaction) ─────────────── */

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    transactionId: uuid("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    amount: numeric("amount").notNull(),
    status: invoiceStatusEnum("status").notNull().default("paid"),
    lineItems: jsonb("line_items"),
    issuedAt: timestamp("issued_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_invoices_user").on(table.userId),
    index("idx_invoices_created").on(table.createdAt),
  ]
);

/* ── REPORTS (user-submitted listing reports) ──────────── */

// Owned by the Admin Control Center. A buyer/visitor flags a listing (fake
// price, wrong data, scam, duplicate). Reports surface in the moderation queue;
// filing a report does NOT change the listing's status (only an explicit admin
// moderation action hides a listing). At most one OPEN report per
// (listing, reporter) is enforced by a partial unique index.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    reporterUserId: uuid("reporter_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: reportReasonEnum("reason").notNull(),
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("open"),
    // Admin who resolved/dismissed the report + their note.
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("idx_reports_listing").on(table.listingId),
    index("idx_reports_status").on(table.status),
    index("idx_reports_created").on(table.createdAt),
    index("idx_reports_reporter").on(table.reporterUserId),
    // At most one OPEN report per (listing, reporter): blocks report-spam /
    // takedown-DoS at the DB level. App-level dedup in createReport is the first
    // line; this partial unique index is the backstop against concurrent races.
    uniqueIndex("uq_reports_open_reporter_listing")
      .on(table.listingId, table.reporterUserId)
      .where(sql`status = 'open'`),
  ]
);

/* ── SUPPORT TICKETS ───────────────────────────────────── */

// Owned by the Admin Control Center. A user opens a ticket; admins respond and
// resolve. `lastReplyAt` powers the "time since last reply" + >24h escalation
// highlighting in the support inbox.
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    category: text("category"),
    status: supportTicketStatusEnum("status").notNull().default("open"),
    // Timestamp of the most recent message (from either side). Initialized to
    // ticket creation time.
    lastReplyAt: timestamp("last_reply_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_tickets_status").on(table.status),
    index("idx_tickets_user").on(table.userId),
    index("idx_tickets_last_reply").on(table.lastReplyAt),
  ]
);

export const supportTicketMessages = pgTable(
  "support_ticket_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .references(() => supportTickets.id, { onDelete: "cascade" })
      .notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // True when the message was written by an admin (support reply).
    isAdmin: boolean("is_admin").notNull().default(false),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_ticket_messages_ticket").on(table.ticketId),
    index("idx_ticket_messages_created").on(table.createdAt),
  ]
);

/* ── B2B: SUPPLY-CHAIN GRAPH / COMPANY PROFILES / RFQ ──── */
// Additive (Task #33). All tables below are NEW and additive — they never
// alter the FeedItem core or the ListingDetail.payment contract.

// Edge kind for the industrial supply-chain graph. `feeds_into` models material
// / output flow (a raw material feeds into a machine); `part_of` models
// composition (a machine is part of a production line; a line is part of a
// factory); `compatible_with` is a symmetric accessory/interoperability hint.
export const listingLinkTypeEnum = pgEnum("listing_link_type", [
  "feeds_into",
  "part_of",
  "compatible_with",
]);

export const rfqStatusEnum = pgEnum("rfq_status", [
  "open",
  "awarded",
  "closed",
  "cancelled",
]);

export const rfqOfferStatusEnum = pgEnum("rfq_offer_status", [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
]);

// Typed directed edges between two listings forming the supply-chain graph.
// Read bidirectionally at query time (a node's incoming + outgoing edges). The
// CHECK forbids self-links; the unique index forbids duplicate edges.
export const listingLinks = pgTable(
  "listing_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromListingId: uuid("from_listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    toListingId: uuid("to_listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    relation: listingLinkTypeEnum("relation").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_listing_link").on(
      table.fromListingId,
      table.toListingId,
      table.relation
    ),
    index("idx_listing_link_from").on(table.fromListingId),
    index("idx_listing_link_to").on(table.toListingId),
    check(
      "chk_listing_link_no_self",
      sql`${table.fromListingId} <> ${table.toListingId}`
    ),
  ]
);

// Rich B2B supplier/company profile, one-to-one with a business user. Kept in a
// dedicated table (not users.companyDetails, which onboarding owns) so the
// public seller profile can carry structured trade fields + stats.
export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    about: text("about"),
    yearEstablished: integer("year_established"),
    // string[] of country names/ISO codes (display-ready, validated server-side).
    countriesImportFrom: jsonb("countries_import_from"),
    countriesExportTo: jsonb("countries_export_to"),
    minOrderValue: numeric("min_order_value"),
    minOrderUnit: text("min_order_unit"),
    monthlyCapacity: text("monthly_capacity"),
    leadTimeDays: integer("lead_time_days"),
    // string[] of certification names (ISO 9001, CE, …).
    certifications: jsonb("certifications"),
    websiteUrl: text("website_url"),
    logoUrl: text("logo_url"),
    coverUrl: text("cover_url"),
    // Directory facets (Task #40, additive optional). Lets the suppliers
    // directory filter by primary industry + HQ country without repurposing the
    // existing import/export country arrays.
    industry: industryEnum("industry"),
    hqCountry: text("hq_country"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_company_profiles_user").on(table.userId),
    index("idx_company_profiles_industry").on(table.industry),
    index("idx_company_profiles_country").on(table.hqCountry),
  ]
);

// A buyer's Request For Quote (marketplace of demand). Suppliers browse open
// RFQs and respond with offers. Awarding an offer closes the RFQ.
export const rfqs = pgTable(
  "rfqs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerId: uuid("buyer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    category: listingCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    quantity: numeric("quantity"),
    unit: text("unit"),
    targetPriceMax: numeric("target_price_max"),
    destinationCountry: text("destination_country"),
    industry: industryEnum("industry"),
    industrialType: industrialTypeEnum("industrial_type"),
    status: rfqStatusEnum("status").notNull().default("open"),
    deadline: timestamp("deadline"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_rfqs_buyer").on(table.buyerId),
    index("idx_rfqs_status").on(table.status),
    index("idx_rfqs_category").on(table.category),
    index("idx_rfqs_created").on(table.createdAt),
  ]
);

// A supplier's quote on an RFQ. One standing offer per (rfq, supplier) via the
// unique index — re-submitting updates the existing row.
export const rfqOffers = pgTable(
  "rfq_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rfqId: uuid("rfq_id")
      .references(() => rfqs.id, { onDelete: "cascade" })
      .notNull(),
    supplierId: uuid("supplier_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    priceQuote: numeric("price_quote").notNull(),
    currency: text("currency").notNull().default("EGP"),
    leadTimeDays: integer("lead_time_days"),
    moq: numeric("moq"),
    message: text("message"),
    status: rfqOfferStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_rfq_offer_supplier").on(table.rfqId, table.supplierId),
    index("idx_rfq_offers_rfq").on(table.rfqId),
    index("idx_rfq_offers_supplier").on(table.supplierId),
    index("idx_rfq_offers_status").on(table.status),
  ]
);

/* ── DRIZZLE-ZOD INFERRED TYPES ────────────────────────── */

export const insertBrandSchema = createInsertSchema(brands).omit({ id: true, createdAt: true });
export const insertModelSchema = createInsertSchema(models).omit({ id: true, createdAt: true });
export const insertCarVariantSchema = createInsertSchema(carVariants).omit({ id: true, createdAt: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, createdAt: true });
export const insertPropertyTypeSchema = createInsertSchema(propertyTypes).omit({ id: true, createdAt: true });
export const insertFinishingTypeSchema = createInsertSchema(finishingTypes).omit({ id: true, createdAt: true });
export const insertOwnershipTypeSchema = createInsertSchema(ownershipTypes).omit({ id: true, createdAt: true });
export const insertIndustrialTypeSchema = createInsertSchema(industrialTypes).omit({ id: true, createdAt: true });
export const insertIndustrySchema = createInsertSchema(industries).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type PropertyType = typeof propertyTypes.$inferSelect;
export type InsertPropertyType = z.infer<typeof insertPropertyTypeSchema>;
export type FinishingType = typeof finishingTypes.$inferSelect;
export type InsertFinishingType = z.infer<typeof insertFinishingTypeSchema>;
export type OwnershipType = typeof ownershipTypes.$inferSelect;
export type InsertOwnershipType = z.infer<typeof insertOwnershipTypeSchema>;
export type IndustrialType = typeof industrialTypes.$inferSelect;
export type InsertIndustrialType = z.infer<typeof insertIndustrialTypeSchema>;
export type Industry = typeof industries.$inferSelect;
export type InsertIndustry = z.infer<typeof insertIndustrySchema>;
export const insertListingSchema = createInsertSchema(listings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertListingAttributesSchema = createInsertSchema(listingAttributes).omit({ id: true });
export const insertListingMediaSchema = createInsertSchema(listingMedia).omit({ id: true });
export const insertPaymentOptionSchema = createInsertSchema(paymentOptions).omit({ id: true });
export const insertLeadHistorySchema = createInsertSchema(leadHistory).omit({ id: true, createdAt: true, updatedAt: true });

export type Brand = typeof brands.$inferSelect;
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Model = typeof models.$inferSelect;
export type InsertModel = z.infer<typeof insertModelSchema>;
export type CarVariant = typeof carVariants.$inferSelect;
export type InsertCarVariant = z.infer<typeof insertCarVariantSchema>;
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Listing = typeof listings.$inferSelect;
export type InsertListing = z.infer<typeof insertListingSchema>;
export type ListingAttributes = typeof listingAttributes.$inferSelect;
export type ListingMedia = typeof listingMedia.$inferSelect;
export type PaymentOption = typeof paymentOptions.$inferSelect;
export type Interaction = typeof interactions.$inferSelect;
export type Ad = typeof ads.$inferSelect;
export type LeadHistory = typeof leadHistory.$inferSelect;
export type SavedListing = typeof savedListings.$inferSelect;
export type UserBehavior = typeof userBehavior.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

export type Plan = typeof plans.$inferSelect;
export type InsertPlan = typeof plans.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;
export type LeadBilling = typeof leadBilling.$inferSelect;
export type InsertLeadBilling = typeof leadBilling.$inferInsert;
export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type InsertPaymentIntent = typeof paymentIntents.$inferInsert;
export type PaymentProviderConfigRow = typeof paymentProviderConfig.$inferSelect;
export type InsertPaymentProviderConfig =
  typeof paymentProviderConfig.$inferInsert;
export type PromoAdCampaignConfigRow =
  typeof promoAdCampaignConfig.$inferSelect;
export type InsertPromoAdCampaignConfig =
  typeof promoAdCampaignConfig.$inferInsert;
export type PromoAdTransaction = typeof promoAdTransactions.$inferSelect;
export type InsertPromoAdTransaction = typeof promoAdTransactions.$inferInsert;
export type PromoAdGrant = typeof promoAdGrants.$inferSelect;
export type InsertPromoAdGrant = typeof promoAdGrants.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;
export const insertReportSchema = createInsertSchema(reports).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSupportTicketMessageSchema = createInsertSchema(supportTicketMessages).omit({ id: true, createdAt: true });
export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicketMessage = typeof supportTicketMessages.$inferSelect;
export type InsertSupportTicketMessage = z.infer<typeof insertSupportTicketMessageSchema>;

/* ── B2B (Task #33) inferred types ─────────────────────── */
export const insertCompanyProfileSchema = createInsertSchema(companyProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertListingLinkSchema = createInsertSchema(listingLinks).omit({ id: true, createdAt: true });
export const insertRfqSchema = createInsertSchema(rfqs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRfqOfferSchema = createInsertSchema(rfqOffers).omit({ id: true, createdAt: true, updatedAt: true });
export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type InsertCompanyProfile = typeof companyProfiles.$inferInsert;
export type ListingLink = typeof listingLinks.$inferSelect;
export type InsertListingLink = typeof listingLinks.$inferInsert;
export type Rfq = typeof rfqs.$inferSelect;
export type InsertRfq = typeof rfqs.$inferInsert;
export type RfqOffer = typeof rfqOffers.$inferSelect;
export type InsertRfqOffer = typeof rfqOffers.$inferInsert;

/* ── Identity (Task #38) inferred types ────────────────── */
export const insertUserSocialLinkSchema = createInsertSchema(userSocialLinks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({ id: true, updatedAt: true });
export const insertSavedSearchSchema = createInsertSchema(savedSearches).omit({ id: true, createdAt: true, updatedAt: true });
export type UserSocialLink = typeof userSocialLinks.$inferSelect;
export type InsertUserSocialLink = typeof userSocialLinks.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type InsertSavedSearch = typeof savedSearches.$inferInsert;

/* ────────────────────────────────────────────────────────────────────────
 * B2B SUPPLY-CHAIN & INVESTMENT SURFACES (Task #40) — STRICTLY ADDITIVE.
 * New standalone entities beside listings/RFQs/company profiles. Nothing here
 * repurposes or alters the immutable FeedItem/listing contract.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── Investment Opportunities ──────────────────────────── */

export const investmentTypeEnum = pgEnum("investment_type", [
  "factory_sale",
  "business_sale",
  "production_line_investment",
  "franchise",
  "partnership",
]);

export const investmentStatusEnum = pgEnum("investment_status", [
  "draft",
  "active",
  "under_offer",
  "closed",
]);

// Provenance of the financial figures. BANCO never generates ROI/revenue — they
// are either entered by the seller or clearly labelled an estimate. This flag
// drives the non-advice disclaimer on every investment surface.
export const figuresSourceEnum = pgEnum("figures_source", [
  "seller_provided",
  "estimate",
]);

export const investmentInterestKindEnum = pgEnum("investment_interest_kind", [
  "interest",
  "request_details",
  "contact",
]);

// A capital/business opportunity (factory/business for sale, production-line
// investment, franchise, partnership). NOT a listing — financial fields live
// here and are seller-provided/labelled, never fabricated.
export const investmentOpportunities = pgTable(
  "investment_opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    investmentType: investmentTypeEnum("investment_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    industry: industryEnum("industry"),
    location: text("location").notNull(),
    locationId: uuid("location_id").references(() => locations.id),
    totalValueAmount: numeric("total_value_amount").notNull(),
    currency: text("currency").notNull().default("EGP"),
    // Seller-provided / estimate financials — all nullable, never invented.
    expectedRoiPct: numeric("expected_roi_pct"),
    paybackYears: numeric("payback_years"),
    revenueRangeMin: numeric("revenue_range_min"),
    revenueRangeMax: numeric("revenue_range_max"),
    costStructureNote: text("cost_structure_note"),
    growthPotentialNote: text("growth_potential_note"),
    figuresSource: figuresSourceEnum("figures_source").notNull().default("seller_provided"),
    coverUrl: text("cover_url"),
    status: investmentStatusEnum("status").notNull().default("active"),
    // Abuse control parity with listings — flagged rows are hidden publicly.
    isFlagged: boolean("is_flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_investments_owner").on(table.ownerId),
    index("idx_investments_type").on(table.investmentType),
    index("idx_investments_status").on(table.status),
    index("idx_investments_industry").on(table.industry),
    index("idx_investments_created").on(table.createdAt),
    index("idx_investments_flagged").on(table.isFlagged),
  ]
);

// A user's expression of interest on an opportunity (Submit Interest / Request
// Details / Contact Owner). One standing row per (investment, user) — the kind
// reflects the latest action. The owner is notified via NotificationService.
export const investmentInterests = pgTable(
  "investment_interests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    investmentId: uuid("investment_id")
      .references(() => investmentOpportunities.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    kind: investmentInterestKindEnum("kind").notNull().default("interest"),
    message: text("message"),
    contactPhone: text("contact_phone"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_investment_interest").on(table.investmentId, table.userId),
    index("idx_investment_interest_investment").on(table.investmentId),
    index("idx_investment_interest_user").on(table.userId),
  ]
);

/* ── Suppliers Directory: company follows ──────────────── */

// A directional follow edge: follower → company (a business user). Unique per
// pair; self-follow forbidden. follower_count / is_following are derived.
export const companyFollows = pgTable(
  "company_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    followerId: uuid("follower_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    companyUserId: uuid("company_user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_company_follow").on(table.followerId, table.companyUserId),
    index("idx_company_follow_follower").on(table.followerId),
    index("idx_company_follow_company").on(table.companyUserId),
    check(
      "chk_company_follow_no_self",
      sql`${table.followerId} <> ${table.companyUserId}`
    ),
  ]
);

/* ── Global Supply / Import-Export ─────────────────────── */

export const globalSupplyStatusEnum = pgEnum("global_supply_status", [
  "open",
  "fulfilled",
  "closed",
  "cancelled",
]);

export const globalSupplyResponseStatusEnum = pgEnum(
  "global_supply_response_status",
  ["pending", "accepted", "rejected", "withdrawn"]
);

// Optional international shipping terms. Nullable everywhere — buyers/suppliers
// may leave it unspecified.
export const incotermsEnum = pgEnum("incoterms", [
  "exw",
  "fca",
  "fob",
  "cfr",
  "cif",
  "dap",
  "ddp",
]);

// A buyer's import/export sourcing request (free-text product + destination +
// budget). Distinct from RFQ (structured category quotes): this is a global
// supply ask answered by suppliers + ranked directory matches.
export const globalSupplyRequests = pgTable(
  "global_supply_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerId: uuid("buyer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    productText: text("product_text").notNull(),
    category: listingCategoryEnum("category"),
    industry: industryEnum("industry"),
    quantity: numeric("quantity"),
    unit: text("unit"),
    destinationCountry: text("destination_country").notNull(),
    budgetMax: numeric("budget_max"),
    currency: text("currency").notNull().default("EGP"),
    incoterms: incotermsEnum("incoterms"),
    notes: text("notes"),
    status: globalSupplyStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_global_supply_buyer").on(table.buyerId),
    index("idx_global_supply_status").on(table.status),
    index("idx_global_supply_created").on(table.createdAt),
  ]
);

// A supplier's response to a global-supply request (origin, MOQ, shipping time,
// incoterms, delivery estimate, optional price). One standing row per
// (request, supplier) — re-submitting updates it. Lets dealer-os respond.
export const globalSupplyResponses = pgTable(
  "global_supply_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .references(() => globalSupplyRequests.id, { onDelete: "cascade" })
      .notNull(),
    supplierId: uuid("supplier_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    countryOfOrigin: text("country_of_origin"),
    moq: numeric("moq"),
    shippingTimeDays: integer("shipping_time_days"),
    incoterms: incotermsEnum("incoterms"),
    deliveryEstimate: text("delivery_estimate"),
    priceQuote: numeric("price_quote"),
    currency: text("currency").notNull().default("EGP"),
    message: text("message"),
    status: globalSupplyResponseStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_global_supply_response_supplier").on(
      table.requestId,
      table.supplierId
    ),
    index("idx_global_supply_response_request").on(table.requestId),
    index("idx_global_supply_response_supplier").on(table.supplierId),
    index("idx_global_supply_response_status").on(table.status),
  ]
);

/* ── FINANCING CRM (admin bank-financing pipeline) ─────── */

// Admin-managed directory of bank/financier "intermediary" accounts that a
// finance-request lead can be forwarded to. This is a lightweight CRM lookup,
// NOT a marketplace user — it never logs in. Kept separate so the admin can
// curate the hand-off list independently of the leads system.
export const financingIntermediaries = pgTable(
  "financing_intermediaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("idx_financing_intermediaries_active").on(table.isActive)]
);

// CRM sidecar that EXTENDS a finance_request lead (lead_history) with the
// admin-only workflow fields. We deliberately do NOT duplicate the lead: the
// buyer/listing/contact data stays in lead_history; this row only adds the
// pipeline status + intermediary assignment + admin notes. One row per lead
// (unique lead_id), created lazily the first time an admin acts on the lead.
export const financingRequests = pgTable(
  "financing_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .references(() => leadHistory.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    status: financingStatusEnum("status").notNull().default("new"),
    intermediaryId: uuid("intermediary_id").references(
      () => financingIntermediaries.id,
      { onDelete: "set null" }
    ),
    assignedAt: timestamp("assigned_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_financing_requests_status").on(table.status),
    index("idx_financing_requests_intermediary").on(table.intermediaryId),
  ]
);

export type FinancingIntermediary = typeof financingIntermediaries.$inferSelect;
export type InsertFinancingIntermediary = typeof financingIntermediaries.$inferInsert;
export type FinancingRequest = typeof financingRequests.$inferSelect;
export type InsertFinancingRequest = typeof financingRequests.$inferInsert;

/* ── Task #40 inferred types ───────────────────────────── */
export type InvestmentOpportunity = typeof investmentOpportunities.$inferSelect;
export type InsertInvestmentOpportunity = typeof investmentOpportunities.$inferInsert;
export type InvestmentInterest = typeof investmentInterests.$inferSelect;
export type InsertInvestmentInterest = typeof investmentInterests.$inferInsert;
export type CompanyFollow = typeof companyFollows.$inferSelect;
export type InsertCompanyFollow = typeof companyFollows.$inferInsert;
export type GlobalSupplyRequest = typeof globalSupplyRequests.$inferSelect;
export type InsertGlobalSupplyRequest = typeof globalSupplyRequests.$inferInsert;
export type GlobalSupplyResponse = typeof globalSupplyResponses.$inferSelect;
export type InsertGlobalSupplyResponse = typeof globalSupplyResponses.$inferInsert;

/* ── GLOBAL GEOGRAPHIC & REAL-ESTATE REFERENCE DATASET ───
 *
 * A STANDALONE reference database (not listings, not the taxonomy the
 * marketplace already runs on). It exists only to power search suggestions,
 * autocomplete, ranking and NLP matching for the real-estate section, and is
 * designed to scale from Egypt → Middle East → the whole world WITHOUT any
 * schema redesign:
 *
 *  - Hierarchy is an ADJACENCY LIST (`parentId` self-reference), so every
 *    country can model its own administrative ladder (governorate / prefecture /
 *    emirate / state / district / community / compound / phase / …) without a
 *    fixed column-per-level. `placeType` is a free text label (canonical values
 *    documented below) precisely so a new division type in any country is pure
 *    data, never a migration.
 *  - `searchBlob` is a denormalised, lower-cased concatenation of every name +
 *    alias + keyword. A trigram GIN index on it (added in api-server bootstrap,
 *    mirroring the listings pattern) gives partial / typo-tolerant / multilingual
 *    matching in a single index scan even at tens of millions of rows.
 *  - Nothing here references or is referenced BY the live marketplace tables, so
 *    it can be seeded, extended or reloaded with zero impact on existing data,
 *    APIs or performance.
 */

// Real-estate developers (Talaat Moustafa Group, Emaar Misr, SODIC, …). Kept in
// its own table so a project (compound) links to exactly one canonical developer.
export const referenceDevelopers = pgTable(
  "reference_developers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    localName: text("local_name"),
    isoCountryCode: text("iso_country_code").notNull().default("EG"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    searchKeywords: jsonb("search_keywords").$type<string[]>().notNull().default([]),
    // Lower-cased "name + aliases + keywords" join; trigram-indexed for fuzzy search.
    searchBlob: text("search_blob").notNull().default(""),
    popularity: integer("popularity").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_reference_developers_country").on(table.isoCountryCode),
    index("idx_reference_developers_status").on(table.status),
  ]
);

// The geographic / real-estate place hierarchy. One row per node at any level.
// canonical `placeType` values (extend freely — it is just a label):
//   world · continent · country · region · state · province · governorate ·
//   prefecture · emirate · city · district · area · neighborhood · community ·
//   compound · phase · building · unit
export const referencePlaces = pgTable(
  "reference_places",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Stable, human-readable identifier, e.g. "eg.cairo.new-cairo.fifth-settlement.mivida".
    // Lets seeds be idempotent (upsert by globalId) and survive re-runs.
    globalId: text("global_id").notNull().unique(),
    parentId: uuid("parent_id").references((): AnyPgColumn => referencePlaces.id, {
      onDelete: "set null",
    }),
    placeType: text("place_type").notNull(),
    isoCountryCode: text("iso_country_code"),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    localName: text("local_name"),
    slug: text("slug").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    searchKeywords: jsonb("search_keywords").$type<string[]>().notNull().default([]),
    searchBlob: text("search_blob").notNull().default(""),
    // Compounds / projects can point at their developer. NULL for pure geography.
    developerId: uuid("developer_id").references(() => referenceDevelopers.id, {
      onDelete: "set null",
    }),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    geohash: text("geohash"),
    postalCode: text("postal_code"),
    timezone: text("timezone"),
    currency: text("currency"),
    language: text("language"),
    popularity: integer("popularity").notNull().default(0),
    verified: boolean("verified").notNull().default(false),
    source: text("source"),
    sourceUrl: text("source_url"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_reference_places_parent").on(table.parentId),
    index("idx_reference_places_country").on(table.isoCountryCode),
    index("idx_reference_places_type").on(table.placeType),
    index("idx_reference_places_status").on(table.status),
    index("idx_reference_places_developer").on(table.developerId),
  ]
);

// Continuous-learning queue: an unknown place/project seen in real user input is
// recorded here (never written straight into the reference set). Occurrences are
// counted, a confidence score accrues, and only after admin approval is it
// promoted into `referencePlaces` — keeping the reference data clean by design.
export const pendingLocations = pgTable(
  "pending_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rawName: text("raw_name").notNull(),
    normalized: text("normalized").notNull(),
    isoCountryCode: text("iso_country_code"),
    suggestedParentId: uuid("suggested_parent_id").references(
      (): AnyPgColumn => referencePlaces.id,
      { onDelete: "set null" }
    ),
    suggestedType: text("suggested_type"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    source: text("source"),
    // pending · approved · rejected · merged
    status: text("status").notNull().default("pending"),
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => referencePlaces.id,
      { onDelete: "set null" }
    ),
    firstSeenAt: timestamp("first_seen_at").defaultNow(),
    lastSeenAt: timestamp("last_seen_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    // One learning row per normalized name+country; occurrences bump the counter.
    uniqueIndex("uq_pending_locations_norm").on(table.normalized, table.isoCountryCode),
    index("idx_pending_locations_status").on(table.status),
  ]
);

export type ReferenceDeveloper = typeof referenceDevelopers.$inferSelect;
export type InsertReferenceDeveloper = typeof referenceDevelopers.$inferInsert;
export type ReferencePlace = typeof referencePlaces.$inferSelect;
export type InsertReferencePlace = typeof referencePlaces.$inferInsert;
export type PendingLocation = typeof pendingLocations.$inferSelect;
export type InsertPendingLocation = typeof pendingLocations.$inferInsert;

/* ── MARKET INSIGHTS: price observations (Deal Rating engine) ──
 *
 * A STANDALONE, append-only ledger of REAL price points, one row recorded each
 * time a listing is published (and again when it is marked sold). It exists to
 * power price history, market insights and the "deal rating" for a listing —
 * how its price compares to its own market segment.
 *
 * Philosophy-aligned: nothing is fabricated — every observation comes from a
 * real listing at a real price and time. Recording is ALWAYS best-effort and
 * post-commit, so it can never block or roll back a publish (never block trade).
 * A rating is only returned once a segment has enough real samples; below that
 * the engine honestly reports "insufficient data" rather than inventing a number.
 *
 * `segmentKey` is the deterministic market bucket a listing belongs to
 * (category + location + a primary discriminator such as brand/model/year or
 * property type), computed by MarketInsightsService — so this table needs no
 * schema change as new categories or dimensions are added.
 */
export const priceObservations = pgTable(
  "price_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Provenance. SET NULL on delete keeps the historical price point (the market
    // signal) even after the listing itself is gone.
    listingId: uuid("listing_id").references(() => listings.id, {
      onDelete: "set null",
    }),
    category: listingCategoryEnum("category").notNull(),
    segmentKey: text("segment_key").notNull(),
    locationKey: text("location_key"),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("EGP"),
    // Salient specs that defined the segment (brand/model/year, property_type…)
    // — kept for finer future analysis without re-joining the listing.
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    // listing_publish · listing_sold · backfill
    source: text("source").notNull().default("listing_publish"),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_price_observations_segment").on(table.segmentKey),
    index("idx_price_observations_category").on(table.category),
    index("idx_price_observations_observed").on(table.observedAt),
    // One row per (listing, source): re-publishing or re-running the backfill
    // refreshes rather than duplicates. NULL listing_id (deleted) rows are
    // exempt (Postgres treats NULLs as distinct), preserving history.
    uniqueIndex("uq_price_observations_listing_source").on(table.listingId, table.source),
  ]
);

export type PriceObservation = typeof priceObservations.$inferSelect;
export type InsertPriceObservation = typeof priceObservations.$inferInsert;
