# 03 — Deployment Files Report

All files below were **generated** (none existed before — the repo had zero
deployment assets besides `.github/workflows/ci.yml`). Existing files were
inspected and left intact; nothing was overwritten blindly.

## Generated (under `deploy/aws/` unless noted)

| File | Purpose |
|---|---|
| `Dockerfile.api` | Multi-stage API image (Node 24 + pnpm, esbuild build, prod-pruned `pnpm deploy`, non-root, tini, HEALTHCHECK). |
| `Dockerfile.web` | Builds the 3 Vite SPAs → Nginx image; `VITE_*` baked via build args. |
| `nginx.conf` | Single-origin reverse proxy (`/api`→API) + static SPA host (`/`, `/market/`, `/admin/`), gzip, security headers, immutable asset caching, `/nginx-health`. |
| `docker-compose.prod.yml` | Production stack (api + web, optional postgres for staging), `awslogs` driver, required-secret guards. |
| `../../.dockerignore` (repo root) | Keeps context small; excludes secrets, node_modules, mobile app, DB dumps. |
| `env/.env.production.example` | Documented prod env template (no secrets). |
| `env/.env.staging.example` | Staging template (test keys, separate DB). |
| `env/.env.development.example` | Local template. |
| `scripts/deploy.sh` | Render secrets from SSM → build → migrate → health-gated `up`. |
| `scripts/rollback.sh` | Check out previous tag → redeploy; DB-restore note. |
| `scripts/db-migrate.sh` | `pg_trgm` + `drizzle-kit push` + seed guidance. |
| `systemd/banco.service` | Run the compose stack on boot / restart on failure. |
| `cloudwatch-agent.json` | Host metrics + optional on-disk log shipping. |
| `../../.github/workflows/deploy.yml` | CD: verify (typecheck+build+tests on PG) → build+push ECR → SSM deploy on EC2. Tag-triggered. |

## Inspected & left as-is

- `.github/workflows/ci.yml` — solid (Node 24, pnpm pinned, PG16 tests, seeds). The new `deploy.yml` reuses the same verify steps; CI unchanged.
- `artifacts/api-server/build.mjs` — esbuild config; drives the Docker build.
- `lib/db` drizzle config / `push` scripts — used by `db-migrate.sh`.

## Deliberately NOT generated (and why)

- **S3 object-storage adapter** — a real code change (report 05 S1); must ship with tests in a focused PR, not auto-written blind.
- **Elastic Beanstalk / `Dockerrun.aws.json` / `.ebextensions` / `.platform`** — not the recommended topology (Beanstalk is pricier and less flexible than the EC2+compose plan). Provided only if you choose Beanstalk later.
- **`buildspec.yml` / `appspec.yml`** — CodeBuild/CodeDeploy not used; CD is GitHub Actions + SSM. Add if you standardize on CodePipeline.
- **`Procfile`** — Heroku-style; not applicable to the AWS plan.
