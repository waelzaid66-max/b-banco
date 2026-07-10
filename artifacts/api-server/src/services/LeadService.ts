import { db } from "@workspace/db";
import {
  leadHistory,
  leadTokens,
  interactions,
  users,
  listings,
  listingAttributes,
  leadBilling,
  type Plan,
} from "@workspace/db/schema";
import { eq, and, desc, count, gte, sql, isNull, gt } from "drizzle-orm";
import { logger, leadLogger } from "../lib/logger";
import { validateLead } from "./AbuseService";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import { recomputeDealerQuality } from "./QualityService";
import { applyTransaction } from "./WalletService";
import { resolveEffectivePlan, type UserRole } from "./PlanService";
import { isInsufficientFunds, toMoney } from "../lib/billing";
import { createNotification } from "./NotificationService";
import { isEmailChannelEnabled, sendLeadNotificationEmail } from "./EmailService";
import { schedulePaymentSuccess } from "./BillingNotificationService";

const LEAD_ACTION_LABEL: Record<TrackLeadInput["actionType"], string> = {
  whatsapp: "WhatsApp",
  call: "Call",
  chat: "Chat",
  finance_request: "Finance request",
};

/** Listing-level contact phones (specs.contact_phones) override the seller profile phone. */
function revealPhoneFromListing(
  specs: unknown,
  sellerPhone: string | null | undefined
): string | null {
  if (specs && typeof specs === "object") {
    const phones = (specs as Record<string, unknown>).contact_phones;
    if (Array.isArray(phones)) {
      for (const entry of phones) {
        if (typeof entry === "string" && entry.trim()) return entry.trim();
      }
    }
  }
  return sellerPhone?.trim() ? sellerPhone.trim() : null;
}

interface TrackLeadInput {
  listingId: string;
  actionType: "whatsapp" | "call" | "chat" | "finance_request";
  buyerClerkId?: string;
  buyerName?: string;
  buyerPhone?: string;
  ip?: string;
  deviceId?: string;
}

/** CPL rate for an action type, read server-side from the seller's plan. */
function cplForAction(plan: Plan, action: TrackLeadInput["actionType"]): string {
  switch (action) {
    case "whatsapp":
      return plan.cplWhatsapp;
    case "call":
      return plan.cplCall;
    case "chat":
      return plan.cplChat;
    case "finance_request":
      return plan.cplFinanceRequest;
  }
}

export function trackLead(input: TrackLeadInput): void {
  // Fire-and-forget: never blocks the request path.
  setImmediate(() => {
    void processLead(input);
  });
}

const CONTACT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Mints a single-use contact token tied to the given viewer + listing.
 * The token is embedded in the listing-detail response and must be presented
 * to contactLead() — ensuring every phone reveal is preceded by a
 * server-observed listing view, making forged leads impossible.
 */
export async function mintContactToken(viewerClerkId: string, listingId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + CONTACT_TOKEN_TTL_MS);
  const [token] = await db
    .insert(leadTokens)
    .values({ viewerClerkId, listingId, expiresAt })
    .returning({ id: leadTokens.id });
  return token.id;
}

interface ContactLeadInput extends TrackLeadInput {
  /** The caller's database user id (already resolved by the controller). */
  buyerDbId?: string;
  /** Single-use token minted by mintContactToken() and embedded in listing detail. */
  contactToken: string;
}

/**
 * Atomic contact reveal: validates that the listing is publicly contactable,
 * runs abuse checks, records the lead (including CPL billing), and returns the
 * seller's contact phone number — all in a single awaited operation.
 *
 * This is the server-observed contact event. The phone number is intentionally
 * withheld from the listing detail endpoint; it is only obtainable through
 * this call. Because the reveal and the lead record are atomic, a billable lead
 * cannot be forged without the server observing the contact request.
 *
 * Throws:
 *  - code "NOT_FOUND"    – listing is not publicly contactable
 *  - code "RATE_LIMITED" – abuse check blocked the lead
 */
export async function contactLead(input: ContactLeadInput): Promise<{ phone: string | null }> {
  const [listing] = await db
    .select({
      userId: listings.userId,
      sellerRole: users.role,
      title: listings.title,
      sellerPhone: users.phone,
      specs: listingAttributes.specs,
    })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(
      and(
        eq(listings.id, input.listingId),
        eq(listings.status, "active"),
        ...publicVisibilityConditions()
      )
    )
    .limit(1);

  if (!listing?.userId) {
    throw Object.assign(new Error("Listing not found or not publicly contactable"), {
      code: "NOT_FOUND",
    });
  }

  const sellerId = listing.userId;
  const sellerRole = (listing.sellerRole ?? "individual") as UserRole;

  // Pre-flight token check (no lock, no side-effects).
  // Rejected here before any rate counters are touched — an attacker flooding
  // invalid tokens cannot exhaust the per-listing lead-intake quota.
  const now = new Date();
  const [preflightToken] = await db
    .select({ id: leadTokens.id })
    .from(leadTokens)
    .where(
      and(
        eq(leadTokens.id, input.contactToken),
        eq(leadTokens.viewerClerkId, input.buyerClerkId!),
        eq(leadTokens.listingId, input.listingId),
        isNull(leadTokens.usedAt),
        gt(leadTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!preflightToken) {
    throw Object.assign(
      new Error("Invalid or expired contact token — please reload the listing"),
      { code: "INVALID_TOKEN" }
    );
  }

  const decision = await validateLead({
    listingId: input.listingId,
    sellerId,
    buyerId: input.buyerDbId ?? null,
    ip: input.ip,
    deviceId: input.deviceId,
  });
  if (!decision.ok) {
    throw Object.assign(new Error("Lead rate limit exceeded, please try again later"), {
      code: "RATE_LIMITED",
    });
  }

  // Resolve CPL server-side. Individuals are never billed for leads.
  let cpl = "0";
  if (sellerRole !== "individual") {
    const plan = await resolveEffectivePlan(sellerId, sellerRole);
    cpl = toMoney(cplForAction(plan, input.actionType));
  }

  const billing = await db.transaction(async (tx) => {
    // Atomically re-validate and consume the single-use contact token inside
    // the transaction using SELECT FOR UPDATE. The pre-flight above only prevents
    // rate-counter pollution by obviously-invalid tokens; this is the authoritative
    // check — a token used between pre-flight and transaction is still rejected here.
    const txNow = new Date();
    const [token] = await tx
      .select()
      .from(leadTokens)
      .where(
        and(
          eq(leadTokens.id, input.contactToken),
          eq(leadTokens.viewerClerkId, input.buyerClerkId!),
          eq(leadTokens.listingId, input.listingId),
          isNull(leadTokens.usedAt),
          gt(leadTokens.expiresAt, txNow)
        )
      )
      .for("update")
      .limit(1);

    if (!token) {
      throw Object.assign(
        new Error("Invalid or expired contact token — please reload the listing"),
        { code: "INVALID_TOKEN" }
      );
    }

    await tx.update(leadTokens).set({ usedAt: txNow }).where(eq(leadTokens.id, token.id));

    const [lead] = await tx
      .insert(leadHistory)
      .values({
        listingId: input.listingId,
        buyerId: input.buyerDbId ?? null,
        sellerId,
        actionType: input.actionType,
        status: "new",
        buyerName: input.buyerName ?? null,
        buyerPhone: input.buyerPhone ?? null,
      })
      .returning({ id: leadHistory.id });

    const billingBase = {
      leadId: lead.id,
      sellerId,
      buyerId: input.buyerDbId ?? null,
      listingId: input.listingId,
      actionType: input.actionType,
    };

    if (sellerRole === "individual" || Number(cpl) <= 0) {
      await tx.insert(leadBilling).values({
        ...billingBase,
        status: "not_billable",
        amountCharged: "0",
      });
      return { leadId: lead.id, status: "not_billable" as const };
    }

    try {
      const charge = await applyTransaction(tx, {
        userId: sellerId,
        type: "lead_charge",
        direction: "debit",
        amount: cpl,
        referenceType: "lead",
        referenceId: lead.id,
        description: `Lead charge (${input.actionType})`,
        invoice: {
          lineItems: [{ label: `Lead (${input.actionType})`, amount: cpl }],
        },
      });
      await tx.insert(leadBilling).values({
        ...billingBase,
        status: "charged",
        amountCharged: cpl,
        transactionId: charge.transactionId,
      });
      return {
        leadId: lead.id,
        status: "charged" as const,
        charge: {
          transactionId: charge.transactionId,
          balanceAfter: charge.balanceAfter,
          amount: cpl,
        },
      };
    } catch (err) {
      if (isInsufficientFunds(err)) {
        await tx.insert(leadBilling).values({
          ...billingBase,
          status: "failed",
          amountCharged: cpl,
        });
        return { leadId: lead.id, status: "failed" as const };
      }
      throw err;
    }
  });

  if (billing.status === "charged" && "charge" in billing && billing.charge) {
    schedulePaymentSuccess({
      userId: sellerId,
      kind: "lead_charge",
      amount: billing.charge.amount,
      balanceAfter: billing.charge.balanceAfter,
      transactionId: billing.charge.transactionId,
      description: `Lead charge (${input.actionType})`,
    });
  }

  leadLogger.info(
    {
      event: "lead_captured",
      listing_id: input.listingId,
      seller_id: sellerId,
      buyer_id: input.buyerDbId ?? null,
      action_type: input.actionType,
      billing_status: billing.status,
      cpl,
    },
    "Lead captured",
  );

  // In-app notification for the seller (best-effort; never blocks).
  setImmediate(() => {
    void createNotification({
      userId: sellerId,
      type: "lead",
      title: "New lead",
      body: `${LEAD_ACTION_LABEL[input.actionType]} interest on "${listing.title}"`,
      data: { listing_id: input.listingId, lead_id: billing.leadId },
    });
  });

  // Email the seller too (best-effort).
  void (async () => {
    try {
      if (!(await isEmailChannelEnabled(sellerId, "lead"))) return;
      const [seller] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, sellerId))
        .limit(1);
      if (!seller?.email) return;
      await sendLeadNotificationEmail({
        to: seller.email,
        sellerName: seller.name,
        listingTitle: listing.title ?? "",
        actionLabel: LEAD_ACTION_LABEL[input.actionType],
        listingId: input.listingId,
      });
    } catch (err) {
      logger.error({ err, seller_id: sellerId }, "Lead email failed");
    }
  })();

  // Increment interaction counters (best-effort).
  setImmediate(() => {
    void db
      .insert(interactions)
      .values({
        listingId: input.listingId,
        whatsappClicks: input.actionType === "whatsapp" ? 1 : 0,
        callClicks: input.actionType === "call" ? 1 : 0,
        financeRequests: input.actionType === "finance_request" ? 1 : 0,
        clicks: 1,
        views: 0,
      })
      .onConflictDoUpdate({
        target: interactions.listingId,
        set: {
          clicks: sql`${interactions.clicks} + 1`,
          whatsappClicks:
            input.actionType === "whatsapp"
              ? sql`${interactions.whatsappClicks} + 1`
              : interactions.whatsappClicks,
          callClicks:
            input.actionType === "call"
              ? sql`${interactions.callClicks} + 1`
              : interactions.callClicks,
          financeRequests:
            input.actionType === "finance_request"
              ? sql`${interactions.financeRequests} + 1`
              : interactions.financeRequests,
          updatedAt: new Date(),
        },
      });
  });

  return {
    phone: revealPhoneFromListing(listing.specs, listing.sellerPhone),
  };
}

/**
 * Awaitable core of {@link trackLead}. Production always invokes it via
 * trackLead's setImmediate so the request path never blocks; it is exported so
 * tests can assert the visibility gate deterministically without racing the
 * fire-and-forget scheduler.
 */
export async function processLead(input: TrackLeadInput): Promise<void> {
  try {
    // Get the listing's seller + role (role drives CPL billability), but only
    // if the listing is currently publicly contactable — active, not
    // abuse-flagged, and owned by a seller who is not shadow-banned. This
    // mirrors the conversation/feed visibility gate so a known listing UUID
    // cannot be used to forge billable leads against withdrawn, flagged,
    // sold, or shadow-banned inventory. A non-public listing yields no row,
    // so the lead is silently dropped: no record, no seller notification, no
    // CPL charge.
    const [listing] = await db
      .select({ userId: listings.userId, sellerRole: users.role, title: listings.title })
      .from(listings)
      .leftJoin(users, eq(listings.userId, users.id))
      .where(
        and(
          eq(listings.id, input.listingId),
          eq(listings.status, "active"),
          ...publicVisibilityConditions()
        )
      )
      .limit(1);

    if (!listing?.userId) return;
    const sellerId = listing.userId;
    const sellerRole = (listing.sellerRole ?? "individual") as UserRole;

    let buyerDbId: string | undefined;
    if (input.buyerClerkId) {
      const [buyer] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, input.buyerClerkId))
        .limit(1);
      buyerDbId = buyer?.id;
    }

    // Revenue protection: validate the lead BEFORE recording or charging.
    // Fraudulent/duplicate/bot demand is silently dropped (the abuser is
    // never told, the dealer is never charged) and audited inside validateLead.
    const decision = await validateLead({
      listingId: input.listingId,
      sellerId,
      buyerId: buyerDbId ?? null,
      ip: input.ip,
      deviceId: input.deviceId,
    });
    if (!decision.ok) return;

    // Resolve CPL server-side. Individuals are never billed for leads.
    let cpl = "0";
    if (sellerRole !== "individual") {
      const plan = await resolveEffectivePlan(sellerId, sellerRole);
      cpl = toMoney(cplForAction(plan, input.actionType));
    }

    // ── Money path: lead capture + CPL billing in ONE transaction. ──
    // The lead ALWAYS persists. Billing is best-effort on top of it:
    //  - individual / zero CPL → lead_billing(not_billable), no charge.
    //  - charged → guarded debit + ledger + invoice + lead_billing(charged).
    //  - insufficient funds → lead_billing(failed), lead still persists
    //    (the guarded debit affects 0 rows and never aborts the tx).
    // lead_billing.lead_id is UNIQUE: exactly one billing record per lead.
    const billing = await db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(leadHistory)
        .values({
          listingId: input.listingId,
          buyerId: buyerDbId ?? null,
          sellerId,
          actionType: input.actionType,
          status: "new",
          buyerName: input.buyerName ?? null,
          buyerPhone: input.buyerPhone ?? null,
        })
        .returning({ id: leadHistory.id });

      const billingBase = {
        leadId: lead.id,
        sellerId,
        buyerId: buyerDbId ?? null,
        listingId: input.listingId,
        actionType: input.actionType,
      };

      if (sellerRole === "individual" || Number(cpl) <= 0) {
        await tx.insert(leadBilling).values({
          ...billingBase,
          status: "not_billable",
          amountCharged: "0",
        });
        return { leadId: lead.id, status: "not_billable" as const };
      }

      try {
        const charge = await applyTransaction(tx, {
          userId: sellerId,
          type: "lead_charge",
          direction: "debit",
          amount: cpl,
          referenceType: "lead",
          referenceId: lead.id,
          description: `Lead charge (${input.actionType})`,
          invoice: {
            lineItems: [{ label: `Lead (${input.actionType})`, amount: cpl }],
          },
        });
        await tx.insert(leadBilling).values({
          ...billingBase,
          status: "charged",
          amountCharged: cpl,
          transactionId: charge.transactionId,
        });
        return {
          leadId: lead.id,
          status: "charged" as const,
          charge: {
            transactionId: charge.transactionId,
            balanceAfter: charge.balanceAfter,
            amount: cpl,
          },
        };
      } catch (err) {
        // Can't afford the lead: record the failed charge but keep the lead.
        if (isInsufficientFunds(err)) {
          await tx.insert(leadBilling).values({
            ...billingBase,
            status: "failed",
            amountCharged: cpl,
          });
          return { leadId: lead.id, status: "failed" as const };
        }
        throw err;
      }
    });

    if (billing.status === "charged" && "charge" in billing && billing.charge) {
      schedulePaymentSuccess({
        userId: sellerId,
        kind: "lead_charge",
        amount: billing.charge.amount,
        balanceAfter: billing.charge.balanceAfter,
        transactionId: billing.charge.transactionId,
        description: `Lead charge (${input.actionType})`,
      });
    }

    // Durable lead business-event audit trail (money path).
    leadLogger.info(
      {
        event: "lead_captured",
        listing_id: input.listingId,
        seller_id: sellerId,
        buyer_id: buyerDbId ?? null,
        action_type: input.actionType,
        billing_status: billing.status,
        cpl,
      },
      "Lead captured",
    );

    // In-app notification for the seller (best-effort; never blocks).
    await createNotification({
      userId: sellerId,
      type: "lead",
      title: "New lead",
      body: `${LEAD_ACTION_LABEL[input.actionType]} interest on "${listing.title}"`,
      data: { listing_id: input.listingId, lead_id: billing.leadId },
    });

    // Email the seller too (best-effort; respects their email preference and
    // never blocks the lead path). No-op when no email or category is muted.
    void (async () => {
      try {
        if (!(await isEmailChannelEnabled(sellerId, "lead"))) return;
        const [seller] = await db
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, sellerId))
          .limit(1);
        if (!seller?.email) return;
        await sendLeadNotificationEmail({
          to: seller.email,
          sellerName: seller.name,
          listingTitle: listing.title ?? "",
          actionLabel: LEAD_ACTION_LABEL[input.actionType],
          listingId: input.listingId,
        });
      } catch (err) {
        logger.error({ err, seller_id: sellerId }, "Lead email failed");
      }
    })();

    // Increment interaction counter
    const column = {
      whatsapp: interactions.whatsappClicks,
      call: interactions.callClicks,
      chat: interactions.clicks,
      finance_request: interactions.financeRequests,
    }[input.actionType];

    await db
      .insert(interactions)
      .values({
        listingId: input.listingId,
        whatsappClicks: input.actionType === "whatsapp" ? 1 : 0,
        callClicks: input.actionType === "call" ? 1 : 0,
        financeRequests: input.actionType === "finance_request" ? 1 : 0,
        clicks: 1,
        views: 0,
      })
      .onConflictDoUpdate({
        target: interactions.listingId,
        set: {
          clicks: sql`${interactions.clicks} + 1`,
          whatsappClicks: input.actionType === "whatsapp"
            ? sql`${interactions.whatsappClicks} + 1`
            : interactions.whatsappClicks,
          callClicks: input.actionType === "call"
            ? sql`${interactions.callClicks} + 1`
            : interactions.callClicks,
          financeRequests: input.actionType === "finance_request"
            ? sql`${interactions.financeRequests} + 1`
            : interactions.financeRequests,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.error({ err, listing_id: input.listingId }, "Failed to track lead");
  }
}

// Dedup view counts: one counted view per IP per listing per hour
const viewDedup = new Map<string, number>();
const VIEW_DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hour
const VIEW_DEDUP_MAX_SIZE = 50000;

// Periodically evict expired dedup entries
setInterval(() => {
  const cutoff = Date.now() - VIEW_DEDUP_TTL_MS;
  for (const [key, ts] of viewDedup) {
    if (ts < cutoff) viewDedup.delete(key);
  }
}, 10 * 60 * 1000).unref();

export async function incrementView(listingId: string, ip?: string): Promise<void> {
  if (ip) {
    const dedupKey = `${ip}:${listingId}`;
    const last = viewDedup.get(dedupKey);
    const now = Date.now();
    if (last !== undefined && now - last < VIEW_DEDUP_TTL_MS) return;
    // Enforce size cap before inserting
    if (viewDedup.size >= VIEW_DEDUP_MAX_SIZE) {
      const oldestKey = viewDedup.keys().next().value;
      if (oldestKey !== undefined) viewDedup.delete(oldestKey);
    }
    viewDedup.set(dedupKey, now);
  }

  setImmediate(async () => {
    try {
      await db
        .insert(interactions)
        .values({ listingId, views: 1, clicks: 0 })
        .onConflictDoUpdate({
          target: interactions.listingId,
          set: {
            views: sql`${interactions.views} + 1`,
            updatedAt: new Date(),
          },
        });
    } catch {}
  });
}

export async function getDealerLeads(
  dbUserId: string,
  options: { cursor?: string; limit?: number; status?: string; action_type?: string }
) {
  const { cursor, limit = 20, status, action_type } = options;

  const conditions = [eq(leadHistory.sellerId, dbUserId)];
  if (status) conditions.push(eq(leadHistory.status, status as "new" | "contacted" | "closed"));
  if (action_type) conditions.push(eq(leadHistory.actionType, action_type as "whatsapp" | "call" | "chat" | "finance_request"));
  if (cursor) conditions.push(sql`${leadHistory.createdAt} < ${new Date(cursor)}`);

  const rows = await db
    .select({
      id: leadHistory.id,
      listing_id: leadHistory.listingId,
      action_type: leadHistory.actionType,
      status: leadHistory.status,
      buyer_name: leadHistory.buyerName,
      buyer_phone: leadHistory.buyerPhone,
      created_at: leadHistory.createdAt,
      listing_title: listings.title,
    })
    .from(leadHistory)
    .leftJoin(listings, eq(leadHistory.listingId, listings.id))
    .where(and(...conditions))
    .orderBy(desc(leadHistory.createdAt))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasNext && page.length > 0 ? page[page.length - 1].created_at?.toISOString() : undefined;

  return {
    items: page.map((r) => ({
      id: r.id,
      listing_id: r.listing_id,
      listing_title: r.listing_title ?? "Unknown",
      action_type: r.action_type,
      status: r.status,
      buyer_name: r.buyer_name,
      buyer_phone: r.buyer_phone,
      created_at: r.created_at?.toISOString(),
    })),
    cursor: nextCursor,
    has_next: hasNext,
  };
}

export async function updateLeadStatus(
  leadId: string,
  sellerId: string,
  status: "new" | "contacted" | "closed"
) {
  await db
    .update(leadHistory)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(leadHistory.id, leadId), eq(leadHistory.sellerId, sellerId)));
  // Lead outcomes feed the dealer quality score (response/conversion rate).
  recomputeDealerQuality(sellerId);
  return { updated: true };
}

export async function getDealerStats(dbUserId: string) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [activeCount, totalCount, leadsToday, leadsMonthly] = await Promise.all([
    db
      .select({ cnt: count() })
      .from(listings)
      .where(and(eq(listings.userId, dbUserId), eq(listings.status, "active"))),
    db
      .select({ cnt: count() })
      .from(listings)
      .where(eq(listings.userId, dbUserId)),
    db
      .select({ cnt: count() })
      .from(leadHistory)
      .where(and(eq(leadHistory.sellerId, dbUserId), gte(leadHistory.createdAt, todayStart))),
    db
      .select({
        day: sql<string>`DATE(${leadHistory.createdAt})`,
        cnt: count(),
      })
      .from(leadHistory)
      .where(and(eq(leadHistory.sellerId, dbUserId), gte(leadHistory.createdAt, thirtyDaysAgo)))
      .groupBy(sql`DATE(${leadHistory.createdAt})`),
  ]);

  const totalLeadsAllTime = await db
    .select({ cnt: count() })
    .from(leadHistory)
    .where(eq(leadHistory.sellerId, dbUserId));

  const totalViewsResult = await db
    .select({ total: sql<number>`SUM(${interactions.views})` })
    .from(interactions)
    .innerJoin(listings, eq(interactions.listingId, listings.id))
    .where(eq(listings.userId, dbUserId));

  const totalViews = Number(totalViewsResult[0]?.total ?? 0);
  const totalLeads = Number(totalLeadsAllTime[0]?.cnt ?? 0);
  const conversionRate = totalViews > 0 ? ((totalLeads / totalViews) * 100).toFixed(1) : "0";

  return {
    active_listings: Number(activeCount[0]?.cnt ?? 0),
    total_listings: Number(totalCount[0]?.cnt ?? 0),
    leads_today: Number(leadsToday[0]?.cnt ?? 0),
    conversion_rate: `${conversionRate}%`,
    total_views: totalViews,
    leads_chart: leadsMonthly.map((r) => ({ date: r.day, leads: Number(r.cnt) })),
  };
}
