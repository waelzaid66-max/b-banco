# Phase 04 — Authentication (Clerk)

**Status:** `pass_with_reservations`  
**Date:** 2026-07-08  
**Scope:** Clerk integration presence — no auth rewrite.

---

## Verdict

| Area | Result |
|------|--------|
| API auth middleware / Clerk secret | Present — requires `CLERK_SECRET_KEY` at runtime |
| Mobile `@clerk/expo` | Present — requires publishable key at build |
| Admin / dealer Clerk gates | Present (`is_admin`, seller roles) |
| Staging JWT smoke | **OPS** — `CLERK_BEARER_TOKEN` |

---

## Reservations (OPS — not code defects)
- OTP email, Google, Apple Sign-In depend on Clerk dashboard + provider secrets.
- See `STAGING-REQUIRED-SECRETS.md` §A–D.

## Code changes this phase
None — configuration/provider setup only.
