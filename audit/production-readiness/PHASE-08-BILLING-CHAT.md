# Phase 08 — Billing, Notifications & Chat

**Status:** `pass_with_reservations`  
**Date:** 2026-07-08  
**Scope:** Confirm B1–B4 + messaging intact — **Paymob stays off**.

---

## Complete in product (do not re-implement)

| Area | Evidence |
|------|----------|
| Wallet / billing hub UI | Mobile `/billing`, `/wallet`, invoices PDF/CSV (B4) |
| Billing notifications enum patch | `ensureSchema.ts` payment_* / subscription_expiring |
| Chat / conversations API | `routes/v1/conversations.ts` + mobile messages tab |
| Notifications API + push tokens | `routes/v1/notifications.ts` |
| Admin revenue / plans | admin-os pages — structure only |

## Reservations
| Item | Type |
|------|------|
| Push delivery (FCM/APNs) | **OPS** |
| Resend / OTP email | **OPS** |
| Paymob live checkout | **SKIP** until admin B5 |

## Code changes this phase
None.
