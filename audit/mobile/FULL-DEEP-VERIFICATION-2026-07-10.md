# Full deep verification — 2026-07-10 (re-run)

**Branch:** `fix/mobile-master-stabilize`  
**Rule:** No fake green. Code ≠ Live ≠ Device ≠ Store.

---

## Verdict

| Layer | Result | Evidence |
|-------|--------|----------|
| M01–M31 code presence | **FOUND (all)** | Static review of mobile/API/web/search-contract sources |
| Security P0 code (C-01…C-03, H-03) | **FOUND** | `uploadClaims`, `escapeLikeLiteral`, `feedVisibility`, ACL promote |
| Local automated (no secrets) | **PASS** after 1 stale-test fix | See §A |
| Live Replit | **STALE (FAIL)** | `probe-live-deploy.mjs` exit 2 |
| API vitest needing `DATABASE_URL` | **BLOCKED locally** | uploadClaims / feedVisibility / BffService cannot boot |
| Staging smoke / schema verify | **BLOCKED** | no `CLERK_BEARER_TOKEN` / `DATABASE_URL` in agent env |
| Device QA / EAS | **NOT RUN** | human OPS |

**Honest product status:** Mobile stabilize **code** is closed and locally proven. **Publish path** is still blocked on Replit redeploy → secrets → device.

---

## A) Automated runs (this session)

| Suite | Command | Exit | Detail |
|-------|---------|------|--------|
| Mobile regression | `node --test` icons+lib+resilience+universal-links | **0** | **34/34** |
| proof-isolation | `node audit/mobile/scripts/proof-isolation.mjs` | **0** | all M27–M31 flags true |
| proof-create-fields | `node audit/mobile/scripts/proof-create-fields.mjs` | **0** | pass |
| search-contract | `pnpm --filter @workspace/search-contract run test` | **0** | **33/33** (after fix) |
| allowCommodityMaterialFilter | `node --import tsx --test …allowCommodityMaterialFilter.test.ts` | **0** | **4/4** |
| Live probe | `probe-live-deploy.mjs` | **2** | EG≡SA, bad ISO 200, no bookable/price |
| ops-next-step | wraps probe | **2** | points at NEXT-OPS-REPLIT-REDEPLOY |
| staging-p0-smoke | needs JWT + live API | **FAIL** | Default host is dead Replit preview (404 “Run this app”); no `CLERK_BEARER_TOKEN` |
| verify-upload-claims-schema | needs reachable DB | **FAIL** | `DATABASE_URL` present but host `ENOTFOUND` (Supabase DNS unreachable here) |
| uploadClaims / feedVisibility / BffService via node:test | need DB module | **1** | `DATABASE_URL must be set` at import (or unreachable) |

### Finding fixed during verification

`search-contract` had **1 failing** test: URL round-trip expected `rentalTerm: "monthly"` on **facilities**.  
Product gates correctly **omit** `rental_term` unless `real_estate` + rent browse; M31 replaced dead `monthly` with `new_law`.

**Fix:** test now round-trips `real_estate` + `rent` + `new_law`, plus asserts facilities drops rentalTerm.  
Stale `monthly` removed from mobile-web-parity golden.

---

## B) M01–M31 code audit (strict)

All IDs **FOUND** in source (not docs). Summary:

- Profile/create/home/search/map/discover/messenger/assistant/notifications: M01–M21, M25–M27 present in `artifacts/banco-mobile`.
- API market + map bookable + material gate: M23–M24, M28 in `SearchService` / `allowCommodityMaterialFilter`.
- Web parity M22, M29–M30 in `banco-web` SearchControls / map / markets.
- M31 hub `new_law`, feed/home `market_country`, facet CLEAR: search-contract + mobile home.

Full path table: agent explore pass 2026-07-10 (same day).

---

## C) Security P0

| Fix | Code | Local auto test |
|-----|------|-----------------|
| C-01 upload_claims IDOR | FOUND | Needs `DATABASE_URL` (vitest) |
| C-02 LIKE escape | FOUND | **No dedicated test** (WEAK) |
| C-03 deleted-user visibility | FOUND | Needs `DATABASE_URL` |
| H-03 ACL Clerk owner | FOUND | Needs `DATABASE_URL` / objectStorage vitest |

---

## D) What remains for “full success”

1. Redeploy Replit from this branch → probe **FRESH**
2. `BANCO_API_URL` + `CLERK_BEARER_TOKEN` → `staging-p0-smoke.mjs`
3. `DATABASE_URL` → schema verify + API vitest P0 suite
4. EAS preview + Device QA checklists
5. Production store only after 1–4

Do **not** claim store readiness while Live is STALE.
