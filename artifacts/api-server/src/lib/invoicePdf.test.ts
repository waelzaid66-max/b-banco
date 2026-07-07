import { describe, it, expect } from "vitest";
import { buildInvoicePdf } from "./invoicePdf";
import type { InvoiceItem } from "../services/BillingService";

const sample: InvoiceItem = {
  id: "00000000-0000-4000-8000-000000000001",
  invoice_number: "INV-TEST-001",
  amount: "150.00",
  status: "paid",
  transaction_id: "00000000-0000-4000-8000-000000000002",
  transaction_type: "subscription_charge",
  description: "Pro plan",
  line_items: [{ label: "Monthly subscription", amount: "150.00" }],
  issued_at: "2026-07-01T00:00:00.000Z",
  created_at: "2026-07-01T00:00:00.000Z",
};

describe("buildInvoicePdf", () => {
  it("returns a valid PDF header and includes the invoice number", () => {
    const pdf = buildInvoicePdf(sample);
    const text = pdf.toString("utf8");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("INV-TEST-001");
    expect(text).toContain("%%EOF");
  });
});
