# جدول مهام النشر الكامل — BANCO Store

**التاريخ:** 2026-07-11  
**الفرع:** `main`  
**الوسم المستهدف:** `v1.1.5-production-2026-07-11`  
**Commit مرجعي:** بعد `bcd442e` (browse journeys + seller bio + web parity)

---

## 1) الحكم الصادق (لا كذب)

| البند | الحالة | الدليل |
|--------|--------|--------|
| كود GitHub أساسي | ✅ | `origin/main` محدث |
| Website CI محلي | ✅ | `node scripts/website-ci-local.mjs` → 9/9 |
| search-contract | ✅ | 44/44 |
| mobile lib-hardening | ✅ | 57/57 |
| production-confidence | ✅ | `pnpm run confidence` (بدون Postgres) |
| typecheck monorepo | ✅ | `pnpm run typecheck` |
| build API + admin + dealer | ✅ | CI job `build-core` |
| build landing + banco-web | ✅ | website CI |
| API integration tests (محلي) | ⚠️ | يحتاج Postgres — `pnpm run test:api:local` (Docker) |
| API حي Replit — موجة 6 | ✅ | ISO + map bookable/price |
| API حي Replit — موجة 8+10C | ❌ **STALE** | `seller.social_links` + bio — **Replit redeploy إلزامي** |
| aws-virgen sync | ⏳ | `AWS_VIRGEN_SYNC_TOKEN` + workflow |
| AWS EC2/ECR deploy | ⏳ | infra + secrets + tag |
| EAS / متجر | ⏳ | بعد FRESH + Device QA |

**الخلاصة:** الكود **جاهز للنشر** بعد إعادة تشغيل Replit + مزامنة aws-virgen. الإنتاج الكامل على AWS **م conditioned** على البنية التحتية والأسرار.

---

## 2) الريبوهان الرسميان

| # | الريبو | Remote | الفرع | الأمر |
|---|--------|--------|-------|-------|
| 1 | **-BANCO-CA-OOM-** (أساسي) | `origin` | `main` | `git push origin main` |
| 2 | **aws-virgen** (AWS deploy) | عبر sync | `main` | انظر §4 |

**مرآات اختيارية (نفس SHA):** `boom` (B-OOM), `bbanco`, `bdeals`

```bash
git push origin main
git push origin v1.1.5-production-2026-07-11
git push boom main
git push boom v1.1.5-production-2026-07-11
```

---

## 3) بوابات التحقق المحلي (قبل أي push)

```powershell
cd C:\Users\waelz\Downloads\BANCO-CA-OOM

# 1 — ثقة الإنتاج (بدون أسرار)
pnpm run confidence

# 2 — موقع الويب (معزول)
node scripts/website-ci-local.mjs

# 3 — typecheck كامل
pnpm run typecheck

# 4 — build core (API + admin + dealer)
pnpm --filter @workspace/api-server --filter @workspace/dealer-os --filter @workspace/admin-os run build

# 5 — API pure unit (بدون Postgres)
pnpm run test:api:unit

# 6 — API integration (Docker + Postgres) — اختياري محلياً، إلزامي في CI
pnpm run test:api:local

# 7 — بوابة ما قبل Replit
node audit/mobile/scripts/pre-redeploy-code-gate.mjs
```

**CI على GitHub** (`.github/workflows/ci.yml`): يكرر typecheck + build + Postgres tests + mobile regression + GCP gate.

---

## 4) مسار A — Replit (API حي — blocking)

| # | المهمة | الملف / الأمر | المسؤول |
|---|--------|---------------|---------|
| A1 | fetch + pull main | `audit/mobile/REPLIT-SHELL-COPYPASTE.sh` | Replit Shell |
| A2 | pnpm install | داخل السكript | Replit |
| A3 | drizzle push-force | داخل السكript | Replit |
| A4 | إعادة تشغيل api-server | Replit UI Stop → Run | Replit |
| A5 | healthz + readyz | `curl …/api/healthz` | أي طرف |
| A6 | إثبات FRESH | `pnpm run ops:post-redeploy` | PC |
| A7 | مراقبة | `pnpm run ops:redeploy-watch` | PC |

**مرجع:** `audit/mobile/NEXT-OPS-REPLIT-REDEPLOY.md`

---

## 5) مسار B — aws-virgen + AWS

| # | المهمة | الملف | ملاحظة |
|---|--------|-------|--------|
| B1 | توليد manifest | `scripts/generate-aws-virgen-sync-manifest.mjs --tag v1.1.5-production-2026-07-11` | |
| B2 | نشر إلى aws-virgen | `scripts/publish-aws-virgen-rc.sh` أو workflow `sync-aws-virgen.yml` | `AWS_VIRGEN_SYNC_TOKEN` |
| B3 | tag على main | `git tag v1.1.5-production-2026-07-11 && git push origin --tags` | يشغّل `deploy.yml` |
| B4 | تحقق CI deploy | `.github/workflows/deploy.yml` | ECR + SSM |
| B5 | EC2 deploy | `deploy/aws/scripts/deploy.sh` | SSM secrets |
| B6 | health gate | `/api/readyz` | |

**Dockerfiles:**

| ملف | الغرض |
|-----|--------|
| `Dockerfile` | API — Elastic Beanstalk |
| `deploy/aws/Dockerfile.api` | API — compose/ECR |
| `deploy/aws/Dockerfile.web` | admin + dealer + landing (Nginx) |
| `deploy/aws/Dockerfile.banco-web` | Next.js consumer — CI فقط |
| `deploy/gcp/Dockerfile.api` | Cloud Run |
| `deploy/aws/docker-compose.prod.yml` | stack EC2 |
| `docker-compose.test.yml` | Postgres محلي للاختبارات |

**Env templates:** `deploy/aws/env/.env.production.example`, `.env.staging.example`

**تقارير:** `deploy/aws/reports/00-README.md` … `07-*.md`

---

## 6) مسار C — Website (banco-web)

| # | المهمة | env | ملاحظة |
|---|--------|-----|--------|
| C1 | build | `pnpm --filter @workspace/banco-web run build` | website CI |
| C2 | Docker image | `deploy/aws/Dockerfile.banco-web` | `ci-website-docker.yml` |
| C3 | تفعيل live search | `NEXT_PUBLIC_WEB_SEARCH_LIVE=true` | بعد API FRESH |
| C4 | خريطة | `NEXT_PUBLIC_WEB_SEARCH_MAP=true` + Maps key | |
| C5 | staging smoke | `scripts/website-staging-smoke.mjs` | بعد CDN |

**مرجع:** `audit/website/WEBSITE-READINESS-GATES.md`, `WEBSITE-PRE-START-PLAYBOOK-AR.md`

---

## 7) مسار D — Mobile (EAS)

| # | المهمة | ملف |
|---|--------|-----|
| D1 | typecheck | `artifacts/banco-mobile` |
| D2 | regression | `test:icons`, `test:lib`, `test:resilience`, `test:universal-links` |
| D3 | EAS preview | `artifacts/banco-mobile/eas.json` |
| D4 | Device QA | `audit/mobile/DEVICE-QA-SECTION-COMPANIES.md` |
| D5 | production submit | بعد FRESH + QA |

---

## 8) الأسرار المطلوبة

| Secret | أين | blocking |
|--------|-----|----------|
| `DATABASE_URL` | Replit / AWS RDS / CI | ✅ |
| `CLERK_SECRET_KEY` + publishable | API + mobile | ✅ |
| `CLERK_BEARER_TOKEN` | upload smoke | ⚠️ |
| `AWS_VIRGEN_SYNC_TOKEN` | sync workflow | aws path |
| S3 / GCS keys | uploads | ✅ prod |
| Paymob live | billing | prod only |
| `EXPO_TOKEN` | EAS | mobile |
| Google Maps | web map | optional |

**مرجع:** `audit/production-readiness/STAGING-REQUIRED-SECRETS.md`

---

## 9) مشاكل معروفة + حلول (صادقة)

| المشكلة | السبب | الحل |
|---------|--------|------|
| API tests fail بدون DATABASE_URL | integration suite | `pnpm run test:api:local` أو CI |
| Replit STALE wave 8 | deploy قديم | §4 A1–A7 |
| upload smoke blocked | لا JWT | Clerk test user token |
| banco-web ليس في compose prod | تصميم | Nginx منفصل أو أضف service |
| ECR vs on-host build | deploy.yml vs deploy.sh | توحيد لاحقاً — الآن EC2 يبني من git |
| facet counts rental_term/material | API gap | filter يعمل؛ counts لاحقاً |
| Web contact بدون Clerk | by design | deep-link للتطبيق |

---

## 10) ترتيب التنفيذ الموصى به

```
1. بوابات §3 (محلي) — كلها PASS
2. commit + tag v1.1.5-production-2026-07-11
3. push origin main + tags
4. push boom main (مرآة)
5. Replit redeploy §4 → ops:post-redeploy exit 0
6. aws-virgen sync §5
7. (اختياري) AWS tag deploy
8. website env flags §6
9. EAS preview §7
10. Device QA → store
```

---

## 11) فهرس الملفات المرجعية

| مسار | الغرض |
|------|--------|
| `DUAL_REPO_STATUS.md` | حالة الريبوهين |
| `release/PRODUCTION-FULL-SNAPSHOT-2026-07-10.md` | لقطة v1.1.4 |
| `audit/mobile/NEXT-OPS-REPLIT-REDEPLOY.md` | Replit |
| `audit/mobile/HONEST-INVENTORY-2026-07-10.md` | فجوات صادقة |
| `audit/website/WEBSITE-MASTER-PLAN-AR.md` | خطة الويب |
| `scripts/production-confidence-check.mjs` | 19-check gate |
| `scripts/website-ci-local.mjs` | website 9-step |
| `scripts/run-api-tests-local.mjs` | API + Docker |
| `.github/workflows/ci.yml` | CI core |
| `.github/workflows/ci-website.yml` | CI website |
| `.github/workflows/deploy.yml` | AWS CD |

---

**آخر تحديث:** 2026-07-11 — يُحدَّث بعد كل tag push.
