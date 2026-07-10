# تقرير فحص شامل — 2026-07-10

**الفرع:** `fix/mobile-master-stabilize`  
**القاعدة:** لا أخضر مزيف — كود ≠ Live ≠ جهاز ≠ متجر  
**الغرض:** مراجعة كل ما سبق (M01–M31، P0 أمان، عزل الشركات، OPS) + إصلاح عميق للثغرات المكتشفة في هذه الجلسة.

---

## 1) الحكم التنفيذي

| الطبقة | الحالة | ملاحظة |
|--------|--------|--------|
| بوابة `pnpm run confidence` | **PASS 19/19** | typecheck + 34 mobile + 35 contract + proofs + C-02 + API sanitize |
| كود عزل الأقسام (محلي) | **مُحسَّن** | 8 إصلاحات جذرية (انظر §3) |
| Live Replit | **STALE** | لم يُنشر الفرع بعد — `badIsoStatus=200`، map بدون bookable/price |
| Smoke كامل (upload) | **BLOCKED** | `CLERK_BEARER_TOKEN` غير موجود في `.secrets/local.env` |
| Schema verify من PC | **BLOCKED** | `DATABASE_URL` → ENOTFOUND (شبكة/DNS) |
| EAS | **جاهز تقنياً** | `EXPO_TOKEN` موجود — ينتظر FRESH + Device QA |
| Website / Paymob | **خارج النطاق** | O17 SKIP، B5 معطّل |

**الخلاصة:** مسار **كود الموبايل + أمان + عزل** مغلق وموثّق. **النشر التشغيلي** ما زال يبدأ بـ **redeploy Replit** ثم Wave B.

---

## 2) ما شُغّل (أدلة هذه الجلسة)

| الأمر | النتيجة |
|-------|---------|
| `pnpm run confidence` | **19/19 PASS** |
| `probe-live-deploy.mjs` | exit **2** STALE |
| `pre-redeploy-code-gate.mjs` | exit **0** @ HEAD |
| `staging-p0-smoke` (health فقط) | **2/2** healthz/readyz |
| `verify-upload-claims-schema` | فشل ENOTFOUND (شبكة) |

---

## 3) ثغرات اكتُشفت وأُصلحت (جذر — ليست polish)

### عالية — Discover «استكشف على الخريطة»

**المشكلة:** الـ CTA يقيّم `openSection` (سيارات/عقار/صناعي) لكن `exploreOnMap` كان يفتح `criteria.category` أو يفترض `real_estate` عند `all` → المستخدم يوسّع قسم السيارات ويُرسَل لخريطة عقار.

**الإصلاح:** `SearchDiscover` يمرّر `openSection ?? "real_estate"`؛ `exploreOnMap(section)` يضبط `category` من القسم المفتوح.

### متوسطة — API يقبل فلاتر عبر الأقسام

**المشكلة:** `parsedFromSearchQuery` كان يمرّر `fuel_type` + `property_type` + `rental_term`… بلا بوابة قسم → استعلامات مصنّعة تتجاوز عقد الموبايل.

**الإصلاح:** `sanitizeParsedSearchQuery()` قبل `searchListings` / `mapClusters` — 8 اختبارات vitest بدون DB.

### متوسطة–منخفضة — بقية التسريبات

| # | المشكلة | الإصلاح |
|---|---------|---------|
| Autocomplete | مجموعة industrial كاملة رغم subtype محدد | `industrialType !== "all"` يضيّق `industrial_type` |
| شارة الفلاتر | تعدّ فلاتر قسم آخر | `activeFilterCount` مربوط بقواعد القسم |
| `applyFacetToCriteria` | `industrial_type` لا يمسح material/industry | نفس منطق `selectIndustrialType` |
| `applyFacetToCriteria` | `fuel_type` على غير سيارات | يُطبَّق فقط عند `category === "car"` |
| Web | `paymentType` يبقى installment على صناعي | `paymentType: "any"` عند facilities/materials |

**الملفات الرئيسية:**  
`sanitizeParsedSearchQuery.ts`, `searchController.ts`, `search.tsx`, `SearchDiscover.tsx`, `facets.ts`, `SearchControls.tsx`, `proof-isolation.mjs`, `facets.test.mjs`

---

## 4) أمان P0 (مراجعة)

| ID | الحالة | اختبار محلي |
|----|--------|-------------|
| C-01 upload IDOR | FOUND | vitest + DB (CI) |
| C-02 LIKE escape | **PASS** | `sqlLikeEscape.test.ts` |
| C-03 visibility | FOUND | vitest + DB |
| H-03 ACL | FOUND | vitest + DB |

---

## 5) السجلات (logs)

| المصدر | التقييم |
|--------|---------|
| `console.error` في api-server controllers | **مقصود** — معالجة أخطاء مع سياق `[Search]` إلخ |
| `crashLog.ts` / `ErrorFallback` mobile | **مقصود** — تشخيص أعطال |
| لا توجد `audit/**/*.log` في الريبو | نظيف |
| Live Replit | لا وصول لسجلات السيرفر من هنا — الـ probe يكفي لإثبات STALE |

**لا يُنصح** بحذف سجلات الأخطاء في الـ API — تخدم OPS. تحسين لاحق: structured logger (P2).

---

## 6) ما يبقى (OPS — لا يُغلق بالكود)

```
1. Replit redeploy → pnpm run ops:post-redeploy (exit 0)
2. CLERK_BEARER_TOKEN في .secrets/local.env
3. pnpm run ops:wave-b
4. eas build --profile preview
5. Device QA: DEVICE-QA-SECTION-COMPANIES.md
```

Runbook: `audit/mobile/NEXT-OPS-REPLIT-REDEPLOY.md`

---

## 7) أوامر تحقق سريعة

```powershell
pnpm run confidence
pnpm run ops:code-gate
pnpm run ops:next
# بعد redeploy:
pnpm run ops:post-redeploy
pnpm run ops:wave-b
```

---

## 8) سجل commits ذو الصلة (هذه الموجة)

- `db6cdb3` — عزل أقسام: sanitize API + discover map + confidence 19/19 (Windows spawn)
- **(محلي)** — رحلة المستخدم: ضيف يتصفح الإعلان، `/l/:id`، parse كامل للبحث، market refetch، saved search v2

---

## 9) موجة صيانة رحلة المستخدم (2026-07-10 — الجلسة الثانية)

| # | المشكلة | الإصلاح |
|---|---------|---------|
| 1 | الضيف يرى البطاقات لكن لا يفتح التفاصيل (Task #101 vs API عام) | إزالة `requireAuth` من Home/Search؛ `listing/[id]` يحمّل بدون قفل |
| 2 | روابط المشاركة `/l/:id` → not-found | `app/l/[id].tsx` يعيد التوجيه إلى `/listing/:id` |
| 3 | deep link / saved / assistant يفقدون فلاتر العقد | `searchNavParams.ts` + `parseSearchCriteriaFromUrl` |
| 4 | Home feed لا يتحدث بعد hydrate السوق | `marketCountry` في deps الـ feed |
| 5 | Search يبقى على سوق قديم بعد hydrate | `retry()` عند وجود نتائج نشطة |
| 6 | حفظ البحث يخزن 6 حقول فقط | `SavedSearch.criteria` snapshot كامل (v2) |

**اختبارات:** mobile **39/39**، confidence **19/19**.

- `279e57a` — Wave B orchestrator + local secrets
- `77b2159` — C-02 unit test + confidence 18→19
- `8ba704e` — pre-redeploy code gate
- `fe745f3` — architecture maintenance wave
- `d919ca5` — strict section isolation M27–M31

---

## 10) موجة صيانة الجودة قبل التجريب الحي (2026-07-10 — الجلسة الثالثة)

| # | المشكلة | الإصلاح |
|---|---------|---------|
| 1 | `/messages/[id]` يفتح للضيف بدون رسائل ويُظهر المُرسل | `enabled: !!isSignedIn` + شاشة تسجيل دخول (مثل قائمة الرسائل) |
| 2 | ضغطة إشعار push تفتح `/billing` أو `/messages` للضيف | `notificationRequiresAuth()` + تحويل لـ Profile |
| 3 | تعديل إعلان «طلب شراء» يُجبر على سعر > 0 | تخطي التحقق من السعر + عدم إرسال `base_price_cash`؛ API يُرجع `is_request` في `ListingDetail` |
| 4 | «استكشف على الخريطة» يفشل بصمت بدون إحداثيات | `Alert` بـ `search.mapNoPins` عند فشل `wantMap` |
| 5 | عمليات بحث محفوظة v1 بدون `criteria` | `upgradeSavedSearches()` عند التحميل من AsyncStorage |

**اختبارات:** mobile **44/44**، lib-hardening **31**، confidence **19/19**.

**ما زال OPS (ليس كود):** Replit redeploy → `pnpm run ops:post-redeploy` (FRESH) → `CLERK_BEARER_TOKEN` → `ops:wave-b` → EAS preview + Device QA.

---

## 11) موجة إصلاح جذرية P0 (2026-07-10 — الجلسة الرابعة)

| # | المشكلة | الإصلاح |
|---|---------|---------|
| 1 | `contactLead` يُرجع هاتف البروفايل فقط — يتجاهل `specs.contact_phones` | `LeadService.revealPhoneFromListing()` + join على `listingAttributes` |
| 2 | إشعار رسالة push يفتح thread بدون `name` / `listingId` / `role` | API يُرفق `counterparty_name` + `viewer_role`؛ `notificationRouting` يمرّرها لـ `/messages/[id]` |
| 3 | الماسنجر: تفاعلات مزدوجة RTL + حدود quote/reply غير مرئية | إزالة `row-reverse` من التفاعلات؛ حدود فيزيائية `borderLeft`/`borderRight`؛ إزالة `scaleX` من أيقونة الإرسال |
| 4 | الرئيسية: قلب نص/لغة + تبديل سوق عند التحميل | `prefsReady` (لغة + سوق) قبل أول fetch وقبل إخفاء الهيكل |
| 5 | بحث: زر الدولة مخفي خارج إيجار/صناعي | `MarketCountryButton` دائمًا في شريط البحث + قسم «الدولة» في FilterSheet |
| 6 | فلاتر البحث بلون عام واحد | `sectionAccent` على شرائح القسم + `EngineChips`/`ToggleChipRow` |
| 7 | بروفايل: هاتف التسجيل بدون E.164؛ الهاتف مخفي؛ روابط بلا عنوان | `CountryCodePicker` عند التسجيل؛ عرض الهاتف على السطح؛ ترويسة `socialLinks` + `addSocial` |

**اختبارات:** lib-hardening **31/31**، mobile regression **44/44**، confidence **19/19**.

**أمان:** الأسرار التي أُرسلت في الشات **يجب تدويرها فورًا** (`GITHUB_TOKEN`، `CLERK_SECRET_KEY`، `SESSION_SECRET`). التخزين الصحيح: `.secrets/local.env` (محلي) وReplit Secrets (إنتاج) — **لا تُرفع في Git**.

**ما زال OPS:** Replit redeploy من الفرع الحالي → `pnpm run ops:post-redeploy` حتى **FRESH** → Device QA على جهاز حقيقي.

---

*آخر تحديث: موجة P0 الجذرية 2026-07-10. لا تُعلَن جاهزية متجر قبل FRESH + smoke + Device QA.*
