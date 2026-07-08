# Release candidate — final gate

**Date:** 2026-07-08 (consolidation pass)  
**Branch:** `main` (pending push)  
**Theme:** Maintenance, deploy/launch documentation, mobile performance/resilience — **no listing publish algorithm changes**.

## Decision

| Environment | Verdict | Notes |
|-------------|---------|-------|
| **Staging (EAS + staging API)** | **GO** | After user supplies staging secrets; run device runbook + publish smoke |
| **Production store / prod API** | **CONDITIONAL NO-GO** | Requires production secrets, EAS prod profile sign-off, and staging publish smoke recorded |

**Overall RC:** **CONDITIONAL GO** — ship to **staging**; production requires human checklist completion below.

## Checklist

| # | Item | Status |
|---|------|--------|
| 1 | `pnpm install` lockfile consistent | Run in CI / locally |
| 2 | Mobile unit tests (`icons`, `lib-hardening`, `mobile-resilience`) | Required green |
| 3 | `node scripts/production-confidence-check.mjs` | Required green |
| 4 | CI workflow (`.github/workflows/ci.yml`) aligned with workspaces | Committed |
| 5 | Listing publish smoke on staging device | **Human** |
| 6 | Production GCP + EAS secrets not in repo | **User staging-only** |
| 7 | `audit/rc1/*.log` excluded from release commit | Yes |

## Listing publish

See [PHASE-LISTING-PUBLISH-LIFECYCLE.md](./PHASE-LISTING-PUBLISH-LIFECYCLE.md) — **publish safe** for this diff scope.

## Blockers (production)

- Real `EXPO_PUBLIC_*` / API URLs and auth secrets for production
- EAS credentials and production build profile validation
- Optional: full API vitest if api-server deploy planned same window

## Approvals

- Engineering: consolidation docs + CI path — automated pass pending tests
- Product/Ops: staging publish smoke — pending
