# Repo sync status

**Updated:** 2026-07-10 (wave 6 — product truth + full gates)

| Repo | Branch | Tag | SHA | Status |
|------|--------|-----|-----|--------|
| `-BANCO-CA-OOM-` | `main` | `v1.1.1-product-truth-2026-07-10` | `1aecea5` | ✅ pushed |
| `aws-virgen` | `main` | `v1.1.1-product-truth-2026-07-10` | `f9acaf7` | ✅ synced |

**Handoff:** `release/FULL-STABLE-SNAPSHOT-2026-07-10.md` · probe: `audit/mobile/live-probes/2026-07-10-wave6-fresh.json`

**Live API:** ✅ **FRESH** @ `https://banco-ca-oom.replit.app`

| Gate | Result |
|------|--------|
| lib-hardening | 36/36 |
| production-confidence | 19/19 |
| pre-redeploy-code-gate | PASS |
| post-redeploy-verify | FRESH |
| staging upload smoke | BLOCKED — `CLERK_BEARER_TOKEN` |
| Device QA | OPEN |

```bash
node audit/mobile/scripts/ops-next-step.mjs
./scripts/publish-aws-virgen-rc.sh v1.1.1-product-truth-2026-07-10
```
