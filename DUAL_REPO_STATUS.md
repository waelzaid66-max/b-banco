# حالة الريبوهين الرسميين — مصدر الحقيقة

**آخر تحديث:** 2026-07-11 (v1.1.5 production hardening + browse journeys)  
**النطاق:** ريبوهان الإنتاج + مرآات GitHub (bbanco · bdeals · B-OOM).

| الريبو | الرابط | الدور |
|--------|--------|-------|
| **أساسي** | https://github.com/waelzaid66-max/-BANCO-CA-OOM- | كود + CI + تقارير + GCP + Replit |
| **AWS** | https://github.com/waelzaid66-max/aws-virgen | نشر EC2/Elastic Beanstalk (نسخة مطابقة للأساسي) |

**مرجع النشر الكامل:** `audit/production-readiness/FULL-DEPLOY-TASK-MATRIX-2026-07-11-AR.md`  
**وسم الإصدار:** `v1.1.5-production-2026-07-11`

---

## SHA والوسم المستهدف

| الريبو | الفرع | Tag | ملاحظة |
|--------|--------|-----|--------|
| **-BANCO-CA-OOM-** | `main` | `v1.1.5-production-2026-07-11` | confidence **19/19** · website CI **9/9** |
| **aws-virgen** | `main` | نفس الوسم | بعد `publish-aws-virgen-rc.sh` أو workflow |
| **B-OOM** (مرآة) | `main` | نفس SHA | `git push boom main` |

```bash
git fetch origin main && git rev-parse --short origin/main
pnpm run confidence                              # 19/19
node scripts/website-ci-local.mjs                # 9/9
pnpm run typecheck
pnpm run ops:full-verify
```

---

## مصفوفة النشر الصادقة

| الطبقة | مثبت؟ | الدليل |
|--------|--------|--------|
| كود GitHub أساسي | ✅ | browse journeys + seller bio API |
| production-confidence | ✅ | **19/19** |
| website CI local | ✅ | **9/9** |
| monorepo typecheck | ✅ | api-server + mobile + libs |
| API integration (محلي) | ⚠️ | `pnpm run test:api:local` (Docker Postgres) |
| API integration (CI) | ✅ | GitHub Actions + Postgres service |
| aws-virgen sync | ⏳ | `AWS_VIRGEN_SYNC_TOKEN` + tag push |
| API حي — موجة 6 | ✅ | ISO + map bookable/price |
| API حي — موجة 8+10C+bio | ❌ **STALE** | Replit redeploy من `main` |
| upload smoke | ⚠️ | health 2/2 · upload needs JWT |
| EAS / متجر | ⏳ | بعد FRESH + Device QA |

---

## Replit redeploy (blocking wave 8 on live)

```bash
bash audit/mobile/REPLIT-SHELL-COPYPASTE.sh
pnpm run ops:redeploy-watch
```

---

## aws-virgen — مزامنة

```bash
node scripts/generate-aws-virgen-sync-manifest.mjs --tag v1.1.4-production-2026-07-10
./scripts/publish-aws-virgen-rc.sh v1.1.4-production-2026-07-10
```

أو GitHub Actions: **Sync aws-virgen (full main)** مع نفس الوسم.

---

## مرآات إضافية (اختياري)

```bash
git push origin main
git push origin v1.1.4-production-2026-07-10
git push bbanco main
git push bdeals main
git push boom main
```

---

## Device QA (مفتوح)

`audit/mobile/DEVICE-QA-SECTION-COMPANIES.md` — لم يُنفَّذ على جهاز حقيقي بعد FRESH.
