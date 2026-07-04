# BANCO / B‑OOM — Replit Full‑Deploy Handoff

**For the Replit environment.** This is the single authoritative runbook to bring
Replit fully up to date with everything built this cycle and deploy a complete,
stable release. Every change is **additive** — no table renamed, no data deleted,
no API or business logic changed.

**Repo state:** GitHub `B-OOM` (`boom`) and `b.deals` (`origin`) are in sync at
commit **`a693016`**. Pull that.

---

## Step 1 — Pull + install
```bash
git pull            # to a693016 (or later)
pnpm install
```
> pnpm is pinned by `packageManager: pnpm@11.9.0` in package.json (single source —
> the CI "Multiple versions of pnpm" error was fixed this cycle).

## Step 2 — Apply the schema (additive only)
```bash
pnpm --filter @workspace/db run push-force
```
This creates the NEW tables and columns (nothing dropped):
- **Geo/real‑estate reference:** `reference_places`, `reference_developers`, `pending_locations`
- **Market insights:** `price_observations`
- **Cars:** new optional columns on the existing `brands` table (name_ar, country,
  parent_company, founded_year, logo_url, is_active, is_premium, is_electric,
  is_commercial, popularity, search_keywords, updated_at) + two indexes

The API server also self‑heals trigram indexes on boot (`ensureDbExtensions`),
so search stays fast on the new reference tables.

## Step 3 — Seed the data (in this order)
```bash
pnpm --filter @workspace/api-server run seed                    # base taxonomy (locations, existing cars) — safe/idempotent
pnpm --filter @workspace/api-server run seed:reference          # Egypt geo/real-estate reference (15 developers, 169 places)
pnpm --filter @workspace/api-server run seed:car-brands         # 111 global car brands (enrich in place, no dup)
pnpm --filter @workspace/api-server run seed:car-models         # 327 real car models across 26 brands (run AFTER car-brands)
pnpm --filter @workspace/api-server run backfill:observations   # real price history from EXISTING listings (deal ratings)
```
All seeds are **idempotent** (upsert by slug / global_id / listing) — safe to
re‑run; they never duplicate.

## Step 4 — Secrets (Replit → Secrets; never in code)
| Secret | Powers | Without it |
|---|---|---|
| `DATABASE_URL` | Postgres | app can't start |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | auth | login fails |
| `OPENAI_API_KEY` | AI assistant | assistant returns an error (model now auto‑selects `gpt-4o-mini` for a direct key — no `OPENAI_MODEL` needed) |
| `RESEND_API_KEY` | transactional email | email renders to log only |
| `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_IDS` | payments | checkout fails |
| Object Storage credentials | media upload | uploads fail |

## Step 5 — Clerk dashboard (not code)
- Enable **Email verification code** (OTP is sent by Clerk, not Resend).
- Enable **Google** and **Apple** OAuth providers + redirect URIs.

## Step 6 — Build + run
```bash
pnpm --filter @workspace/api-server --filter @workspace/dealer-os --filter @workspace/admin-os --filter @workspace/landing run build
# then start the API server workflow (it binds the port even if the DB blips — liveness ≠ readiness)
```

## Step 7 — Smoke‑verify
- `GET /healthz` → 200
- Assistant: open it in the app after `OPENAI_API_KEY` is set → it replies grounded in real data.
- Reference search: `GET /v1/reference/places?q=التجمع` → returns settlements.
- Deal insights: open any listing → `GET /v1/listings/{id}/insights`; the rating
  chip shows once its market segment has enough real observations.
- Cars: create‑listing brand picker shows the enriched global brands; model
  autocomplete resolves e.g. "كورولا" / "Land Cruiser".

---

## What changed this cycle (so Replit has the full picture)
Newest first — all on `main`, typecheck 0, backend suite **257 passed / 0 failed**:

| Commit | What | Why |
|---|---|---|
| `a693016` | 327 car models (26 brands) | model dictionary / autocomplete bootstrap |
| `cf156b7` | 111 global car brands (enrich `brands`) | cars section understands make/origin/EV/premium |
| `36832ae` | `GET /v1/reference/places` | reference data searchable (autocomplete) |
| `65595c3` | deal‑rating chip on listing detail | A2 visible to buyers |
| `183047b` | CI pnpm‑version fix | CI was failing "Multiple versions of pnpm" |
| `3da76b3` | `GET /v1/listings/{id}/insights` | A2 API layer |
| `afc11f0` | `/release` RC audit report set | release documentation |
| `b806070` | Deal‑Rating engine (price_observations) | market insights + price history |
| `edc4cf3` | global geo/real‑estate reference (Egypt) | location autocomplete backbone |
| `e5384f5` | AI model default + UTC test suite | assistant worked only with extra config; test flake |
| `993746c`…`cf1e3a5` | Admin Control i18n 100% (17/17 pages) | full AR/EN + RTL admin |

## Reports (all under `/release`)
`FINAL_AUDIT.md` · `RELEASE_CHECKLIST.md` · `DEPLOYMENT.md` · `SECURITY_REPORT.md` ·
`USER_JOURNEY_REPORT.md` · `UPLOAD_AUDIT.md` · `TEST_REPORT.md` ·
`PERFORMANCE_REPORT.md` · `KNOWN_LIMITATIONS.md` · `BUILD_REPORT.md` ·
`CAR_BRANDS_REPORT.md` · `CHANGELOG.md`. Also `RELEASE_AUDIT.md` at the repo root.

## One store‑prep flag (before mobile submission, needs the production domain)
`artifacts/banco-mobile/app.json` → `plugins → expo-router → origin` is
`https://replit.com/`; set it to the production domain so deep links resolve to
BANCO. Also set iOS `buildNumber` explicitly for resubmissions.

## Safety notes
- All migrations are additive; `push-force` only ADDs the new tables/columns.
- Tests pin `TZ=UTC` (matches Replit/CI); production is UTC.
- No `.env` is tracked; secret scan is clean.
