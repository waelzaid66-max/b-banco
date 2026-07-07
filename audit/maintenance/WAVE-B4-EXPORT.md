# Wave B4 — Invoice PDF & billing CSV export

_Date: 2026-07-08 · Production hardening · additive only_

## Goal

Let users download a PDF receipt for a single invoice and export a monthly billing statement as CSV from the mobile Payments hub — without removing existing wallet/invoice screens.

## Delivered

| ID | Item | Implementation |
|----|------|----------------|
| B4.1 | Server invoice PDF | `GET /v1/billing/invoices/{id}/pdf` → minimal PDF 1.4 (`buildInvoicePdf`) |
| B4.2 | Monthly statement CSV | `GET /v1/billing/report.csv?month=YYYY-MM` → `billingReportToCsv` |
| B4.3 | Mobile share/download | `lib/billingExport.ts` — web download + native share via `expo-sharing` |
| B4.4 | Contract | `openapi.yaml` + orval (`getInvoicePdf`, `getBillingReportCsv`) |
| B4.5 | i18n | `billing.*` + `invoices.*` blocks (en/ar) |
| B4.6 | Tests | `invoicePdf.test.ts`, `billingCsv.test.ts`, `test:lib` guards |

## Security

- PDF and CSV routes use the same auth + `getInvoice` / `getBillingReport` ownership checks as JSON endpoints (IDOR → 404).

## Verification (local)

```bash
# API unit tests
cd artifacts/api-server && npx vitest run src/lib/invoicePdf.test.ts src/lib/billingCsv.test.ts

# Mobile regression
cd artifacts/banco-mobile && node --test tests/lib-hardening.test.mjs

# Typecheck
cd artifacts/banco-mobile && npx tsc -p tsconfig.json --noEmit
cd artifacts/api-server && node build.mjs
```

## Out of scope

- B5 Paymob / external payment rails
- AWS / GCP / store deploy

## P0 follow-up (unchanged)

- CI green on GitHub for this commit
- Staging smoke per `WAVE-P0-STAGING-VALIDATION.md` (Clerk + real storage byte-path)
