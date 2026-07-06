# 07 — Elastic Beanstalk (Docker / AL2023) Deployment

> Written from the real repository. EB env observed: **Banco / Banco-env**,
> platform **Docker running on 64bit Amazon Linux 2023**, region **eu-north-1**.

## 1. Why the deployment failed (exact cause)

EB event log:
> `Instance deployment: Both 'Dockerfile' and 'Dockerrun.aws.json' are missing in
> your source bundle. Include at least one of them. The deployment failed.`

EB's single-container Docker platform reads **the ROOT of the uploaded bundle**
for one of: `Dockerfile`, `Dockerrun.aws.json`, or `docker-compose.yml`. The
bundle that was uploaded had none at the root, so EB refused it (the ELB "Severe"
health is a downstream effect — no container ever started).

## 2. Was there a Dockerfile already? — YES, but unusable by EB

| Existing file | Full path | Why EB did NOT use it |
|---|---|---|
| API image | `deploy/aws/Dockerfile.api` | Not at the bundle root, and not named `Dockerfile`. Also uses BuildKit-only `--mount=type=cache` + a `# syntax=` directive that EB's classic builder may not enable. |
| Web image | `deploy/aws/Dockerfile.web` | Web SPAs — not the API; also nested. |

**The API server that must be deployed is `artifacts/api-server`** (Node 24,
Express 5, esbuild → `dist/index.mjs`, requires `PORT` + `DATABASE_URL`).

## 3. What was added (deployment-only — no logic, no architecture, no moves)

| File | Purpose |
|---|---|
| **`Dockerfile`** (repo root) | Production image for the API ONLY. Multi-stage Node 24 + pnpm; `pnpm --filter @workspace/api-server run build` then `pnpm --prod deploy`; non-root; tini; **BuildKit-optional** (no cache mounts) so EB's builder handles it. `ENV PORT=8080` + `EXPOSE 8080`; HEALTHCHECK on **`/api/healthz`** (the API is mounted under `/api`). |
| **`.ebextensions/01_banco.config`** | Sets the ALB health-check path to **`/api/healthz`** (a plain `/` returns 404 → would keep the env "Severe"), raises the command timeout to 1800s for the on-instance build, and sets non-secret `NODE_ENV`/`LOG_LEVEL`/`CRON_TIMEZONE`. |
| **`.dockerignore`** (already present) | Shrinks the build context; excludes `node_modules`, `artifacts/banco-mobile`, `.git`, dumps. |
| **`deploy/aws/eb/Dockerrun.aws.json`** | TEMPLATE for the ECR path (§6). Deliberately NOT at the root (a root Dockerrun would override the root Dockerfile). |

## 4. THE BUNDLE — what to ZIP and upload (Approach A: build on instance)

This is the immediate, console-upload path — EB builds the image from the root
`Dockerfile`.

**ZIP the CONTENTS of the repository root** (not the parent folder). The root of
the ZIP must contain `Dockerfile` + `.ebextensions/`.

Must be INSIDE the zip:
```
Dockerfile                 ← at the ZIP root (required by EB)
.ebextensions/01_banco.config
.dockerignore
pnpm-workspace.yaml  pnpm-lock.yaml  package.json  .npmrc
lib/**                     (db, api-spec, api-zod, api-client-react, taxonomy, integrations-*)
artifacts/api-server/**    (the API source the build compiles)
artifacts/admin-os artifacts/dealer-os artifacts/landing   (workspace members the lockfile references)
```
EXCLUDE from the zip (smaller + faster; the image installs its own deps):
`node_modules/`, `.git/`, `**/dist`, `artifacts/banco-mobile/`, `attached_assets/`,
`database_backup.dump*`.

**Create the bundle** (run at the repo root):

- Git Bash / Linux:
  ```bash
  git archive --format=zip -o ../banco-eb-bundle.zip HEAD
  # git archive uses the committed tree and skips node_modules/.git automatically.
  ```
- PowerShell (if not using git archive):
  ```powershell
  # from the repo root
  $ex = @('node_modules','.git','dist','artifacts\banco-mobile','attached_assets')
  # simplest reliable method: use git archive as above, or 7-Zip excluding $ex.
  ```

> Prefer `git archive HEAD` — it zips exactly the tracked files (Dockerfile +
> .ebextensions included, node_modules/.git excluded) and is reproducible.

**Upload:** EB console → environment **Banco-env** → **Upload and deploy** → pick
`banco-eb-bundle.zip` → give it a version label → Deploy. (Or `eb deploy`.)

## 5. Environment properties to set BEFORE deploying (EB console → Configuration → Software → Environment properties)

Secrets are NOT in any file. Set these (see reports/04 for the full list):

| Key | Required | Value |
|---|---|---|
| `DATABASE_URL` | ✅ | your RDS PostgreSQL 16 URL (DB needs `pg_trgm`) |
| `CLERK_SECRET_KEY` | ✅ | `sk_live_…` (or `sk_test_…` for a trial) |
| `SESSION_SECRET` | ✅ | long random string |
| `PAYMENT_CONFIG_ENCRYPTION_KEY` | ✅ | 32-byte key |
| `CORS_ALLOWED_ORIGINS` | ✅ | your web origin(s) |
| `OBJECT_STORAGE_PROVIDER` | ✅ on AWS | `s3` |
| `AWS_REGION` | ✅ | `eu-north-1` |
| `S3_BUCKET` | ✅ | your media bucket |
| `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR` | ✅ | key prefixes |
| `CLERK_PUBLISHABLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `OPENAI_API_KEY`, `PAYMOB_*` | feature | per feature |

Do **NOT** set `PORT` (the Dockerfile fixes it to 8080 and EB maps :80→8080).
Do **NOT** set `REPLIT_*`.

**First deploy only** — after the container is healthy, run the schema + seeds once
against the RDS DB (locally or via a one-off task): `pg_trgm` extension,
`pnpm --filter @workspace/db run push-force`, then `seed`, `seed:reference`,
`seed:car-brands`, `seed:admin` (see `deploy/aws/scripts/db-migrate.sh`).

## 6. Approach B (recommended for real production): ECR + Dockerrun

Building the whole monorepo on every instance is slow and memory-hungry. For
production, build the image ONCE in CI and let EB pull it:

1. Create an ECR repo `banco-api`. Build + push via `.github/workflows/deploy.yml`.
2. Bundle = a folder whose ROOT is `deploy/aws/eb/Dockerrun.aws.json` (fill in
   `<ACCOUNT>/<REGION>/<TAG>`) + the `.ebextensions/` folder. Zip those two and
   upload. EB pulls the image (no on-instance build) — faster, deterministic, no
   OOM risk. Give the EB instance role `AmazonEC2ContainerRegistryReadOnly`.

## 7. Instance sizing & gotchas (Approach A)

- The on-instance build (pnpm install ≈ 1300+ pkgs + esbuild) needs memory — use
  at least a **t3.small (2 GB) with swap, ideally t3.medium (4 GB)** for the build
  batch, or switch to Approach B. The 1800s command timeout in `.ebextensions`
  covers the build duration.
- The EB instance must reach the internet (NAT/IGW) to `pnpm install`.
- RDS security group must allow 5432 from the EB instances' security group.
- Region alignment: EB is in **eu-north-1** — put RDS + S3 in the same region.

## 8. About giving Claude AWS permissions

I can't accept AWS credentials or operate your AWS account from this
environment — it is non-interactive and cannot run the AWS OAuth/console flow,
and handling long-lived keys here would be unsafe. Everything you need is done in
code + these instructions; **you** run the upload/deploy (console "Upload and
deploy", or the `eb` CLI). If you want, I can also generate the exact `eb` CLI
commands or a GitHub Actions job that deploys on your behalf using an OIDC role
(no static keys).
