import { db } from "@workspace/db";
import {
  users,
  listings,
  leadHistory,
  companyProfiles,
  companyFollows,
} from "@workspace/db/schema";
import { and, eq, sql, desc, ilike } from "drizzle-orm";
import { enrichListings } from "./SearchService";
import { transformFeedItems } from "./BffService";
import { getDbUser } from "./UserService";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import { createNotification } from "./NotificationService";
import { getObjectStorageService } from "../lib/objectStorageProvider";
import type {
  CompanyProfile,
  CompanyDirectoryItem,
  FeedItem,
} from "../validators/schemas";

const objectStorageService = getObjectStorageService();

const BUSINESS_ROLES = ["dealer", "company", "enterprise"];
type Industry =
  | "food"
  | "beverage"
  | "plastic"
  | "textile"
  | "pharmaceutical"
  | "chemical"
  | "engineering"
  | "other";

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Real, public-safe seller stats: active/total listings (under the public
 * visibility guard), response rate from real lead data (null until there is any
 * lead), and active-since. Shared by the public company profile and the
 * caller's own /v1/me/metrics view so both stay identical and are never faked.
 */
export async function getSellerStats(
  userId: string,
  createdAt: Date,
  isVerified: boolean,
): Promise<CompanyProfile["stats"]> {
  const [counts] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      active: sql<number>`COUNT(*) FILTER (WHERE ${listings.status} = 'active')`,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(and(eq(listings.userId, userId), ...publicVisibilityConditions()));

  const [leadAgg] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      engaged: sql<number>`COUNT(*) FILTER (WHERE ${leadHistory.status} IN ('contacted', 'closed'))`,
    })
    .from(leadHistory)
    .where(eq(leadHistory.sellerId, userId));

  const yearsActive = Math.max(
    0,
    Math.floor((Date.now() - createdAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000)),
  );

  const leadTotal = Number(leadAgg?.total ?? 0);
  const responseRate =
    leadTotal > 0 ? Math.round((Number(leadAgg?.engaged ?? 0) / leadTotal) * 100) / 100 : null;

  return {
    active_listings: Number(counts?.active ?? 0),
    total_listings: Number(counts?.total ?? 0),
    member_since: createdAt.toISOString(),
    years_active: yearsActive,
    response_rate: responseRate,
    is_verified: isVerified,
  };
}

/**
 * Public seller / company profile: stable identity, a nullable rich B2B trade
 * block (null for sellers who never filled one in), and public stats. No lead
 * PII is exposed — only aggregate counts and a response-rate ratio.
 */
export async function getCompanyProfile(
  userId: string,
  viewerClerkId?: string,
): Promise<CompanyProfile | null> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isVerified: users.isVerified,
      isShadowBanned: users.isShadowBanned,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // A shadow-banned seller's entire public surface is suppressed — the profile
  // 404s rather than exposing identity or stats. Mirrors publicVisibilityConditions().
  if (!user || user.isShadowBanned === true) return null;

  const [profile] = await db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.userId, userId))
    .limit(1);

  // Stats obey the same public visibility guard as every listing surface — see
  // getSellerStats (shared with the caller's own /v1/me/metrics view).
  const stats = await getSellerStats(
    userId,
    user.createdAt ?? new Date(),
    !!user.isVerified,
  );

  // Additive (Task #40): directory social proof. follower_count is always real;
  // is_following is viewer-relative (false when unauthenticated).
  const [followAgg] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(companyFollows)
    .where(eq(companyFollows.companyUserId, userId));
  const followerCount = Number(followAgg?.count ?? 0);

  let isFollowing = false;
  const viewerUserId = await resolveUserIdOpt(viewerClerkId);
  if (viewerUserId) {
    const [row] = await db
      .select({ id: companyFollows.id })
      .from(companyFollows)
      .where(
        and(
          eq(companyFollows.companyUserId, userId),
          eq(companyFollows.followerId, viewerUserId),
        ),
      )
      .limit(1);
    isFollowing = !!row;
  }

  // Additive: the seller's newest visible listing, so a profile visitor can
  // start a conversation directly (conversations are listing-anchored).
  const [latest] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.userId, userId),
        eq(listings.status, "active"),
        sql`${listings.isFlagged} IS NOT TRUE`,
      ),
    )
    .orderBy(desc(listings.createdAt))
    .limit(1);

  return {
    latest_listing_id: latest?.id ?? null,
    id: user.id,
    name: user.name,
    role: user.role,
    is_verified: !!user.isVerified,
    stats,
    company: profile
      ? {
          about: profile.about ?? null,
          year_established: profile.yearEstablished ?? null,
          countries_import_from: toStringArray(profile.countriesImportFrom),
          countries_export_to: toStringArray(profile.countriesExportTo),
          min_order_value: profile.minOrderValue ?? null,
          min_order_unit: profile.minOrderUnit ?? null,
          monthly_capacity: profile.monthlyCapacity ?? null,
          lead_time_days: profile.leadTimeDays ?? null,
          certifications: toStringArray(profile.certifications),
          website_url: profile.websiteUrl ?? null,
          logo_url: profile.logoUrl ?? null,
          cover_url: profile.coverUrl ?? null,
          industry: profile.industry ?? null,
          hq_country: profile.hqCountry ?? null,
        }
      : null,
    follower_count: followerCount,
    is_following: isFollowing,
  };
}

async function resolveUserIdOpt(clerkId?: string): Promise<string | null> {
  if (!clerkId) return null;
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return user?.id ?? null;
}

/**
 * A company's public, active listings as standard FeedItems. Uses the shared
 * enrichment + transform pipeline and the public visibility guard so hidden
 * inventory never leaks.
 */
export async function getCompanyListings(
  userId: string,
  cursor?: string,
  limit = 20
): Promise<{ items: FeedItem[]; cursor?: string; has_next: boolean }> {
  const conditions = [
    eq(listings.userId, userId),
    eq(listings.status, "active"),
    ...publicVisibilityConditions(),
  ];
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
      user_id: listings.userId,
      is_verified: users.isVerified,
      user_name: users.name,
      user_role: users.role,
      quality_score: users.qualityScore,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(listings.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextCursor =
    hasNext && pageRows.length > 0
      ? pageRows[pageRows.length - 1].created_at?.toISOString()
      : undefined;

  const enriched = await enrichListings(pageRows);
  const items = transformFeedItems(enriched);

  return { items, cursor: nextCursor, has_next: hasNext };
}

/**
 * Role-agnostic "my listings" for the Instagram-style profile grid. Returns the
 * caller's OWN listings as FeedItems, scoped strictly by ownership so individuals
 * (who have no dealer endpoint) and companies alike see their real posts. Unlike
 * the public company view this is owner-only — it intentionally drops the
 * active-only + publicVisibilityConditions gate so the owner sees every status
 * of their own catalogue (incomplete/imageless rows are still dropped by the
 * FeedItem transform).
 */
export async function getMyListings(
  clerkId: string,
  cursor?: string,
  limit = 20
): Promise<{ items: FeedItem[]; cursor?: string; has_next: boolean }> {
  const user = await getDbUser(clerkId);
  if (!user) return { items: [], has_next: false };

  const conditions = [eq(listings.userId, user.id)];
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
      user_id: listings.userId,
      is_verified: users.isVerified,
      user_name: users.name,
      user_role: users.role,
      quality_score: users.qualityScore,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(listings.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextCursor =
    hasNext && pageRows.length > 0
      ? pageRows[pageRows.length - 1].created_at?.toISOString()
      : undefined;

  const enriched = await enrichListings(pageRows);
  const items = transformFeedItems(enriched);

  return { items, cursor: nextCursor, has_next: hasNext };
}

export interface UpsertCompanyProfileInput {
  about?: string | null;
  year_established?: number | null;
  countries_import_from?: string[];
  countries_export_to?: string[];
  min_order_value?: number | null;
  min_order_unit?: string | null;
  monthly_capacity?: string | null;
  lead_time_days?: number | null;
  certifications?: string[];
  website_url?: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
  industry?: Industry | null;
  hq_country?: string | null;
}

/**
 * Owner upsert of the rich B2B block. Restricted to business roles
 * (dealer/company/enterprise) — individuals cannot create a company profile.
 * Only provided keys are written (partial update on conflict).
 */
export async function upsertMyCompanyProfile(
  clerkId: string,
  input: UpsertCompanyProfileInput
): Promise<{ updated: boolean }> {
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });
  }
  if (!BUSINESS_ROLES.includes(user.role)) {
    throw Object.assign(new Error("A business account is required"), { code: "FORBIDDEN" });
  }

  const patch: Partial<typeof companyProfiles.$inferInsert> = {};
  if (input.about !== undefined) patch.about = input.about;
  if (input.year_established !== undefined) patch.yearEstablished = input.year_established;
  if (input.countries_import_from !== undefined)
    patch.countriesImportFrom = input.countries_import_from;
  if (input.countries_export_to !== undefined)
    patch.countriesExportTo = input.countries_export_to;
  if (input.min_order_value !== undefined)
    patch.minOrderValue = input.min_order_value === null ? null : String(input.min_order_value);
  if (input.min_order_unit !== undefined) patch.minOrderUnit = input.min_order_unit;
  if (input.monthly_capacity !== undefined) patch.monthlyCapacity = input.monthly_capacity;
  if (input.lead_time_days !== undefined) patch.leadTimeDays = input.lead_time_days;
  if (input.certifications !== undefined) patch.certifications = input.certifications;
  if (input.website_url !== undefined) patch.websiteUrl = input.website_url;
  if (input.logo_url !== undefined) patch.logoUrl = input.logo_url;
  if (input.cover_url !== undefined) patch.coverUrl = input.cover_url;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.hq_country !== undefined) patch.hqCountry = input.hq_country;

  await db
    .insert(companyProfiles)
    .values({ userId: user.id, ...patch })
    .onConflictDoUpdate({
      target: companyProfiles.userId,
      set: { ...patch, updatedAt: new Date() },
    });

  // Promote any newly-attached brand media to public ACL so the ACL-gated serve
  // handler returns them without auth (mirrors listing media). Best-effort:
  // promoteServingUrlToPublic swallows failures and no-ops non-first-party URLs.
  await Promise.all(
    [input.logo_url, input.cover_url]
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map((u) => objectStorageService.promoteServingUrlToPublic(u, user.id))
  );

  return { updated: true };
}

/* ── Suppliers Directory & Follows (Task #40) ──────────── */

const activeListingsSql = sql<number>`(SELECT COUNT(*) FROM ${listings} WHERE ${listings.userId} = ${users.id} AND ${listings.status} = 'active' AND ${listings.isFlagged} IS NOT TRUE)`;
const followerCountSql = sql<number>`(SELECT COUNT(*) FROM ${companyFollows} WHERE ${companyFollows.companyUserId} = ${users.id})`;

/**
 * Public, paginated suppliers directory: business-role sellers (dealer/company/
 * enterprise) that are not shadow-banned, enriched with real active-listing and
 * follower counts. is_following is viewer-relative (false when unauthenticated).
 */
export async function listCompaniesDirectory(
  filters: {
    q?: string;
    industry?: Industry;
    hq_country?: string;
    verified?: boolean;
  },
  cursor?: string,
  limit = 20,
  viewerClerkId?: string,
): Promise<{ items: CompanyDirectoryItem[]; cursor?: string; has_next: boolean }> {
  const viewerUserId = await resolveUserIdOpt(viewerClerkId);
  const isFollowingSql = viewerUserId
    ? sql<boolean>`EXISTS (SELECT 1 FROM ${companyFollows} WHERE ${companyFollows.companyUserId} = ${users.id} AND ${companyFollows.followerId} = ${viewerUserId})`
    : sql<boolean>`FALSE`;

  const conditions = [
    sql`${users.role} IN ('dealer', 'company', 'enterprise')`,
    sql`${users.isShadowBanned} IS NOT TRUE`,
  ];
  if (filters.q) conditions.push(ilike(users.name, `%${filters.q}%`));
  if (filters.industry) conditions.push(eq(companyProfiles.industry, filters.industry));
  if (filters.hq_country)
    conditions.push(ilike(companyProfiles.hqCountry, `%${filters.hq_country}%`));
  if (filters.verified === true) conditions.push(eq(users.isVerified, true));
  if (cursor) conditions.push(sql`${users.createdAt} < ${new Date(cursor)}`);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      is_verified: users.isVerified,
      created_at: users.createdAt,
      industry: companyProfiles.industry,
      hq_country: companyProfiles.hqCountry,
      logo_url: companyProfiles.logoUrl,
      cover_url: companyProfiles.coverUrl,
      active_listings: activeListingsSql,
      follower_count: followerCountSql,
      is_following: isFollowingSql,
    })
    .from(users)
    .leftJoin(companyProfiles, eq(companyProfiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(users.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextCursor =
    hasNext && pageRows.length > 0
      ? pageRows[pageRows.length - 1].created_at?.toISOString()
      : undefined;

  const items: CompanyDirectoryItem[] = pageRows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    is_verified: !!r.is_verified,
    industry: r.industry ?? null,
    hq_country: r.hq_country ?? null,
    logo_url: r.logo_url ?? null,
    cover_url: r.cover_url ?? null,
    active_listings: Number(r.active_listings ?? 0),
    follower_count: Number(r.follower_count ?? 0),
    is_following: !!r.is_following,
  }));

  return { items, cursor: nextCursor, has_next: hasNext };
}

async function resolveUserId(clerkId: string): Promise<string> {
  const id = await resolveUserIdOpt(clerkId);
  if (!id) throw Object.assign(new Error("User not found"), { code: "UNAUTHORIZED" });
  return id;
}

async function currentFollowerCount(companyUserId: string): Promise<number> {
  const [agg] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(companyFollows)
    .where(eq(companyFollows.companyUserId, companyUserId));
  return Number(agg?.count ?? 0);
}

/** Follow a company. Idempotent; self-follow and following a non-business or
 * shadow-banned account are rejected. The followed company is notified. */
export async function followCompany(
  clerkId: string,
  companyUserId: string,
): Promise<{ following: boolean; follower_count: number }> {
  const followerId = await resolveUserId(clerkId);
  if (followerId === companyUserId) {
    throw Object.assign(new Error("You cannot follow yourself"), { code: "FORBIDDEN" });
  }

  const [company] = await db
    .select({ id: users.id, role: users.role, isShadowBanned: users.isShadowBanned })
    .from(users)
    .where(eq(users.id, companyUserId))
    .limit(1);
  if (!company || company.isShadowBanned === true || !BUSINESS_ROLES.includes(company.role)) {
    throw Object.assign(new Error("Company not found"), { code: "NOT_FOUND" });
  }

  const inserted = await db
    .insert(companyFollows)
    .values({ followerId, companyUserId })
    .onConflictDoNothing({
      target: [companyFollows.followerId, companyFollows.companyUserId],
    })
    .returning({ id: companyFollows.id });

  if (inserted.length > 0) {
    void createNotification({
      userId: companyUserId,
      type: "system",
      title: "New follower",
      body: "A buyer started following your company",
      data: { follower_id: followerId },
    });
  }

  return { following: true, follower_count: await currentFollowerCount(companyUserId) };
}

/** Unfollow a company. Idempotent. */
export async function unfollowCompany(
  clerkId: string,
  companyUserId: string,
): Promise<{ following: boolean; follower_count: number }> {
  const followerId = await resolveUserId(clerkId);
  await db
    .delete(companyFollows)
    .where(
      and(
        eq(companyFollows.followerId, followerId),
        eq(companyFollows.companyUserId, companyUserId),
      ),
    );
  return { following: false, follower_count: await currentFollowerCount(companyUserId) };
}

/** The caller's followed companies as directory items. */
export async function listMyFollowing(
  clerkId: string,
  cursor?: string,
  limit = 20,
): Promise<{ items: CompanyDirectoryItem[]; cursor?: string; has_next: boolean }> {
  const followerId = await resolveUserId(clerkId);

  const conditions = [
    eq(companyFollows.followerId, followerId),
    sql`${users.isShadowBanned} IS NOT TRUE`,
  ];
  if (cursor) conditions.push(sql`${companyFollows.createdAt} < ${new Date(cursor)}`);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      is_verified: users.isVerified,
      follow_created_at: companyFollows.createdAt,
      industry: companyProfiles.industry,
      hq_country: companyProfiles.hqCountry,
      logo_url: companyProfiles.logoUrl,
      cover_url: companyProfiles.coverUrl,
      active_listings: activeListingsSql,
      follower_count: followerCountSql,
    })
    .from(companyFollows)
    .innerJoin(users, eq(companyFollows.companyUserId, users.id))
    .leftJoin(companyProfiles, eq(companyProfiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(companyFollows.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextCursor =
    hasNext && pageRows.length > 0
      ? pageRows[pageRows.length - 1].follow_created_at?.toISOString()
      : undefined;

  const items: CompanyDirectoryItem[] = pageRows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    is_verified: !!r.is_verified,
    industry: r.industry ?? null,
    hq_country: r.hq_country ?? null,
    logo_url: r.logo_url ?? null,
    cover_url: r.cover_url ?? null,
    active_listings: Number(r.active_listings ?? 0),
    follower_count: Number(r.follower_count ?? 0),
    is_following: true,
  }));

  return { items, cursor: nextCursor, has_next: hasNext };
}
