# BANCO — Production Full Snapshot (صادق · كامل)

**Generated:** 2026-07-10T22:35+03:00  
**Primary repo:** https://github.com/waelzaid66-max/-BANCO-CA-OOM-  
**AWS repo:** https://github.com/waelzaid66-max/aws-virgen  
**Target tag:** `v1.1.4-production-2026-07-10`  
**Branch:** `main`

---

## 1) Executive verdict (no fake green)

| Layer | Verdict | Evidence |
|-------|---------|----------|
| **Code quality** | ✅ **GO** | production-confidence **19/19** (incl. mobile typecheck) |
| **Mobile stabilize waves 6–10C** | ✅ **CLOSED locally** | lib-hardening **57/57** · search-contract **37/37** |
| **API contract + AWS/GCP assets** | ✅ **GO** | openapi.yaml · deploy/aws · deploy/gcp · CI/CD |
| **Live Replit API** | ⚠️ **PARTIAL** | wave 6 FRESH · wave 8 STALE until redeploy |
| **Upload E2E smoke** | ⚠️ **BLOCKED** | needs `CLERK_BEARER_TOKEN` |
| **EAS preview/production** | ⏳ **OPEN** | run after Live FRESH + device QA |
| **AWS EC2 deploy** | ⏳ **CONFIG-GATED** | sync aws-virgen → tag → deploy.yml |
| **Store publish** | ⏳ **OPEN** | after preview QA on real device |

**Honest summary:** الكود جاهز للإنتاج. التشغيل (Replit redeploy · أسرار · EAS · AWS infra) ما زال على المشغّل.

---

## 2) Automated gates (last run)

```bash
node scripts/production-confidence-check.mjs    # 19/19
pnpm run ops:full-verify                        # 17/17 + 57/57 + 37/37
pnpm run ops:code-gate                          # PASS (wave 6–10C signals)
pnpm run ops:probe-full                         # PARTIAL (wave 8 STALE live)
```

| Script | Result |
|--------|--------|
| production-confidence | **19/19** |
| lib-hardening | **57/57** |
| search-contract | **37/37** |
| pre-redeploy-code-gate | **PASS** |
| staging-p0-smoke (health) | **2/2** on live host |
| post-redeploy-verify | **exit 1** (wave 8 missing on live) |

Live proof JSON: `audit/mobile/live-probes/2026-07-10-full-deploy-proof.json`

---

## 3) What ships in this snapshot (waves 6–10C)

- Market country ISO validation + SQL filter + map `is_bookable` / `price_display`
- Seller `social_links` on listing detail (API + mobile UI)
- Safe media thumbnails (no raw video in feed cards)
- Home `bootReady` stability gate
- Assistant industrial→facilities routing
- Push notification query invalidation
- **Edit listing media** PATCH `media[]` + `ListingMediaEditor`
- Draft `promotedMedia` persistence after upload verify
- TypeScript fix: `ListingMediaEditor.buildMediaPayload` narrows uploaded state

---

## 4) Deploy paths (pick one host)

### A) Replit (staging / demo API)

```bash
# On Replit Shell:
bash audit/mobile/REPLIT-SHELL-COPYPASTE.sh
# UI: Stop → Run api-server

# On your PC (poll until FRESH):
pnpm run ops:redeploy-watch
pnpm run ops:post-redeploy   # target exit 0
pnpm run ops:wave-b
```

### B) AWS (production target)

```bash
# Owner machine or GitHub Actions (needs AWS_VIRGEN_SYNC_TOKEN):
node scripts/generate-aws-virgen-sync-manifest.mjs --tag v1.1.4-production-2026-07-10
./scripts/publish-aws-virgen-rc.sh v1.1.4-production-2026-07-10
# Or: workflow_dispatch sync-aws-virgen.yml with same tag

# Then tag triggers deploy.yml → ECR + SSM deploy.sh on EC2
```

Checklist: `deploy/aws/reports/06-READINESS_CHECKLIST_GONOGO.md`

### C) Expo EAS (mobile)

```bash
cd artifacts/banco-mobile
eas build --profile preview --platform android    # device QA first
eas build --profile production --platform all     # after QA green
```

Checklist: `audit/production-readiness/EXPO-EAS-PRODUCTION-CHECKLIST.md`

---

## 5) Required secrets (real production)

| Secret | Used for |
|--------|----------|
| `DATABASE_URL` | API + schema verify |
| `CLERK_SECRET_KEY` / publishable keys | Auth |
| `CLERK_BEARER_TOKEN` | staging upload smoke |
| `EXPO_TOKEN` | EAS builds |
| `AWS_VIRGEN_SYNC_TOKEN` | push to aws-virgen |
| S3 + `OBJECT_STORAGE_PROVIDER=s3` | media on AWS |
| Paymob live keys | payments at launch |

Full list: `audit/production-readiness/STAGING-REQUIRED-SECRETS.md`

---

## 6) Report index (read order)

| Priority | Path |
|----------|------|
| 1 | `DUAL_REPO_STATUS.md` |
| `audit/mobile/MOBILE-PUBLISH-SUCCESS-GATE.md` |
| `audit/mobile/WAVE-10-MASTER-REPORT-AR.md` |
| `audit/mobile/NEXT-OPS-REPLIT-REDEPLOY.md` |
| 2 | `audit/production-readiness/` (full tree) |
| `deploy/aws/reports/` |
| `deploy/gcp/reports/` |
| 3 | `release/AWS_VIRGEN_SYNC_MANIFEST.json` |
| `docs/AWS_VIRGEN_FULL_PUBLISH.md` |

---

## 7) Remaining blockers (cannot be faked)

1. **Replit redeploy** — wave 8 `seller.social_links` on live host  
2. **`CLERK_BEARER_TOKEN`** — full upload smoke  
3. **Device QA** — `audit/mobile/DEVICE-QA-SECTION-COMPANIES.md`  
4. **aws-virgen sync + AWS infra** — ops configuration  
5. **EAS production + store forms** — after QA

---

## 8) Sync manifest

Regenerate after each release:

```bash
node scripts/generate-aws-virgen-sync-manifest.mjs --tag v1.1.4-production-2026-07-10
```

Output: `release/AWS_VIRGEN_SYNC_MANIFEST.json`
