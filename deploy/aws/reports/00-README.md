# BANCO — AWS Production Deployment Package

This `deploy/aws/` folder makes this repository ready for a professional,
lowest-cost AWS deployment. **No business logic was changed.** Deployment
engineering only.

## Read in this order

1. **[01-REPOSITORY_AUDIT.md](01-REPOSITORY_AUDIT.md)** — what the system is (apps, ports, env, DB, storage, jobs, integrations).
2. **[02-AWS_INFRASTRUCTURE.md](02-AWS_INFRASTRUCTURE.md)** — recommended (lowest-cost) topology, exact AWS resources, ~monthly cost, scale-up path.
3. **[03-DEPLOYMENT_FILES.md](03-DEPLOYMENT_FILES.md)** — every file generated + what was left as-is + what was deliberately skipped.
4. **[04-ENVIRONMENT_VARIABLES.md](04-ENVIRONMENT_VARIABLES.md)** — all 34 variables, mandatory vs feature, where each is used.
5. **[05-SECURITY_REVIEW.md](05-SECURITY_REVIEW.md)** — the ONE blocker (S3 adapter) + must-verify + already-good.
6. **[06-READINESS_CHECKLIST_GONOGO.md](06-READINESS_CHECKLIST_GONOGO.md)** — health, logging, validation, performance, the step-by-step checklist, and the final Go/No-Go.

## TL;DR

- **Topology:** 1× EC2 (`t4g.small`) running Docker Compose (API + Nginx) → RDS PostgreSQL 16 + S3 + SSM + CloudWatch. **~$35–40/month** at launch.
- **Build:** `docker build -f deploy/aws/Dockerfile.api -t banco-api .` (context = repo root). Web similarly.
- **Deploy:** `AWS_REGION=… SSM_PREFIX=/banco/prod deploy/aws/scripts/deploy.sh` (renders secrets from SSM, migrates, health-gated up).
- **Verdict:** **CONDITIONAL GO** — everything is ready except **one required code change: the S3 object-storage adapter** (Replit sidecar won't run on AWS). Details in report 05.

## Guardrails honoured

- No feature removed, no architecture rewritten, no logic simplified.
- Nothing overwritten blindly; existing `ci.yml` kept.
- No secrets committed — only documented templates.
- The mobile app is **not** part of AWS (it ships to app stores via EAS).
