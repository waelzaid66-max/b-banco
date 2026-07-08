# Production Readiness — BANCO Store

**Purpose:** Launch pillars, playbooks, and verification checklists for global production.  
**Last updated:** 2026-07-08  
**Scope:** Documentation and env templates only — **no changes to listing publish defaults**.

---

## Seven launch pillars (index)

See **[SEVEN-LAUNCH-PILLARS.md](./SEVEN-LAUNCH-PILLARS.md)** for status per pillar, launch blockers vs env-only gaps, and the publish-lifecycle safety statement.

### Expo / EAS / monorepo (2026-07-08)

| Doc | Purpose |
|-----|---------|
| [EXPO-EAS-PRODUCTION-CHECKLIST.md](./EXPO-EAS-PRODUCTION-CHECKLIST.md) | Pass/fail per Expo/EAS item (**18/22**) |
| [MONOREPO-PACKAGE-GUIDE.md](./MONOREPO-PACKAGE-GUIDE.md) | pnpm workspace, Metro, Windows install |
| [STAGING-EAS-DEVICE-RUNBOOK.md](./STAGING-EAS-DEVICE-RUNBOOK.md) | Staging smoke → EAS preview → device QA |

Local gate (no secrets): `node scripts/production-confidence-check.mjs`

| # | Pillar | Doc | Status (2026-07-08) |
|---|--------|-----|---------------------|
| 1 | Feature flags | [FEATURE-FLAGS.md](./FEATURE-FLAGS.md) | ⚠️ Partial |
| 2 | Data migration rollback | [MIGRATION-ROLLBACK-PLAYBOOK.md](./MIGRATION-ROLLBACK-PLAYBOOK.md) | ⚠️ Partial |
| 3 | Observability | [OBSERVABILITY-RUNBOOK.md](./OBSERVABILITY-RUNBOOK.md) | ⚠️ Partial |
| 4 | API versioning | [API-VERSIONING-POLICY.md](./API-VERSIONING-POLICY.md) | ✅ Ready |
| 5 | Backward compatibility | [BACKWARD-COMPATIBILITY.md](./BACKWARD-COMPATIBILITY.md) | ✅ Ready |
| 6 | Disaster recovery | [DISASTER-RECOVERY-VERIFICATION.md](./DISASTER-RECOVERY-VERIFICATION.md) | ⚠️ Partial |
| 7 | Release rollback | [RELEASE-ROLLBACK-PLAYBOOK.md](./RELEASE-ROLLBACK-PLAYBOOK.md) | ⚠️ Partial |

---

## Related audit material

| Area | Location |
|------|----------|
| Maintenance master plan | [`audit/maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md`](../maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md) |
| RC-1 report | [`audit/rc1/BANCO-STORE-RELEASE-CANDIDATE-REPORT.md`](../rc1/BANCO-STORE-RELEASE-CANDIDATE-REPORT.md) |
| P0 staging smoke | [`audit/maintenance/WAVE-P0-STAGING-VALIDATION.md`](../maintenance/WAVE-P0-STAGING-VALIDATION.md) |
| PH-1 hardening | [`audit/maintenance/WAVE-PH1-PRODUCTION-HARDENING.md`](../maintenance/WAVE-PH1-PRODUCTION-HARDENING.md) |
| Live status | [`STATUS_REPORT.md`](../../STATUS_REPORT.md) |
| AWS deploy readiness | [`deploy/aws/reports/06-READINESS_CHECKLIST_GONOGO.md`](../../deploy/aws/reports/06-READINESS_CHECKLIST_GONOGO.md) |
| GCP scaffold | [`deploy/gcp/README.md`](../../deploy/gcp/README.md) |
| Listing lifecycle E2E | `artifacts/api-server/src/services/MarketplaceLifecycle.e2e.test.ts` |

---

## Staging-only actions (operator)

Before promoting to production:

1. Run `node scripts/staging-p0-smoke.mjs` with real `BANCO_API_URL` + Clerk tokens.
2. Run `node scripts/verify-upload-claims-schema.mjs` against staging DB.
3. Execute the checklist in [DISASTER-RECOVERY-VERIFICATION.md](./DISASTER-RECOVERY-VERIFICATION.md) (non-destructive).
4. Confirm `ERROR_ALERT_WEBHOOK` receives a test alert (optional but recommended).
5. Tag release (`v1.x.y`) and rehearse [RELEASE-ROLLBACK-PLAYBOOK.md](./RELEASE-ROLLBACK-PLAYBOOK.md) on staging.

**Do not** run destructive DB restore or production rollback drills without an explicit ops window.
