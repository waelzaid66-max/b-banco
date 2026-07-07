# خطة الصيانة والجاهزية الشاملة — BANCO OOM

**آخر تحديث:** 2026-07-07  
**الفرع المحلي:** `maintenance/wave-4-search-taxonomy` (موجات 4–5 + جرد الفوترة)  
**الفرع على GitHub:** `maintenance/wave-4-search-taxonomy`  
**قرار الإصدار:** **GO WITH FIXES** (انظر `audit/rc1/BANCO-STORE-RELEASE-CANDIDATE-REPORT.md`)

> **مبدأ العمل:** نُضيف ونُصلح دون هدم — لا حذف لمسارات أو فروع أو دول مدعومة. العقارات والأقسام متعددة الدول تبقى في التصنيف والإنشاء؛ الصيانة طبّقت **طبقة بحث إضافية** فوق ما هو موجود.

---

## 1. ملخص تنفيذي

| البند | الحالة |
|--------|--------|
| أمان P0 (رفع ملفات، LIKE، رؤية المحذوفين، ACL) | ✅ منفّذ (`e24014b`) |
| إصلاح CI (typecheck + build) | ✅ منفّذ محلياً — بانتظار دمج `main` على GitHub |
| رحلة رفع الصور/الفيديو → نشر إعلان | ✅ محسّنة (claims + رسائل خطأ) |
| بحث صناعي (مرافق / مواد) | ✅ موجة 2 |
| بحث عقارات (إيجار/تمليك، أنواع، نظام إيجار) | ✅ موجة 3 — **إضافة فقط** |
| EAS (بناء متجر دون إرسال) | ✅ metadata + توثيق |
| تقارير RC-1 + موجات الصيانة | ✅ في `audit/` و `release/` و `reports/` |
| جرد المحفظة والفوترة (B0) | ✅ `WALLET-BILLING-FINANCE-AUDIT.md` |
| دمج موجات 4–5 على `origin/main` | ⏳ بعد commit + push |
| نشر AWS / GCP / المتاجر | ❌ **متعمّد — خارج النطاق حتى الجاهزية** |

---

## 2. ما تم صيانته وتحديثه (منفّذ — لا تعيد النقاش)

### 2.1 أمان وإصلاحات حرجة (قبل الموجات)

| المعرف | الوصف | الملفات المرجعية |
|--------|--------|------------------|
| C-01 | منع IDOR على رفع الملفات + جدول `upload_claims` | `audit/fixes/C-01-upload-idor.md` |
| C-02 | تهريب wildcards في LIKE | `audit/fixes/C-02-like-wildcard.md` |
| C-03 | إخفاء مستخدمين محذوفين من الخلاصة | `audit/fixes/C-03-deleted-users-visibility.md` |
| H-03 | ACL بمعرّف المالك الصحيح | `audit/fixes/H-03-acl-owner-clerk-id.md` |

**Commit:** `e24014b`

### 2.2 الموجة 1 — رفع، CI، صحة، EAS

| التحسين | لماذا | التوثيق |
|---------|--------|---------|
| `LIKE … ESCAPE` عبر `sql` | إصلاح فشل CI على Drizzle | `WAVE-1-UPLOAD-CI-EAS.md` |
| `/api/healthz` قبل Clerk | منع 500 على المراقبة | نفس الملف |
| تمديد claim 60 دقيقة بعد verify | وقت كافٍ لإكمال إنشاء الإعلان | `uploadClaims.ts` |
| رسائل خطأ رفع مميزة (انتهاء/حجم/شبكة) | UX إنشاء الإعلان | `lib/upload.ts`, `create.tsx` |
| Drizzle على Windows | `fileURLToPath` | `lib/db/drizzle.config.ts` |
| `ios.buildNumber` + `autoIncrement` | جاهزية EAS | `eas.json`, `app.json` |

**Commit:** `3607c0a`

### 2.3 الموجة 2 — بحث صناعي

| التحسين | ملاحظة |
|---------|--------|
| `industrialType` في معاملات البحث | يطابق API `industrial_type` |
| `IndustrialSubChips` على تبويب البحث | نفس نمط Home و Industry Hub |
| شرائح محلي/مستورد | كما في Industry Hub |
| المساعد → `/(tabs)/search` | سطح بحث واحد |

**Commit:** `3607c0a` (مع الموجة 1)

### 2.4 الموجة 3 — عقارات + توحيد مسار البحث + EAS

| التحسين | ملاحظة |
|---------|--------|
| شرائح **نظام الإيجار** inline عند إيجار (مخفية عند تمليك) | نفس `RENTAL_TERMS` المستخدم في `FilterSheet` — **لم يُحذف FilterSheet** |
| محركات `land` / `hotel` | `requiresFacet: true` — تظهر فقط مع مخزون |
| تمليك يمسح `rentalTerm` | منع تضارب فلاتر |
| `/search-results` → إعادة توجيه للتبويب | روابط قديمة تعمل |
| قبول `engine` من الروابط | مساعد + deep links |
| كتلة iOS في profile `preview` | `eas.json` |

**Commit:** `cdf90b9`

### 2.5 تحقق محلي (بعد الموجات)

```
pnpm run typecheck     → PASS (7 حزم)
api-server build       → PASS
dealer-os vite build   → PASS
health smoke (محلي)    → PASS بعد موجة 1 (قبل Clerk)
```

---

## 3. ما لم يُمس — عمداً (لا تقلق من فقدان فروع/دول)

| المنطقة | ما بقي كما هو |
|---------|----------------|
| **دول متعددة** | `MARKET_COUNTRIES` + `rentalTermsForCountry()` في **إنشاء الإعلان** |
| **تصنيف عقاري** | `listingCreateTaxonomy.ts` — أنواع، دفعات، مركّب، إلخ |
| **محركات البحث** | `constants/engines.ts` — تمليك/إيجار دائماً؛ الباقي facet-gated |
| **ورقة الفلاتر الكاملة** | `FilterSheet.tsx` — كل الفلاتر المتقدمة |
| **الخريطة والتجميع** | `SearchResultsMap`, bbox clustering |
| **أيقونات Android** | lucide registry — اختبار 6/6 |
| **الأصوات والإشعارات** | `SoundContext`, push — لم تُحذف |
| **origin الروابط** | `https://replit.com/` في `app.json` — مؤجّل حتى موافقة نطاق الإنتاج |
| **ملفات admin/dealer/landing** | آلاف التعديلات غير المرتبطة **لم تُدمج** في commits الصيانة |

### توضيح العقارات متعددة الدول

- **الإنشاء:** نظام الإيجار يتغيّر حسب الدولة (`rentalTermsForCountry`) — **لم يُغيّر**.
- **البحث (موجة 3):** أضفنا شرائح نظام الإيجار على التبويب بنفس قائمة `RENTAL_TERMS` التي يستخدمها `FilterSheet` اليوم — **سلوك متسق مع الموجود، ليس استبدالاً للفروع حسب الدولة في الإنشاء**.

---

## 4. ما تبقى — مرتّب بالأولوية (لا تُعالَج مرتين)

### P0 — قبل أي نشر أو متجر

| # | المهمة | الحالة | ملاحظة |
|---|--------|--------|--------|
| 1 | دمج موجات 1–3 على `origin/main` | ✅ | @ `0eea161` |
| 2 | CI أخضر (Typecheck & build + API tests) | ⏳ | push `ddd6cd3`+ — تحقق على GitHub Actions |
| 3 | `drizzle push` لجدول `upload_claims` على staging/prod | ⏳ | C-01 — `ensureSchemaPatches` + `WAVE-P0-STAGING-VALIDATION.md` |
| 4 | smoke staging بمفاتيح Clerk + تخزين حقيقي | ⏳ | قائمة خطوات في `WAVE-P0-STAGING-VALIDATION.md` |

### P1 — منتج (قرار مطلوب — لا صيانة عشوائية)

| # | المهمة | لماذا مؤجّل |
|---|--------|-------------|
| 5 | شاشة **تعديل إعلان** على الموبايل (حقول أساسية) | ✅ موجة R1 | عنوان/وصف/موقع/سعر — `WAVE-R1-FURNISHED-RENTAL-HUB.md` |
| 6 | **بالقرب مني** `near_lat` / `radius_km` على الموبايل | ✅ موجة 5 | OpenAPI + FilterSheet + map parity |
| 7 | فلترة نظام الإيجار **حسب دولة السوق** على البحث | ✅ موجة 4 | `lib/searchTaxonomy.ts` |
| 8 | المزيد من `property_type` في المحركات | facet-gated فقط عند وجود مخزون |

### P2 — بنية ونشر

| # | المهمة |
|---|--------|
| 9 | مجلد نشر GCP (غير موجود) |
| 10 | تغيير `expo-router.origin` عند اعتماد النطاق |
| 11 | ESLint monorepo |
| 12 | اختبارات offline / crash / أداء آلية |

### P3 — بحث (موجات 4–5)

- ✅ موجة 4: محاذاة بحث العقارات مع `MARKET_COUNTRIES` + sync محركات السيارات — `WAVE-4-SEARCH-TAXONOMY.md`
- ✅ موجة 5: near-me على الموبايل + تطابق خريطة/قائمة + OpenAPI — `WAVE-5-SEARCH-GEO-MAPS.md`

### P4 — محفظة وفوترة (جرد B0 + خطة B1–B5)

**مبدأ:** الماكينة المالية **موجودة ومربوطة**؛ المنصة **مجانية تشغيلياً** (baseline 50/50، Paymob معطّل من الأدمن). لا تفعيل مدفوع حتى موجة B5 بقرار إداري.

| موجة | المحتوى | خطر على المجاني |
|------|---------|------------------|
| **B0** | جرد كامل — `WALLET-BILLING-FINANCE-AUDIT.md` | صفر |
| **B1** | ✅ فواتير UI (قراءة)، إيراد أدمن من ledger، OpenAPI payments — `WAVE-B1-BILLING-UI.md` | صفر |
| **B2** | ✅ مركز مالي Hub + فلاتر معاملات + سجل promo — `WAVE-B2-FINANCE-HUB.md` | صفر |
| **B3** | ✅ إشعارات وإيميل فوترة — `WAVE-B3-BILLING-NOTIFICATIONS.md` | منخفض |
| **B4** | ✅ PDF فواتير + كشف CSV شهري — `WAVE-B4-EXPORT.md` | منخفض |
| **B5** | تفعيل Paymob + خطط مدفوعة | **قرار إداري فقط** |

**خارج v1:** محفظة بين مستخدمين، سحب أرباح، تقسيط، نقاط، كوبونات خصم.

### P2+ — مقترح لاحقاً (ملايين مستخدمين)

| # | المهمة |
|---|--------|
| 13 | فهرس geo / geohash على الإحداثيات الفعّالة |
| 14 | `sort=nearest` (ترتيب بالمسافة) |
| 15 | لمس خفيف haptic/sound |

---

## 5. خريطة المستندات (مصدر واحد للحقيقة)

```
audit/
├── maintenance/
│   ├── MASTER-MAINTENANCE-READINESS-PLAN.md   ← هذا الملف
│   ├── WAVE-1-UPLOAD-CI-EAS.md
│   ├── WAVE-2-SEARCH-INDUSTRIAL.md
│   ├── WAVE-3-SEARCH-RE-EAS.md
│   ├── WAVE-4-SEARCH-TAXONOMY.md
│   ├── WAVE-5-SEARCH-GEO-MAPS.md
│   ├── WAVE-R1-FURNISHED-RENTAL-HUB.md
│   ├── WAVE-PH1-PRODUCTION-HARDENING.md
│   ├── WAVE-B4-EXPORT.md
│   └── WAVE-P0-STAGING-VALIDATION.md
│   └── WALLET-BILLING-FINANCE-AUDIT.md
├── rc1/
│   ├── BANCO-STORE-RELEASE-CANDIDATE-REPORT.md
│   └── *.log (مخرجات التحقق)
├── fixes/ C-01, C-02, C-03, H-03
release/   EAS_BUILD, STORE_PUBLISHING, USER_JOURNEY, …
reports/   مقارنات repos + WALLET-BILLING-AUDIT-2026-07-07.md
scripts/rc1-validation.ps1
.agents/memory/  قرارات معمارية (taxonomy, rent-engine, icons, …)
```

---

## 6. حالة Git والريبوهات

| الريبو | المسار / URL | آخر معروف | إجراء |
|--------|----------------|-----------|--------|
| **هنا (أساسي)** | `origin` → `waelzaid66-max/-BANCO-CA-OOM-` | `main` متقدم بـ 2 commits عن `origin/main` | دفع + PR |
| **فرع الصيانة** | `maintenance/wave-1-3-upload-search-eas` | ✅ مرفوع | افتح PR → `main` |
| **upstream محلي** | `banco stor app/banco.store-main` | عند `c4fb358` (قديم) | مزامنة بعد دمج |

**روابط PR:**  
https://github.com/waelzaid66-max/-BANCO-CA-OOM-/pull/new/maintenance/wave-1-3-upload-search-eas

---

## 7. قائمة تحقق قبل «نكمل صح»

- [ ] دمج PR → `main` على GitHub
- [ ] Actions: Typecheck & build + API tests = green
- [ ] قراءة هذا الملف + RC-1 قبل أي موجة جديدة
- [ ] أي تغيير عقارات/دول: **تحقق من** `listingCreateTaxonomy.ts` + `engines.ts` + `FilterSheet` — لا حذف
- [ ] EAS preview build يدوي عند الجاهزية (`release/EAS_BUILD.md`)

---

## 8. سجل Commits للصيانة (مرجع سريع)

```
cdf90b9  fix(search): wave 3 — RE rental chips, land/hotel, route unify, EAS preview
3607c0a  fix: wave 1+2 — upload, health, CI, industrial search, EAS metadata
e24014b  fix(security): P0 upload IDOR, LIKE, visibility, ACL
```

---

*عند بدء أي مهمة جديدة: ابحث في هذا الملف عن رقم المهمة في §4 — إن كانت ⏳ أو P1 مؤجّلة، ناقش القرار قبل التنفيذ.*
