# Wave P2 — Infrastructure scaffold (no deploy)

**Date:** 2026-07-08  
**Plan ref:** `MASTER-MAINTENANCE-READINESS-PLAN.md` §4 P2 items 9–12

---

## P2-9 — GCP deploy folder ✅

| Deliverable | Path |
|-------------|------|
| README + topology | `deploy/gcp/README.md` |
| API Dockerfile | `deploy/gcp/Dockerfile.api` |
| Cloud Build template | `deploy/gcp/cloudbuild.yaml` |
| Env template | `deploy/gcp/env/.env.production.example` |

AWS package unchanged: `deploy/aws/`.

---

## P2-10 — `expo-router.origin` ⏸️

**Deferred** until production domain is approved (`release/DEPLOYMENT.md` §3).  
Current value remains `https://replit.com/` — do not change without product sign-off.

---

## P2-11 — ESLint monorepo ✅

| Item | Detail |
|------|--------|
| Config | Root `eslint.config.mjs` (flat config) |
| CI gate | Job **ESLint (scripts)** — `pnpm run lint` on `scripts/**` |
| Expand | `pnpm run lint:report` includes api-server + db sources |

---

## P2-12 — Mobile offline / crash regression ✅

| Test | Command |
|------|---------|
| Resilience guards | `pnpm --filter @workspace/banco-mobile run test:resilience` |
| Finance/routing | `pnpm --filter @workspace/banco-mobile run test:lib` |

Static checks verify `ErrorBoundary`, `crashLog`, offline `AsyncStorage` path, billing deep-links.

---

## Verification

```bash
pnpm run lint
pnpm --filter @workspace/banco-mobile run test:resilience
pnpm --filter @workspace/banco-mobile run test:lib
```
