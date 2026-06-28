import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  monthIndexFrom,
  startOfNextMonth,
  getPromoSummary,
} from "./PromoAdCreditService";
import { db, createUser, deleteUsers } from "../__tests__/helpers";
import { users } from "@workspace/db/schema";

/**
 * PromoAdCreditService is an untested MONEY service. These cover the timezone-
 * aware month math that drives monthly grant/expiry (Africa/Cairo) and the
 * user-facing balance view (effective balance respects expiry). consumePromoCredit
 * is already exercised indirectly by AdsService's promo tests.
 */
const uids: string[] = [];

afterAll(async () => {
  await deleteUsers(...uids);
});

// Wall-clock parts of an instant rendered in the campaign timezone (Africa/Cairo).
function cairoParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return m;
}

describe("PromoAdCreditService — month math (grant/expiry timing)", () => {
  it("monthIndexFrom counts whole calendar months, incl. across years and backwards", () => {
    expect(monthIndexFrom(new Date("2024-01-15T12:00:00Z"), new Date("2024-01-20T12:00:00Z"))).toBe(0);
    expect(monthIndexFrom(new Date("2024-01-15T12:00:00Z"), new Date("2024-02-15T12:00:00Z"))).toBe(1);
    expect(monthIndexFrom(new Date("2024-11-15T12:00:00Z"), new Date("2025-02-15T12:00:00Z"))).toBe(3);
    expect(monthIndexFrom(new Date("2024-03-15T12:00:00Z"), new Date("2024-01-15T12:00:00Z"))).toBe(-2);
  });

  it("startOfNextMonth returns the 1st at 00:00 of next month (Cairo), rolling the year over", () => {
    const r = startOfNextMonth(new Date("2024-03-15T12:00:00Z"));
    const p = cairoParts(r);
    expect(Number(p.day)).toBe(1);
    expect(Number(p.month)).toBe(4);
    expect(Number(p.hour)).toBe(0);

    const dec = startOfNextMonth(new Date("2024-12-15T12:00:00Z"));
    const pd = cairoParts(dec);
    expect(Number(pd.day)).toBe(1);
    expect(Number(pd.month)).toBe(1);
    expect(Number(pd.year)).toBe(2025);

    // Always strictly in the future relative to the input instant.
    expect(startOfNextMonth(new Date()).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("PromoAdCreditService.getPromoSummary — effective balance respects expiry", () => {
  it("reports an unexpired balance and zeroes an expired one", async () => {
    const userId = await createUser({ role: "dealer" });
    uids.push(userId);
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(users)
      .set({ promoAdBalance: "100", promoAdBalanceExpiresAt: future, isVerified: true })
      .where(eq(users.id, userId));
    const live = await getPromoSummary(userId);
    expect(Number(live.balance)).toBe(100);
    expect(live.expires_at).not.toBeNull();

    const past = new Date(Date.now() - 60_000);
    await db
      .update(users)
      .set({ promoAdBalanceExpiresAt: past })
      .where(eq(users.id, userId));
    const dead = await getPromoSummary(userId);
    expect(Number(dead.balance)).toBe(0);
    expect(dead.expires_at).toBeNull();
  });
});
