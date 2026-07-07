import { describe, it, expect } from "vitest";
import { billingReportToCsv } from "./billingCsv";
import type { BillingReport } from "../services/BillingService";

describe("billingReportToCsv", () => {
  it("serializes summary and per-type rows", () => {
    const report: BillingReport = {
      month: "2026-07",
      currency: "EGP",
      total_charged: "100.00",
      total_topped_up: "100.00",
      transaction_count: 2,
      by_type: [
        { type: "wallet_topup", total: "100.00", count: 1 },
        { type: "subscription_charge", total: "-100.00", count: 1 },
      ],
    };
    const csv = billingReportToCsv(report);
    expect(csv).toContain("month,2026-07");
    expect(csv).toContain("type,total,count");
    expect(csv).toContain("wallet_topup,100.00,1");
  });
});
