# Phase 02 — Database & Schema

**Status:** `pass_with_reservations`  
**Date:** 2026-07-08  
**Scope:** Drizzle schema, `upload_claims`, boot patches, indexes — **inspection only**; no publish/ranking changes.

---

## Verdict

| Layer | Result |
|-------|--------|
| Schema in repo (`lib/db`) | **PASS** — `uploadClaims` table + indexes declared |
| Boot patches | **PASS** — `ensureSchemaPatches()` on every api-server boot |
| Tests | **PASS in CI** — `ensureSchema.test.ts` + vitest Vite global setup |
| Staging/prod instance prove | **OPS** — requires `DATABASE_URL` (see STAGING-REQUIRED-SECRETS.md) |

---

## What was inspected (complete — do not re-implement)

| Item | Path | Status |
|------|------|--------|
| `upload_claims` Drizzle table | `lib/db/src/schema/index.ts` | Complete |
| Idempotent CREATE TABLE/INDEX | `lib/db/src/ensureSchema.ts` | Complete |
| Billing notification enum patches | same file | Complete |
| Called from boot | `artifacts/api-server/src/lib/bootstrap.ts` → `ensureDbExtensions` | Complete |
| Non-fatal on failure | logs + continues (liveness preserved) | By design |
| pg_trgm + search GIN indexes | `bootstrap.ts` `ensureSearchIndexes` | Complete |
| Verify script | `scripts/verify-upload-claims-schema.mjs` | Complete (needs `DATABASE_URL`) |

---

## Findings

### Critical / High code bugs
**None proven.** Schema path matches C-01 design.

### Reservations (OPS / awareness)
1. If `ensureSchemaPatches` fails silently at boot, media attach returns 403 until DB fixed — verify with staging script.
2. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction; implementation already per-statement try/catch.
3. Full `drizzle-kit push` on shared DBs remains forward-only (see MIGRATION-ROLLBACK-PLAYBOOK).

---

## Deferred to operator
- [ ] `DATABASE_URL=… node scripts/verify-upload-claims-schema.mjs` on staging

## Fixed this phase
None (code already complete). Documentation closed here.
