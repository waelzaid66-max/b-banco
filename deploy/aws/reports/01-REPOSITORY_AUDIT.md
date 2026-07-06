# 01 — Repository Audit Report

> Full inspection of the monorepo. Every fact below was read from the source, not
> assumed. Source revision: the `main` HEAD this repo was cloned from.

## Applications & services

| # | App | Type | Runtime | Deployed to AWS? | Build output |
|---|-----|------|---------|------------------|--------------|
| 1 | `artifacts/api-server` | Express 5 HTTP API | Node 24 | **Yes** (container) | esbuild → `dist/index.mjs` (+ pino workers) |
| 2 | `artifacts/dealer-os` (Banco Market) | Vite SPA | static | **Yes** (Nginx) | `dist/` |
| 3 | `artifacts/admin-os` (Admin) | Vite SPA | static | **Yes** (Nginx) | `dist/` |
| 4 | `artifacts/landing` | Vite SPA | static | **Yes** (Nginx) | `dist/` |
| 5 | `artifacts/banco-mobile` | Expo React Native | native | **No** — ships to app stores via **EAS**, not AWS | — |
| 6 | `artifacts/mockup-sandbox` | Vite (dev sandbox) | static | No (not production) | — |
| — | `lib/*` | Shared TS libs (db, api-zod, api-client-react, taxonomy, integrations-openai-ai-server) | — | consumed by the above | — |

Monorepo: **pnpm workspace** (`pnpm@11.9.0`, pinned via `packageManager`). Node 24
required (pnpm 11.9 uses `node:sqlite`).

## Ports

- **API**: `PORT` env — **required**; the process throws at boot if unset (`src/index.ts`). No hardcoded port. Binds the port FIRST, then ensures DB extensions in the background (so liveness never depends on the DB).
- **Web**: static; served by Nginx on 80 (TLS terminated by ALB/CloudFront or certbot).
- No other listeners. **No WebSocket / socket.io server** (messaging uses HTTP polling).

## Health endpoints (`artifacts/api-server/src/routes/health.ts`)

| Path | Purpose | Touches DB? | Status |
|------|---------|-------------|--------|
| `GET /api` | root liveness (platform probe) | No | 200 `{status:ok}` |
| `GET /api/healthz` | liveness | No | 200 |
| `GET /api/livez` | liveness alias | No | 200 |
| `GET /api/readyz` | **readiness** (2s time-boxed `SELECT 1`) | Yes | 200 healthy / **503** when DB down |

Correct liveness-vs-readiness split → safe for ALB target-group health checks.

## Database

- **PostgreSQL** (CI uses `postgres:16`). Accessed via **Drizzle ORM** (`lib/db`).
- Schema applied by **`drizzle-kit push`** (PUSH mode, not versioned SQL migrations). History is additive-only (tables/columns/enum values added, never destructive).
- **Requires the `pg_trgm` extension** (fuzzy search). App self-heals it at boot (`ensureDbExtensions`); we also create it in `db-migrate.sh`.
- **Seeds required on a fresh DB**: plans baseline (`seed`), reference locations, car brands, admin allowlist (`seed:*` scripts). The integration suite runs against a seeded DB.

## Object storage 🚩

- `artifacts/api-server/src/lib/objectStorage.ts` uses **`@google-cloud/storage`** pointed at a **Replit sidecar** (`http://127.0.0.1:1106`) with Replit `external_account` credentials.
- **This is a hard Replit dependency and will NOT work on AWS.** It is the single blocking code change for AWS. See `05-SECURITY_REVIEW.md` → REQUIRED CHANGE (S3 adapter). Env it reads: `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`.

## Schedulers / cron / queues

- In-process **`node-cron`** (`src/jobs/index.ts`) with **Postgres advisory locks** so that with multiple instances only ONE runs each job. Timezone from `CRON_TIMEZONE` (default `Africa/Cairo`).
- Jobs: archive old listings (daily 03:00), dealer performance (Mon 04:00), subscription expiry, weekly reports, staff-role backfill, promo ad-credit cycle.
- **No external queue** (no SQS/SNS/Redis/BullMQ). Nothing to provision for jobs.

## Integrations

| Concern | Provider | Env |
|---|---|---|
| Auth | **Clerk** | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` |
| Payments | **Paymob** (test/live, HMAC webhook) | `PAYMOB_*` (6 vars) + `PAYMENT_CONFIG_ENCRYPTION_KEY` |
| Email | **Resend** | `RESEND_API_KEY`, `EMAIL_FROM` |
| AI | **OpenAI** (direct; optional base-URL override is Replit-only) | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Error alerts | webhook (Slack-style) | `ERROR_ALERT_WEBHOOK` |
| Uploads | object storage (see above) | — |

## Build & startup scripts

- API: `build` → `node ./build.mjs` (esbuild, externalizes native pkgs incl. `@google-cloud/*`, `pg-native`, `sharp` → **runtime needs prod `node_modules`**). `start` → `node --enable-source-maps ./dist/index.mjs`.
- Web: `vite build` per app → `dist/`.
- DB: `lib/db` → `drizzle-kit push` / `push-force`.
- Root: `pnpm run typecheck` (all packages), `pnpm -r run build`.

## CI (existing)

`.github/workflows/ci.yml` — on push/PR: pnpm (pinned), Node 24, `pnpm install`,
`typecheck`, build (api + 3 web apps), then the **api-server suite against a real
`postgres:16`** (pg_trgm enabled, schema pushed, seeded, `TZ=UTC`). **No CD
workflow existed** — added `deploy.yml`.

## Security-relevant facts (detail in report 05)

- Secrets: **none in git** (verified). Read from env only.
- CORS: allowlist via `CORS_ALLOWED_ORIGINS` (+ Replit domains — ignored on AWS).
- Rate limiting: present (`middlewares/rateLimiter`, applied per route).
- Payment provider config encrypted at rest (`secretCrypto.ts`, `PAYMENT_CONFIG_ENCRYPTION_KEY`).
- Global error capture (`unhandledRejection` non-fatal, `uncaughtException` → report + exit for clean restart).
