import { db } from "@workspace/db";
import { users, leadHistory, savedListings, userBehavior } from "@workspace/db/schema";
import { eq, and, ne, isNull } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { logger } from "../lib/logger";
import { checkProfileMutationRate, flagDuplicateAccount } from "./AbuseService";
import { sendWelcomeEmail } from "./EmailService";

export async function getOrCreateUser(clerkId: string, data?: { name?: string; email?: string }) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({
      clerkId,
      name: data?.name ?? "BANCO User",
      email: data?.email,
      role: "individual",
      isVerified: false,
    })
    .returning();

  // First touch — professional welcome. Strictly fire-and-forget: an email
  // provider hiccup must never slow down or fail account creation.
  if (created?.email) {
    void sendWelcomeEmail({ to: created.email, name: created.name }).catch((err) =>
      logger.warn({ err }, "welcome email failed (non-blocking)"),
    );
  }

  return created;
}

export async function getDbUser(clerkId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return user ?? null;
}

/**
 * Best-effort mirror of the DB role (source of truth) into Clerk
 * publicMetadata. Failures are swallowed/logged so they never block the
 * request path.
 */
export async function syncRoleToClerk(clerkId: string, role: string): Promise<void> {
  try {
    await clerkClient.users.updateUserMetadata(clerkId, {
      publicMetadata: { role },
    });
  } catch (err) {
    console.error("[Role sync] Failed to mirror role to Clerk", err);
  }
}

export interface UpdateUserProfileInput {
  account_type?: "individual" | "dealer" | "company";
  phone?: string | null;
  bio?: string | null;
  display_title?: string | null;
  category_label?: string | null;
  business?: {
    activity_type: "car_dealer" | "real_estate_developer" | "factory" | "supplier";
    business_name: string;
    trade_name?: string;
    owner_name?: string;
    city: string;
    documents?: string[];
  };
}

/**
 * Update the current user's profile. Two safe capabilities:
 *  - set/clear phone
 *  - upgrade to a "Banco Business": the SERVER is the only authority that maps
 *    a business signup to a role. Every business activity hard-maps to the
 *    `dealer` role — a client can never request company/enterprise/admin.
 *
 * `users.companyDetails` (DB jsonb) is the source of truth. We best-effort
 * mirror the role + business profile into Clerk publicMetadata so client
 * surfaces that already read publicMetadata stay consistent (non-blocking).
 */
export async function updateUserProfile(
  clerkId: string,
  input: UpdateUserProfileInput,
  meta?: { ip?: string },
) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  }

  // Anti-abuse: cap profile-mutation bursts per user (feeds suspicion → auto
  // shadow-ban). Server-authoritative; the client can never opt out.
  const rate = await checkProfileMutationRate({ userId: user.id, ip: meta?.ip });
  if (!rate.ok) {
    throw Object.assign(new Error("Too many profile updates. Please slow down and try again later."), {
      code: "RATE_LIMITED",
    });
  }

  // Duplicate-account guard: a phone already linked to another active account is
  // a strong multi-account signal. Block the mutation and escalate suspicion.
  if (input.phone) {
    const [dup] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, input.phone), ne(users.id, user.id), isNull(users.deletedAt)))
      .limit(1);
    if (dup) {
      await flagDuplicateAccount({ userId: user.id, otherUserId: dup.id, ip: meta?.ip });
      throw Object.assign(new Error("This phone number is already linked to another account"), {
        code: "DUPLICATE_ACCOUNT",
      });
    }
  }

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.phone !== undefined) patch.phone = input.phone;

  // Account-type selection is SERVER-authoritative. The client can only ever
  // request one of three onboarding types — individual / dealer / company —
  // and we map each to a concrete role here. A client can never request
  // `admin` or any privileged role; those are unreachable through this path.
  if (input.account_type) {
    patch.role =
      input.account_type === "individual"
        ? "individual"
        : input.account_type === "company"
          ? "company"
          : "dealer";
  }

  // A business signup always hard-maps to a seller role. If the client also
  // sent account_type, the business block wins (it carries the richer intent).
  if (input.business) {
    if (!input.account_type || input.account_type === "individual") {
      patch.role = "dealer";
    }
    patch.companyDetails = {
      activity_type: input.business.activity_type,
      business_name: input.business.business_name,
      ...(input.business.trade_name
        ? { trade_name: input.business.trade_name }
        : {}),
      ...(input.business.owner_name
        ? { owner_name: input.business.owner_name }
        : {}),
      city: input.business.city,
      ...(input.business.documents && input.business.documents.length > 0
        ? { documents: input.business.documents }
        : {}),
    };
  }

  // Empty DB patch — still allow Clerk-only profile presentation updates.
  const hasPresentationPatch =
    input.bio !== undefined ||
    input.display_title !== undefined ||
    input.category_label !== undefined;

  if (Object.keys(patch).length === 0 && !hasPresentationPatch) return user;

  let updated = user;
  if (Object.keys(patch).length > 0) {
    const [row] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, user.id))
      .returning();
    updated = row;
  }

  if (hasPresentationPatch) {
    try {
      const presentation: Record<string, string | null> = {};
      if (input.bio !== undefined) presentation.bio = input.bio;
      if (input.display_title !== undefined) {
        presentation.displayTitle = input.display_title;
      }
      if (input.category_label !== undefined) {
        presentation.categoryLabel = input.category_label;
      }
      await clerkClient.users.updateUserMetadata(clerkId, {
        publicMetadata: presentation,
        unsafeMetadata: presentation,
      });
    } catch (err) {
      console.error("[Profile sync] Failed to mirror presentation to Clerk", err);
    }
  }

  // Best-effort mirror of the resolved role (+ business profile) into Clerk
  // publicMetadata so client surfaces that read it stay consistent.
  if (patch.role !== undefined || input.business) {
    try {
      await clerkClient.users.updateUserMetadata(clerkId, {
        publicMetadata: {
          role: updated.role,
          ...(patch.companyDetails ? { business: patch.companyDetails } : {}),
        },
      });
    } catch (err) {
      console.error("[Profile sync] Failed to mirror profile to Clerk", err);
    }
  }

  return updated;
}

/**
 * Permanently delete a user's account for Google Play self-service deletion
 * compliance.
 *
 * Architectural constraint: the local data mutation must be atomic. We
 * soft-delete (timestamp) + anonymize the user record AND wipe their personal
 * data (lead PII, saved listings, behavior history) inside a single
 * transaction, so a failure can never leave a half-deleted account. The
 * auth-provider (Clerk) deletion happens only AFTER the transaction commits —
 * the database is the durable source of truth, and Clerk removal is the final,
 * non-transactional step.
 */
export async function deleteAccount(clerkId: string): Promise<{ deleted: boolean }> {
  const [user] = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  }

  const now = new Date();

  // Atomic local anonymization + personal-data wipe.
  await db.transaction(async (tx) => {
    // Anonymize the user record. We keep the row (soft delete) so seller
    // references on existing listings/leads stay intact and the deletion is
    // recoverable for a short window, but strip every piece of PII.
    await tx
      .update(users)
      .set({
        name: "Deleted User",
        email: null,
        phone: null,
        companyDetails: null,
        isVerified: false,
        deletedAt: now,
      })
      .where(eq(users.id, user.id));

    // Wipe buyer-side lead PII captured against this user.
    await tx
      .update(leadHistory)
      .set({ buyerName: null, buyerPhone: null, updatedAt: now })
      .where(eq(leadHistory.buyerId, user.id));

    // Remove the user's personal collections/behavior history entirely.
    await tx.delete(savedListings).where(eq(savedListings.userId, user.id));
    await tx.delete(userBehavior).where(eq(userBehavior.userId, user.id));
  });

  // Final step: remove the account from the auth provider. Runs after the
  // local transaction has committed so the privacy obligation (data wipe) is
  // already durable even if the external call fails.
  try {
    await clerkClient.users.deleteUser(clerkId);
  } catch (err) {
    logger.error(
      { err, user_id: user.id },
      "Account data anonymized but Clerk user deletion failed",
    );
    throw Object.assign(
      new Error("Account data removed but auth-provider deletion failed"),
      { code: "AUTH_PROVIDER_ERROR" },
    );
  }

  return { deleted: true };
}
