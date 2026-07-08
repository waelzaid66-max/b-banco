# Release Rollback Playbook — BANCO Store

**Status:** ⚠️ Partial — git-tag API rollback scripted; mobile EAS manual; DB forward-only.

**Target:** Revert user-facing breakage within **minutes** (API/web); mobile/store within **hours** depending on store review.

---

## Decision tree (first 5 minutes)

```
Incident detected
    │
    ├─ API 5xx / logic bug only? ──► Roll back API container (§1)
    │
    ├─ Bad mobile build in store? ──► Prior EAS build + store revert (§2)
    │
    ├─ Schema migration caused issue? ──► Code rollback + assess DB (§3)
    │
    └─ Media/upload broken? ──► Check storage env + rollback API if code (§4)
```

**Do not roll back** if incident is external (Clerk, Paymob, OpenAI outage) — communicate and wait.

---

## 1. API + web rollback (minutes)

### Prerequisites

- Releases tagged: `v1.0.0`, `v1.0.1`, …
- Deploy from tag via `deploy/aws/scripts/deploy.sh` (health-gated)

### Automated (AWS)

```bash
# Previous tag (or explicit)
AWS_REGION=eu-central-1 SSM_PREFIX=/banco/prod deploy/aws/scripts/rollback.sh
# Or explicit:
deploy/aws/scripts/rollback.sh v1.0.0
```

Script: checks out tag → runs `deploy.sh`.

### Manual (Replit / any host)

```bash
git fetch --tags
git checkout v1.0.0   # last known good
pnpm install
pnpm --filter @workspace/api-server run build
# restart process (Replit redeploy / systemd / Cloud Run revision)
```

### Web static (admin, dealer, landing)

Redeploy **previous artifact** from CI or rebuild at prior tag:

```bash
git checkout v1.0.0
pnpm --filter @workspace/admin-os --filter @workspace/dealer-os --filter @workspace/landing run build
# sync dist/ to CDN/nginx
```

### Verify after rollback

```bash
curl -sS "$API/api/healthz"
curl -sS "$API/api/readyz"
node scripts/staging-p0-smoke.mjs   # against prod URL if safe, else staging mirror
```

**Expected:** health 200; publish smoke passes if run with prod test account.

---

## 2. Mobile rollback (EAS / stores)

### Internal / TestFlight / internal track (fast)

```bash
# List builds
eas build:list --platform android --limit 5
eas build:list --platform ios --limit 5

# Submit previous known-good build ID (if not already in store)
eas submit --platform android --id <BUILD_ID>
```

### Production store (slower)

| Store | Action | Typical time |
|-------|--------|--------------|
| Google Play | Roll out previous release in Play Console → Release management | 1–2 hours |
| Apple App Store | Re-submit previous build or expedited review | Hours–days |

**Config:** `artifacts/banco-mobile/eas.json` — `production.ios.autoIncrement: true` (iOS build numbers must increase on resubmit).

**Client/server:** Old mobile + rolled-back API is supported if rollback tag predates breaking API changes ([BACKWARD-COMPATIBILITY.md](./BACKWARD-COMPATIBILITY.md)).

---

## 3. Database rollback limits

| Release included | Roll back code? | Roll back DB? |
|------------------|-----------------|---------------|
| Code only | ✅ Yes | No action |
| Additive schema (columns/tables) | ✅ Yes | **Keep schema** |
| Destructive schema | ⚠️ Restore snapshot | **PITR / snapshot restore** |

See [MIGRATION-ROLLBACK-PLAYBOOK.md](./MIGRATION-ROLLBACK-PLAYBOOK.md).

**Never** run `drizzle-kit push` down — not supported.

---

## 4. Object storage rollback

| Issue | Action |
|-------|--------|
| Bad ACL code | Roll back API tag |
| Wrong `OBJECT_STORAGE_PROVIDER` | Fix env + restart; no data migration |
| Accidental object delete | Restore from S3/GCS versioning |
| Replit bucket misconfig | Restore provider credentials; objects remain in bucket |

Upload **claims** table is forward-only — rolling back API without rolling back DB is normal.

---

## 5. Feature / config rollback (no deploy)

| Change | Rollback |
|--------|----------|
| Bad Paymob admin config | Restore previous row in admin or env keys |
| OpenAI model mis-set | Fix `OPENAI_MODEL` + restart |
| Alert webhook spam | Unset `ERROR_ALERT_WEBHOOK` + restart |

---

## 6. Communication template

```
Subject: [BANCO] Rollback to v1.0.0 — <one-line reason>

- Start: <UTC time>
- Rolled back: API @ v1.0.0, mobile unchanged / Play build N-1
- DB: no restore / snapshot restore if applicable
- User impact: <publish/search/login>
- Next: root cause in <ticket>
```

---

## 7. Post-rollback

- [ ] `/api/readyz` green 15 min
- [ ] Error webhook quiet
- [ ] Spot-check: create listing with photo on prod test account
- [ ] File incident timeline
- [ ] Forward fix on branch; new tag `v1.0.2` — do not re-break publish path

---

## Publish lifecycle safety

Rollback procedures **restore prior code** — they do not alter listing publish logic in the rolled-back version. After rollback, run upload smoke to confirm the proven path still works.
