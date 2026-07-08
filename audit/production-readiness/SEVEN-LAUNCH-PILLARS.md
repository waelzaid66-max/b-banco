# Seven Launch Pillars — BANCO Store

**Date:** 2026-07-08  
**Audience:** Release owners, ops, parent agent summary  
**Verdict:** **GO WITH FIXES** — same as RC-1; pillars 4–5 ready; 1–3 and 6–7 need **staging execution**, not code changes.

---

## Publish lifecycle safety statement

> **None of the work in `audit/production-readiness/` modifies listing create, upload, promote, visibility, feed, or search algorithm defaults.**  
> This audit is **documentation + env templates only**. No publish-path source files were changed.  
> Existing production behavior remains the default when feature env vars are unset and flags are OFF.

Proven by: `MarketplaceLifecycle.e2e.test.ts` (publish → feed → search → delete), C-01 upload claims, and RC STATUS_REPORT marketplace lifecycle row.

---

## Pillar status summary

| # | Pillar | Status | Blocks global launch? | Blocks env-only launch (Replit/staging)? |
|---|--------|--------|----------------------|------------------------------------------|
| 1 | [Feature flags](./FEATURE-FLAGS.md) | ⚠️ Partial | **No** — env toggles work; unified registry optional | No |
| 2 | [Migration rollback](./MIGRATION-ROLLBACK-PLAYBOOK.md) | ⚠️ Partial | **No** if only additive releases | No — run verify on staging |
| 3 | [Observability](./OBSERVABILITY-RUNBOOK.md) | ⚠️ Partial | **No** for soft launch; **Yes** for serious prod ops without webhook/logs | No |
| 4 | [API versioning](./API-VERSIONING-POLICY.md) | ✅ Ready | No | No |
| 5 | [Backward compatibility](./BACKWARD-COMPATIBILITY.md) | ✅ Ready | No | No |
| 6 | [Disaster recovery](./DISASTER-RECOVERY-VERIFICATION.md) | ⚠️ Partial | **Yes** for enterprise SLA; **No** for RC/Replit if backups exist at provider | Staging checklist only |
| 7 | [Release rollback](./RELEASE-ROLLBACK-PLAYBOOK.md) | ⚠️ Partial | **No** if tags + rollback.sh rehearsed | No |

**Legend:** ✅ Ready = documented and matches code. ⚠️ Partial = gaps are procedural (runbooks, Sentry, DR drill), not missing publish functionality.

---

## What blocks global launch vs env-only

### Global launch blockers (must fix or accept risk)

| Item | Pillar | Mitigation |
|------|--------|------------|
| No production alert webhook | 3 | Set `ERROR_ALERT_WEBHOOK` |
| No confirmed DB backups | 6 | Enable RDS/Cloud SQL automated backups |
| `expo-router` origin still Replit | 5 | Set production domain before store marketing links |
| Paymob live without admin sign-off | 1 | Keep Paymob unset until B5 decision |
| Never rehearsed rollback | 7 | Tag release + run rollback on staging |

### Env-only / Replit launch (already working per user)

| Item | Notes |
|------|-------|
| Feature flags | OpenAI/Resend/Paymob optional |
| Migrations | `ensureSchemaPatches` on boot |
| Observability | stdout + optional webhook |
| DR | Provider-dependent; run smoke scripts |
| API v1 + mobile client | Verified |

---

## Pillar details (one line each)

1. **Feature flags** — Env `[feature]` vars + admin payment/email/plan config; propose `FEATURE_*` module later; defaults = current behavior.
2. **Migration rollback** — Drizzle push + idempotent boot patches; forward-only; RDS PITR for disasters.
3. **Observability** — Pino multi-channel logs, healthz/readyz, `ERROR_ALERT_WEBHOOK`; mobile console crash seam; no Sentry yet.
4. **API versioning** — `/api/v1/*`, OpenAPI 1.0.0, Orval client; additive-only policy.
5. **Backward compatibility** — Versioned AsyncStorage; waves 4/5 optional params; `/search-results` preserved.
6. **Disaster recovery** — Executable staging checklist; AWS/GCP docs; no in-repo automated backup script.
7. **Release rollback** — `rollback.sh` + EAS prior build; DB not auto-reverted.

---

## Staging-only actions for user

1. `node scripts/staging-p0-smoke.mjs` with real Clerk + API URL  
2. `node scripts/verify-upload-claims-schema.mjs`  
3. Complete [DISASTER-RECOVERY-VERIFICATION.md](./DISASTER-RECOVERY-VERIFICATION.md) sections B–C  
4. Set and test `ERROR_ALERT_WEBHOOK`  
5. Tag `v1.x.y` and rehearse [RELEASE-ROLLBACK-PLAYBOOK.md](./RELEASE-ROLLBACK-PLAYBOOK.md) on staging  

---

## Code changes in this audit

| Changed | Publish path touched? |
|---------|----------------------|
| `audit/production-readiness/*` (new docs) | **No** |
| `audit/maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md` (one paragraph) | **No** |
| Application source (`artifacts/api-server`, `banco-mobile`, listings, upload) | **No changes** |

---

## Document map

```
audit/production-readiness/
├── README.md                          ← entry point
├── SEVEN-LAUNCH-PILLARS.md            ← this file
├── FEATURE-FLAGS.md
├── MIGRATION-ROLLBACK-PLAYBOOK.md
├── OBSERVABILITY-RUNBOOK.md
├── API-VERSIONING-POLICY.md
├── BACKWARD-COMPATIBILITY.md
├── DISASTER-RECOVERY-VERIFICATION.md
└── RELEASE-ROLLBACK-PLAYBOOK.md
```

---

## Sign-off checklist

- [ ] Product owner read publish safety statement  
- [ ] Ops completed staging smoke (P0)  
- [ ] Backups confirmed in cloud console  
- [ ] Rollback tag identified (`v____________`)  
- [ ] Ready for store submit per `release/STORE_PUBLISHING_GUIDE.md`
