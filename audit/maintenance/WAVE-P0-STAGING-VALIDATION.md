# Wave P0 — Staging validation (upload schema + smoke)

**Date:** 2026-07-08  
**Plan ref:** `MASTER-MAINTENANCE-READINESS-PLAN.md` §4 P0 items 2–4  
**Scope:** No AWS/GCP/store deploy — validation only.

---

## P0-2 — CI green ✅

Verified on GitHub Actions for `main` @ `49bcf62`:

- **Typecheck & build** — success  
- **API tests (Postgres)** — success (includes `health.test.ts`, `ensureSchema.test.ts`, `uploadClaims.test.ts`)  
- **ESLint (scripts)** — success after P2-11

```bash
gh run list --branch main --limit 3
# or public API:
# https://github.com/waelzaid66-max/-BANCO-CA-OOM-/actions
```

---

## P0-3 — `upload_claims` on staging/prod (C-01)

### Automated (CI + tests + boot)

- CI runs `pnpm --filter @workspace/db run push-force` before tests.
- `ensureSchemaPatches()` runs on **api-server boot** and **vitest global setup** (idempotent fallback).
- Regression: `artifacts/api-server/src/lib/ensureSchema.test.ts`

```bash
pnpm --filter @workspace/api-server test ensureSchema
pnpm --filter @workspace/api-server test uploadClaims
```

### Staging/prod DB verify (run once per environment)

```bash
DATABASE_URL=postgresql://... node scripts/verify-upload-claims-schema.mjs
```

Or:

```bash
pnpm --filter @workspace/db run push-force
```

---

## P0-4 — Staging smoke (Clerk + real storage byte-path)

### Automated script

```bash
BANCO_API_URL=https://your-staging-api.example.com \
CLERK_BEARER_TOKEN=eyJ... \
CLERK_BEARER_TOKEN_OTHER=eyJ... \
node scripts/staging-p0-smoke.mjs
```

| Step | Check | Pass criteria |
|------|--------|----------------|
| 1 | `GET /api/healthz` | 200 without auth |
| 2 | `GET /api/readyz` | 200 when DB up |
| 3 | `POST /v1/uploads/request-url` | 200 + presigned URL; row in `upload_claims` |
| 4 | PUT bytes to presigned URL | 200/204 |
| 5 | `POST /v1/uploads/verify` | 200 |
| 6 | `POST /v1/uploads/promote` (same user) | 200 |
| 7 | `POST /v1/uploads/promote` (other user, same URL) | **403** (IDOR blocked) |
| 8 | GET serving URL | 200 |

**Prerequisites:** staging API URL, Clerk JWT, `OBJECT_STORAGE_*` configured (S3/GCS/Replit).

### Mobile smoke (manual)

1. Profile → **Payments** → Billing hub → Wallet / Invoices / Plans
2. Profile → **Rental hub** (if bookable listings) → Host bookings
3. Notification tap: `booking` → `/bookings?role=host`
4. Notification tap: `payment_failed` → `/billing`

---

## Wave close-out checklist

- [x] PH-1 committed + pushed
- [x] CI green on `main` (GitHub Actions)
- [x] `ensureSchema` + `uploadClaims` + `health` tests in CI suite
- [x] Staging verify script: `scripts/verify-upload-claims-schema.mjs`
- [x] Staging upload smoke script: `scripts/staging-p0-smoke.mjs`
- [ ] Run verify + smoke **on your staging host** (needs env secrets)

**Next:** RC validation / EAS preview — not cloud production deploy. B5 Paymob remains admin-only.
