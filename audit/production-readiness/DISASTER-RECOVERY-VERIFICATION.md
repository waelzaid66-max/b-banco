# Disaster Recovery Verification — BANCO Store

**Status:** ⚠️ Partial — backup strategy documented for AWS/GCP; **executable checklist below for staging only**. Never run destructive restore on production without ops approval.

---

## Recovery objectives (targets)

| Tier | RTO (restore service) | RPO (max data loss) | Method |
|------|----------------------|---------------------|--------|
| API + web static | ~15 min | 0 (stateless redeploy) | Redeploy previous image/tag |
| PostgreSQL | ~30–60 min | ≤ automated backup window (24h default) | RDS snapshot / Cloud SQL PITR |
| Object storage (media) | ~15 min | 0 if versioning enabled | S3/GCS versioning; Replit bucket per provider |
| Mobile clients | Hours (store review) | N/A | EAS previous build + OTA not used for native |

---

## What exists in repo

| Asset | Location | Notes |
|-------|----------|-------|
| RDS backup guidance | `deploy/aws/reports/02-AWS_INFRASTRUCTURE.md`, `06-READINESS_CHECKLIST_GONOGO.md` | Automated backups + PITR |
| GCP scaffold | `deploy/gcp/README.md` | Cloud SQL + GCS |
| DB migrate | `deploy/aws/scripts/db-migrate.sh` | Forward schema apply |
| Rollback script | `deploy/aws/scripts/rollback.sh` | Git tag → redeploy (not DB) |
| Local dump artifact (ignored) | `.gitignore` → `database_backup.dump*` | Template only — not in repo |
| Replit handoff | `release/REPLIT_HANDOFF.md`, `release/DEPLOYMENT.md` | Secrets + seed commands |

---

## Staging verification checklist (executable)

Run on **staging** (or dedicated DR clone). Check each box; record timestamps in release log.

### A. Pre-flight

- [ ] Staging API URL noted: `BANCO_API_URL=…`
- [ ] Staging DB is **not** production (verify hostname)
- [ ] Clerk test tokens available
- [ ] Operator has read access to backup/snapshot console (AWS/GCP/Replit)

### B. Health & publish path (non-destructive)

```bash
export BANCO_API_URL=https://staging.example.com
export CLERK_BEARER_TOKEN=eyJ…   # staging user

node scripts/staging-p0-smoke.mjs
```

**Expected:**

| Step | Pass criteria |
|------|---------------|
| healthz | `200`, `body.status === "ok"` |
| readyz | `200`, `checks.database === "ok"` |
| upload path (if token set) | request-url → PUT bytes → verify → promote → 200 |
| IDOR step (if second token) | other user promote → **403** |

```bash
node scripts/verify-upload-claims-schema.mjs
# Expected: upload_claims table exists with expected columns
```

```bash
pnpm --filter @workspace/api-server test -- MarketplaceLifecycle.e2e.test.ts
# Expected: publish → feed → search → … → delete — all pass on staging DB URL
```

### C. Backup existence (console — no restore yet)

**AWS RDS:**

- [ ] Automated backups **enabled**
- [ ] Retention ≥ 7 days
- [ ] Latest snapshot time < 24h ago
- [ ] Note snapshot ID: `________________`

**GCP Cloud SQL:**

- [ ] Automated backups enabled
- [ ] PITR enabled if available
- [ ] Note backup run time: `________________`

**Replit / managed Postgres:**

- [ ] Provider backup policy documented
- [ ] Manual `pg_dump` tested once to secure storage (optional):

```bash
pg_dump "$DATABASE_URL" --format=custom --file=staging-dr-test.dump
# Expected: file size > 0, pg_restore --list staging-dr-test.dump succeeds
```

### D. Object storage

- [ ] List bucket/prefix — sample listing media object exists
- [ ] Upload test object `dr-test-$(date +%s).txt` → download → delete
- [ ] (AWS) Versioning enabled OR (GCS) object versioning / lifecycle documented

### E. DR drill — **staging clone only** (optional quarterly)

**Only on a disposable staging clone — not production.**

1. [ ] Create new RDS/Cloud SQL instance from latest snapshot
2. [ ] Point **staging-clone** API `DATABASE_URL` to restored instance
3. [ ] Deploy current API tag to clone
4. [ ] Run `staging-p0-smoke.mjs` — all pass
5. [ ] Spot-check: known listing ID returns 200 on `GET /api/v1/listings/{id}`
6. [ ] Tear down clone instance after sign-off

**Expected:** Restored DB + current code serves read/write; publish smoke passes.

### F. Secrets recovery

- [ ] Clerk, OpenAI, Resend, Paymob, storage credentials recoverable from SSM/Secret Manager/Replit Secrets (not only on one laptop)
- [ ] `PAYMENT_CONFIG_ENCRYPTION_KEY` unchanged across restore (or payment config re-entered in admin)

---

## Production — what NOT to do in this checklist

- ❌ `pg_restore` over production DATABASE_URL
- ❌ RDS restore replacing in-place prod instance without maintenance window
- ❌ Deleting production bucket objects during drill

---

## Failure mode quick reference

| Failure | First action | Data recovery |
|---------|--------------|---------------|
| Bad deploy | `deploy/aws/scripts/rollback.sh` | None |
| Region outage | Failover runbook (multi-region not in v1) | Restore in new region from snapshot |
| DB corruption | Stop writes; PITR to timestamp before incident | Snapshot restore |
| Bucket accidental delete | Versioning restore / provider support | Per-object |
| Clerk outage | Wait / status page; API returns 401 | N/A |

---

## Gaps

- [ ] Automated DR drill scheduled (calendar)
- [ ] Cross-region replica (P2)
- [ ] Documented Replit-specific snapshot steps in ops wiki
- [ ] RTO/RPO sign-off from business owner

**Publish safety:** Drills use the same smoke scripts as RC — they **verify** publish path, never change it.
