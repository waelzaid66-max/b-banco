# BANCO — GCP deployment scaffold (P2-9)

**Status:** scaffold only — no production deploy until RC validation (see `audit/maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md`).

This folder mirrors `deploy/aws/` for teams that prefer **Cloud Run + Cloud SQL + GCS**. Business logic is unchanged; deployment engineering only.

## Recommended topology (lowest-cost launch)

| Component | GCP service |
|-----------|-------------|
| API | Cloud Run (container from `Dockerfile.api`) |
| Postgres | Cloud SQL for PostgreSQL 16 |
| Object storage | Google Cloud Storage (native `@google-cloud/storage` adapter) |
| Secrets | Secret Manager → env on Cloud Run |
| Web (admin/dealer/landing) | Cloud Storage + Cloud CDN or Firebase Hosting |
| Mobile | EAS / app stores (not hosted on GCP) |

## Build API image

From repository root:

```bash
docker build -f deploy/gcp/Dockerfile.api -t banco-api .
```

The Dockerfile reuses the same multi-stage recipe as `deploy/aws/Dockerfile.api`.

## Deploy (manual outline)

1. Create Cloud SQL instance + database `banco`.
2. Run schema: `pnpm --filter @workspace/db run push-force` (or rely on `ensureSchemaPatches` on boot).
3. Seed reference data: `pnpm --filter @workspace/api-server run seed`.
4. Store secrets in Secret Manager (`DATABASE_URL`, Clerk, OpenAI, storage, etc.).
5. Deploy Cloud Run service from `cloudbuild.yaml` or `gcloud run deploy`.
6. Run P0 smoke: `BANCO_API_URL=… CLERK_BEARER_TOKEN=… node scripts/staging-p0-smoke.mjs`.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile.api` | Production API image (Node 24) |
| `cloudbuild.yaml` | Cloud Build → Artifact Registry → Cloud Run |
| `env/.env.production.example` | Documented env template (no secrets) |

## Guardrails

- Do not enable Paymob paid flows without admin decision (wave B5).
- Set `expo-router` `origin` to production domain before store submit (`release/DEPLOYMENT.md` §3).
- Health probes: `/api/healthz` (liveness), `/api/readyz` (readiness).
