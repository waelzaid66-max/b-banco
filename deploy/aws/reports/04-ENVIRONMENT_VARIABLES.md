# 04 — Environment Variables Report

Every variable the code reads (grepped from `artifacts/api-server` + `lib`).
Templates: `deploy/aws/env/.env.{development,staging,production}.example`.
On AWS store the real values in **SSM Parameter Store** (`/banco/prod/<KEY>`,
SecureString) — never in git.

## Server (API)

| Variable | Mandatory | Used for | Notes |
|---|---|---|---|
| `PORT` | ✅ | HTTP listen port | App throws if unset. Platform provides it. |
| `DATABASE_URL` | ✅ | Postgres connection | RDS endpoint; DB needs `pg_trgm`. |
| `SESSION_SECRET` | ✅ | session/signing | long random. |
| `PAYMENT_CONFIG_ENCRYPTION_KEY` | ✅ | encrypt stored payment config | 32 bytes; per-env. |
| `CLERK_SECRET_KEY` | ✅ | auth (server) | `sk_live` in prod. |
| `CLERK_PUBLISHABLE_KEY` | ⚠️ | auth (reference) | `pk_live`. |
| `CORS_ALLOWED_ORIGINS` | ✅ (prod) | browser CORS allowlist | comma/space separated exact origins. |
| `NODE_ENV` | ✅ | prod behaviour | `production`. |
| `PUBLIC_API_BASE_URL` | feature | absolute links/SEO/emails | |
| `PUBLIC_APP_URL` | feature | absolute web app base | |
| `ADMIN_EMAILS` | feature | bootstrap admin allowlist | used by `seed:admin`. |
| `CRON_TIMEZONE` | optional | scheduled jobs tz | default `Africa/Cairo`. |
| `LOG_LEVEL` | optional | pino level | default `info`. |
| `LOG_DIR` | optional | on-disk logs | empty → stdout only (recommended on AWS). |
| `ERROR_ALERT_WEBHOOK` | feature | error alerts (Slack/webhook) | |

## Object storage (S3 adapter — see report 05 S1)

| Variable | Mandatory | Used for |
|---|---|---|
| `OBJECT_STORAGE_PROVIDER` | ✅ (AWS) | select `s3` vs replit |
| `AWS_REGION` | ✅ (AWS) | S3 region |
| `S3_BUCKET` | ✅ (AWS) | media bucket |
| `PUBLIC_OBJECT_SEARCH_PATHS` | ✅ | public object search path(s) |
| `PRIVATE_OBJECT_DIR` | ✅ | private object base prefix |

## Integrations (each gates one feature; unset ⇒ feature off)

| Variable | Feature |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI assistant |
| `RESEND_API_KEY`, `EMAIL_FROM` | transactional email |
| `PAYMOB_MODE`, `PAYMOB_API_BASE`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_SECRET_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_IDS` | payments |

## Web builds (Vite — baked at BUILD time, must be public-safe)

| Variable | Used for |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | web auth |
| `VITE_API_BASE_URL` | API base for the SPAs |
| `VITE_MARKET_URL`, `VITE_ADMIN_URL`, `VITE_APP_ANDROID_URL`, `VITE_APP_IOS_URL` | landing entry links |

## ⛔ Do NOT set on AWS (Replit-only; presence changes behaviour)

`REPLIT_DEPLOYMENT`, `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`,
`AI_INTEGRATIONS_OPENAI_BASE_URL` (Replit modelfarm proxy),
`AI_INTEGRATIONS_OPENAI_API_KEY` (Replit alias).
