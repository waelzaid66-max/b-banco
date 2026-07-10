# بوابة نجاح نشر الموبايل — من أول الأهداف إلى الآن

**التاريخ:** 2026-07-10  
**الفرع:** `fix/mobile-master-stabilize`  
**القاعدة:** لا أخضر مزيف. الكود ≠ الجهاز ≠ Live ≠ المتجر.

---

## 0) أهدافك الرئيسية (من أول المحادثة)

| # | الهدف الأصلي | ترجمة تشغيلية |
|---|--------------|----------------|
| 1 | فهم عميق + فحص قبل أي تغيير | تقارير audit (إنتاج، أمان، رحلات) |
| 2 | إصلاح الأهم فالأهم ثم توثيق ورفع | P0 أمان → stabilize موبايل → Search شركات |
| 3 | نجاح **كامل للموبايل** أولاً | EAS preview + Device QA + API حي يطابق الفرع |
| 4 | ثم كل ما يترتب عليه (سوق / بحث / نشر إعلان / متاجر) | Staging smoke → production EAS → Play/App Store |
| 5 | لا هدم رحلات الأقسام / الحسابات | car · RE · facilities · materials · host · B2B سليمة |
| 6 | موقع consumer لا يعيق الموبايل | Website SKIP / CI منفصل (O17) |

**حكم صادق اليوم:** هدف **كود الموبايل + أمان P0 + عزل البحث** مكتمل على هذا الفرع.  
هدف **إطلاق متجر بثقة تشغيلية** ما زال ينتظر خطواتك (أسرار · redeploy · جهاز · EAS).

---

## 1) طبقات الحقيقة (لا تخلطها)

| طبقة | الحالة | دليل |
|------|--------|------|
| كود محلي M01–M31 + أمان P0 | **CLOSED** | `MOBILE-STABILIZE-PROGRESS.md`, `audit/fixes/C-01…` |
| اختبارات أوتوماتيك محلية | **PASS** حيث البيئة تسمح | `lib-hardening` 21/21، `proof-isolation` ok، CI mobile + universal-links |
| Live Replit API | **STALE** | `LIVE-DEPLOY-PROBE.md` — `market_country` / map bookable غير مطبّقة |
| Device QA | **OPEN** | `DEVICE-QA-SECTION-COMPANIES.md` لم يُنفَّذ |
| OPS O16 | **OPEN** | أسرار + smoke + EAS |
| Website | **غير حاجز** | O17 SKIP |

---

## 2) مسار النجاح الوحيد (بالترتيب — لا تقفز)

```
[1] دمج/نشر فرع stabilize على الـ API الذي يخدم الموبايل
        → دليل تنفيذي: NEXT-OPS-REPLIT-REDEPLOY.md
        → فحص سريع: node audit/mobile/scripts/ops-next-step.mjs
        ↓
[2] إعادة فحص Live: EG≠SA عند بيانات موسومة · map is_bookable/price · ISO سيء → 4xx
        ↓
[3] Wave A: أسرار STAGING + staging-p0-smoke + verify-upload-claims
        ↓
[4] eas build --profile preview → تثبيت على جهاز حقيقي
        ↓
[5] Device QA: ACCEPTANCE + EXTENDED + DEVICE-QA-SECTION-COMPANIES
   (create → صور → publish → فيد/بحث لكل شركة)
        ↓
[6] EAS production + store forms (بعد اجتياز 1–5 فقط)
```

**إيقاف صريح:** لا تدّعِ «نجاح نشر كامل» قبل الخطوة 5.  
لا تفعّل Paymob (B5) ولا تجعل فشل الموقع يوقف الموبايل.

---

## 3) قائمة تحقق — ماذا يغلق الوكيل vs أنت

### يغلقه الكود/الوكيل (تم أو شبه تم)

- [x] أمان رفع IDOR / LIKE / محذوفين / ACL
- [x] Stabilize M01–M27 (هاتف، إنشاء، بحث، خريطة، عزل أزرار)
- [x] شركات الأقسام + material + market على list/map/feed (M28–M31)
- [x] CI mobile يشمل icons + lib + resilience + **universal-links**
- [x] مسار نشر الإعلان محمٍ (لا تفعيل دفع)

### يغلقه أنت فقط (لا يمكن تزويره)

- [ ] Redeploy API (الفرع الحالي → Replit/staging)
- [ ] `BANCO_API_URL` + `CLERK_BEARER_TOKEN` + `DATABASE_URL`
- [ ] `node scripts/staging-p0-smoke.mjs` exit 0
- [ ] `node scripts/verify-upload-claims-schema.mjs` PASS
- [ ] `eas build --profile preview` + تثبيت APK
- [ ] تيك كل ID في Device QA على الجهاز
- [ ] Clerk OTP / Google / Apple / Push / Storage كما يلزم الرحلات
- [ ] Production EAS + Play / App Store عند الموافقة

---

## 4) أوامر جاهزة (نسخ/لصق)

```bash
# إثباتات كود الموبايل
pnpm --filter @workspace/banco-mobile run test
node audit/mobile/scripts/proof-isolation.mjs
node audit/mobile/scripts/proof-create-fields.mjs

# قبل/بعد redeploy — Freshness Live (exit 0 = FRESH, 2 = STALE)
node audit/mobile/scripts/probe-live-deploy.mjs
# node audit/mobile/scripts/probe-live-deploy.mjs https://your-staging-host

# Staging (يحتاج أسرارك — انظر STAGING-REQUIRED-SECRETS.md)
node scripts/staging-p0-smoke.mjs
node scripts/verify-upload-claims-schema.mjs

# EAS preview
cd artifacts/banco-mobile
eas build --profile preview --platform android
```

### Redeploy checklist (Replit / staging host)

1. تأكد أن الـ host يسحب فرع `fix/mobile-master-stabilize` (أو merge إلى الفرع الذي ينشر منه).
2. أعد تشغيل/نشر `api-server` بعد سحب الكود.
3. إن لزم: `pnpm --filter @workspace/db run push` / schema patches لـ `upload_claims`.
4. أعد `probe-live-deploy.mjs` حتى `verdict: FRESH`.
5. بعدها فقط Device QA / EAS claims لـ market + map bookable.

---

## 5) مصادر الحقيقة المرتبطة

| ملف | دور |
|-----|-----|
| هذا الملف | **بوابة نجاح الموبايل الوحيدة** |
| `MOBILE-STABILIZE-ACCEPTANCE.md` | مصفوفة سيناريوهات الجهاز |
| `MOBILE-STABILIZE-SUCCESS-CERT.md` | شهادة كود vs DoD جهاز |
| `FULL-VERIFICATION-2026-07-10.md` | طبقات auto / live / device |
| `FULL-READINESS-STATUS-PLAN.md` | جاهزية المنصة العامة |
| `OPEN-ITEMS-BACKLOG.md` | O16 OPS فقط |
| `STAGING-EAS-DEVICE-RUNBOOK.md` | ترتيب staging → EAS → جهاز |

---

## 6) الخلاصة للإدارة

**الموبايل كمنتج برمجي على الفرع جاهز للمتابعة نحو staging/جهاز.**  
**الموبايل كمنتج منشور على المتاجر ليس جاهزاً بعد** — لأن Live STALE وDevice/EAS/O16 مفتوحة عند المشغّل.

أي عمل كود إضافي قبل Wave A يجب أن يكون **إصلاح نكسة مثبتة فقط**، لا features جديدة ولا «تنظيف جمالي» يمس رحلات الأقسام.
