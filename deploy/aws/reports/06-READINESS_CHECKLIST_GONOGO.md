# 06 — Health · Logging · Validation · Performance · Checklist · Go/No-Go

Covers requested Phases 5, 6, 7, 10.

## Phase 5 — Health checks

| Service | Path | Expected | Timeout | On failure |
|---|---|---|---|---|
| API liveness | `GET /api/healthz` (or `/api`, `/api/livez`) | 200 `{status:ok}` | fast, no DB | container restarts |
| API readiness | `GET /api/readyz` | 200 healthy / **503** degraded | DB probe boxed at 2s | LB drains instance |
| Nginx | `GET /nginx-health` | 200 `ok` | — | container restarts |

ALB target group → use **`/api/readyz`** (deregisters an instance whose DB is
down). Container `HEALTHCHECK` uses liveness (never kill a process just because
the DB blipped). **All health endpoints already exist — none were missing.**

## Phase 6 — Logging

- App logs via **pino** (`LOG_LEVEL`) to **stdout** → captured by the compose
  **`awslogs`** driver into CloudWatch groups `/banco/api`, `/banco/web`.
- Optional on-disk logs when `LOG_DIR` is set → shipped by the CloudWatch agent
  (`cloudwatch-agent.json`) to `/banco/api-files` (retention 30d).
- **Auth** (Clerk) + **upload** + **payment webhook** events flow through the same
  structured logger; errors additionally fan out to `ERROR_ALERT_WEBHOOK`.
- **Deployment** logs: `deploy.sh` is health-gated and echoes each phase; SSM
  captures its output.
- Rotation: CloudWatch retention policies (set per group; agent config sets 30d
  for file logs). No unbounded local files when `LOG_DIR` is empty (recommended).

## Phase 7 — Production validation

| Area | State | Note |
|---|---|---|
| DB migrations | ✅ | `drizzle-kit push-force` (`db-migrate.sh`); additive schema. |
| DB seeds | ✅ | `seed`, `seed:reference`, `seed:car-brands`, `seed:admin` (once per fresh DB). |
| Startup sequence | ✅ | bind port → ensure extensions (bg) → start cron → backfills. |
| Env loading | ✅ | fail-fast on missing `PORT`; templates provided. |
| Uploads | ⚠️ | works after **S3 adapter** (report 05 S1). |
| Authentication | ✅ | Clerk; verified 200 on `/api/v1/feed` with a real key. |
| Payments | ✅ | Paymob, HMAC-verified webhook; live keys at launch. |
| Email | ✅ | Resend; off if unset. |
| AI | ✅ | OpenAI; off if unset (no crash). |
| Notifications | ✅ | in-app + push fan-out, best-effort. |
| Background jobs | ✅ | node-cron + advisory locks (multi-instance safe). |
| Object storage | ⚠️ | S3 adapter required (report 05 S1). |
| Rate limiting | ✅ | per-route limiters. |
| Security headers | ✅ | Helmet (API) + Nginx. |
| CORS | ✅ | allowlist via env. |
| Compression / gzip | ✅ | Nginx gzip for static + JSON; long-cache hashed assets. |
| Cache | ✅ | `Cache-Control: immutable` for `/assets`; API never edge-cached. |

## Performance review (launch scale)

- **Static** served by Nginx with gzip + 1-year immutable cache on content-hashed
  assets → minimal repeat bandwidth. Add CloudFront to offload globally.
- **API** is a single esbuild bundle (fast cold start); readiness-gated so LBs
  never route to a not-ready instance.
- **DB**: hot read paths are indexed; keyset (cursor) pagination avoids OFFSET
  scans; `pg_trgm` GIN index backs fuzzy search. Watch slow queries via RDS
  Performance Insights; `db.t4g.micro` is fine for launch, scale vertically first.
- **Media** should be served from S3/CloudFront, not through the API, once the S3
  adapter lands.
- Horizontal scale is safe (stateless API + advisory-lock cron) — add instances
  behind an ALB with no code change.

## Phase 10 — Deployment checklist

1. [ ] Create RDS PostgreSQL 16 (`db.t4g.micro`), enable automated backups; `CREATE EXTENSION pg_trgm`.
2. [ ] Create the S3 media bucket (block public access) + IAM instance role (S3 + SSM + CW Logs, least privilege).
3. [x] ~~Implement the S3 object-storage adapter~~ — **DONE** (report 05 S1). Just set `OBJECT_STORAGE_PROVIDER=s3` + the S3 env vars at deploy.
4. [ ] Put all secrets in SSM `/banco/prod/*` (SecureString), incl. `sk_live`/`pk_live` Clerk + Paymob live + `PAYMENT_CONFIG_ENCRYPTION_KEY` + `SESSION_SECRET`.
5. [ ] Launch EC2 `t4g.small` with the instance role; install Docker + compose; clone this repo to `/opt/banco/aws-virgen`.
6. [ ] Security groups: web 80/443 public; app 8080 ← web SG only; db 5432 ← app SG only.
7. [ ] `db-migrate.sh` (schema push) → run seeds ONCE on the fresh DB.
8. [ ] TLS: ACM + ALB/CloudFront, or certbot on Nginx; redirect 80→443. Set `CORS_ALLOWED_ORIGINS`.
9. [ ] `git tag v1.0.0` → `deploy.sh` (health-gated). Confirm `/api/readyz` = 200.
10. [ ] Point Route 53 records at the box/ALB; smoke-test: sign in, publish a listing with media, chat, booking, admin login.
11. [ ] Enable CloudWatch alarms (CPU, mem, 5xx rate, DB connections). Verify `ERROR_ALERT_WEBHOOK`.

## Final Go / No-Go

| Gate | Verdict |
|---|---|
| Code quality (typecheck, tests, build) | ✅ GO — full api suite **272 pass / 0 fail**, all surfaces typecheck, images build. |
| Deployment assets | ✅ GO — Dockerfiles, compose, Nginx, scripts, CD, env templates, CloudWatch all provided. |
| Infrastructure plan | ✅ GO — lowest-cost topology + exact resource list + costs. |
| **Object storage on AWS** | ✅ GO — **S3 adapter implemented + tested** (report 05 S1). |
| Secrets / TLS / IAM / SGs | ⚠️ CONDITIONAL — configure per checklist before go-live (ops, not code). |

### 🟩 Overall: **GO (config-gated).**
The repository is deployment-ready end to end — infrastructure, containers,
CI/CD, docs, health/logging, **and the S3 storage backend**. No code blockers
remain. The only remaining items are operational configuration (provision RDS/S3/
IAM/SGs/TLS, load secrets into SSM, run the seeds once) — all in the checklist
above. Complete those and deploy.
