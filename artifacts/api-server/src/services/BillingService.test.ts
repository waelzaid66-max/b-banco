import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { listInvoices, getInvoice, getBillingReport } from "./BillingService";
import { settleSubscriptionIntentByWebhook } from "./SubscriptionService";
import { db, createUser, deleteUsers, randomUUID } from "../__tests__/helpers";
import { plans, paymentIntents } from "@workspace/db/schema";

/**
 * BillingService is the user-facing billing history/report (untested). We seed
 * real billing data through the subscription settlement money path (which writes
 * a wallet_topup credit + a subscription_charge debit with an invoice), then
 * assert the invoice list, the IDOR guard on a single invoice, and the monthly
 * ledger report. Needs a SEEDED db (a non-baseline plan must exist).
 */
let userId: string;
let otherUserId: string;
let invoiceId: string;
let amount: number;
const uids: string[] = [];

beforeAll(async () => {
  userId = await createUser({ role: "dealer" });
  otherUserId = await createUser({ role: "dealer" });
  uids.push(userId, otherUserId);

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isBaseline, false), eq(plans.isActive, true)))
    .limit(1);
  amount = Number(plan.monthlyPrice);

  const intentId = randomUUID();
  await db.insert(paymentIntents).values({
    id: intentId,
    userId,
    amount: plan.monthlyPrice,
    method: "instapay",
    purpose: "subscription",
    status: "pending",
    planId: plan.id,
  });
  await settleSubscriptionIntentByWebhook(intentId);

  const page = await listInvoices(userId);
  invoiceId = page.items[0]?.id;
});

afterAll(async () => {
  await deleteUsers(...uids);
});

describe("BillingService", () => {
  it("lists the user's invoices with the joined charge type + line items", async () => {
    const page = await listInvoices(userId);
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    const inv = page.items[0];
    expect(inv.transaction_type).toBe("subscription_charge");
    expect(inv.invoice_number).toBeTruthy();
    expect(Number(inv.amount)).toBe(amount);
    expect(inv.line_items && inv.line_items.length).toBeGreaterThan(0);
  });

  it("getInvoice enforces ownership — another user's invoice reads as not found (IDOR)", async () => {
    const mine = await getInvoice(userId, invoiceId);
    expect(mine.id).toBe(invoiceId);
    await expect(getInvoice(otherUserId, invoiceId)).rejects.toThrow(/not found/i);
  });

  it("getBillingReport summarizes the month's ledger (charged vs topped-up)", async () => {
    const report = await getBillingReport(userId);
    // settle wrote one +amount credit (topup) and one -amount debit (charge).
    expect(Number(report.total_charged)).toBe(amount);
    expect(Number(report.total_topped_up)).toBe(amount);
    expect(report.transaction_count).toBe(2);
    const types = report.by_type.map((b) => b.type);
    expect(types).toContain("subscription_charge");
    expect(types).toContain("wallet_topup");
  });
});
