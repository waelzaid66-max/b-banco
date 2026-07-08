# Phase 16–17 — Cloud Readiness (Replit + AWS + GCP)

**Status:** `pass` (scaffolds coexist)  
**Date:** 2026-07-08  
**Policy:** **Do not delete any environment.** Replit remains valid; AWS and GCP remain deploy options.

---

## Surfaces present

| Env | Location | Status |
|-----|----------|--------|
| Replit | `.replit` / Replit runtime | Primary historically; keep |
| AWS | `deploy/aws/` (Docker, EB, nginx, rollback.sh, env examples, GO/NOGO reports) | Scaffold + docs **PASS** |
| GCP | `deploy/gcp/` (Dockerfile.api, cloudbuild, env example) | Scaffold **PASS** |
| Root Docker | `Dockerfile` | Still available |

## Incomplete = OPS deploy windows (not missing folders)
- Live staging/prod deploy with real secrets
- DR backup confirmation at provider (RDS / Cloud SQL)

## Code changes this phase
None — multi-cloud retention confirmed documentation-only.
