# حالة الريبوهين الرسميين — مصدر الحقيقة

**آخر تحديث:** 2026-07-10 (موجة 10C + production snapshot v1.1.4)  
**النطاق:** ريبوهان الإنتاج + مرآات GitHub (bbanco · bdeals · B-OOM).

| الريبو | الرابط | الدور |
|--------|--------|-------|
| **أساسي** | https://github.com/waelzaid66-max/-BANCO-CA-OOM- | كود + CI + تقارير + GCP + Replit |
| **AWS** | https://github.com/waelzaid66-max/aws-virgen | نشر EC2/Elastic Beanstalk (نسخة مطابقة للأساسي) |

**مرجع الإنتاج الكامل:** `release/PRODUCTION-FULL-SNAPSHOT-2026-07-10.md`  
**وسم الإصدار:** `v1.1.4-production-2026-07-10`

---

## SHA والوسم المستهدف

| الريبو | الفرع | Tag | ملاحظة |
|--------|--------|-----|--------|
| **-BANCO-CA-OOM-** | `main` | `v1.1.4-production-2026-07-10` | waves 6–10C + TS fix |
| **aws-virgen** | `main` | نفس الوسم | بعد `publish-aws-virgen-rc.sh` أو workflow |

```bash
git fetch origin main && git rev-parse --short origin/main
node scripts/production-confidence-check.mjs    # 19/19
pnpm run ops:full-verify
pnpm run ops:probe-full
```

---

## مصفوفة النشر الصادقة

| الطبقة | مثبت؟ | الدليل |
|--------|--------|--------|
| كود GitHub أساسي | ✅ | waves 6–10C · confidence **19/19** |
| mobile typecheck | ✅ | `ListingMediaEditor` fix included |
| lib-hardening | ✅ | **57/57** |
| aws-virgen sync | ⏳ | يحتاج `AWS_VIRGEN_SYNC_TOKEN` + tag push |
| API حي — موجة 6 | ✅ | ISO + map bookable/price |
| API حي — موجة 8 | ❌ **STALE** | `seller.social_links` — Replit redeploy |
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
