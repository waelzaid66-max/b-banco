# Phase 01 — Core Architecture

**Status:** Baseline documented for launch readiness (consolidation pass).  
**Scope:** Monorepo layout, deploy surfaces, and data/auth boundaries — not feature work.

## Repository layout

| Path | Role |
|------|------|
| `package.json` (root) | pnpm workspace orchestration, shared scripts (`pnpm -r`), CI entrypoints |
| `artifacts/banco-mobile` | Expo/React Native client (EAS builds, OTA via Expo channels) |
| `artifacts/api-server` | Node API (Vitest in CI; deploy via GCP / container per `deploy/`) |
| `deploy/gcp` | Production/staging env templates and deployment assets |
| `scripts/` | Smoke and confidence checks (`staging-p0-smoke.mjs`, `production-confidence-check.mjs`) |
| `audit/` | RC1 logs, maintenance plans, production-readiness playbooks |

## Runtime boundaries

- **Mobile → API:** HTTPS to configured `EXPO_PUBLIC_*` / API base URL; session via `SessionContext` (no publish-path changes in consolidation wave).
- **Listing publish lifecycle:** Owned by dedicated listing/publish flows (see `PHASE-LISTING-PUBLISH-LIFECYCLE.md`). Consolidation did not modify publish mutations or server publish routes.
- **Website:** Documented separately under `audit/website/`; mobile can ship independently per checklist.

## CI contract (`.github/workflows/ci.yml`)

- Root install (`pnpm install`) with lockfile enforcement.
- Mobile: unit tests (`tests/*.test.mjs`), typecheck/lint as configured.
- API server: lint/typecheck/vitest when workspace changes.

## Staging vs production

- **Staging:** EAS internal/preview profiles + staging API secrets (user-provided).
- **Production:** EAS production profile + production secrets + GCP env from `deploy/gcp/env/.env.production.example` (never commit real secrets).

## References

- `MONOREPO-PACKAGE-GUIDE.md`
- `SEVEN-LAUNCH-PILLARS.md`
- `EXPO-EAS-PRODUCTION-CHECKLIST.md`
- `STAGING-EAS-DEVICE-RUNBOOK.md`
