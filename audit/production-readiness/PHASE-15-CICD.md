# Phase 15 — CI/CD

**Status:** `pass_with_reservations`  
**Date:** 2026-07-08

---

## Complete in repo
`.github/workflows/ci.yml` four jobs:
1. Typecheck & build (frozen lockfile)
2. API tests (Postgres 16 + seed)
3. ESLint scripts
4. Mobile regression (icons + lib + resilience)

## Reservations
| Item | Type |
|------|------|
| Prove green on latest `main` from this workstation | **OPS** — `gh auth` or Actions UI |
| Windows local `pnpm install` preinstall `sh` | Documented workaround — not CI failure |

## Code changes this phase
None.
