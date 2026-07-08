# خطة الجاهزية الكاملة — أين وصلنا؟ وهل اكتملت الأهداف؟

**التاريخ:** 2026-07-08  
**الفرع:** `main` @ `facd6fc`  
**نوع الوثيقة:** خطة حالة + مسار عمل (مثل الخطة الأولى للصيانة) — صادقة 100%

> **المبدأ الثابت:** مسار نشر الإعلان (create → photos → publish → feed/search) **محمي**. لا تفعيل Paymob. لا هدم لأسطح الموبايل/الويب/الأقسام.

---

## 0. الجواب المباشر (ثلث مطان)

| السؤال | الجواب |
|--------|--------|
| **هل الأهداف اكتملت؟** | **جزئياً — ~70–75% من مسار الجاهزية العامة** |
| **أهداف صيانة المنتج/البحث/الأمان (موجات 1–5 + P0/P1)** | **نعم — اكتملت ككود وتوثيق** |
| **أهداف الإطلاق العام (متجر + API prod)** | **لا — ينقص تنفيذ staging/EAS/أجهزة/أسرار** |
| **هل فيه مشاكل تحتاج صيانة كود الآن؟** | **لا مشاكل كود حرجة مفتوحة تمنع الاستمرار** — المتبقي تشغيلي (بيئة + قرارات) |
| **الحكم** | Staging: **GO مشروط** · Production: **NO-GO** حتى smoke بشري |

---

## 1. هل توجد مشكلات تحتاج صيانة؟

### 1.1 صيانة كود عاجلة (الآن)

| المشكلة | شدة | حالة | إجراء |
|---------|-----|------|--------|
| Bug في مسار النشر نفسه | Critical | **لا يوجد مثبت** | لا تلمس publish |
| أمن P0 (IDOR رفع، LIKE، ACL، محذوفين) | Critical | ✅ محلول | `e24014b` + verify |
| CI lockfile drift / Expo في الجذر / vitest ownership | High | ✅ محلول (Phase 01) | `a20d6fc` |
| Map typecheck (`north/south` vs `max_lat`) | Medium | ✅ محلول | SearchResultsMap |
| Windows `preinstall` يحتاج `sh` | Medium | **معروف — ليس bug منتج** | `pnpm install --ignore-scripts` أو Git Bash / CI |
| confidence-check مع typecheck مزدوج يبطئ/يفشل على Windows أحياناً | Low | **مقبول** | استخدم `--skip-typecheck` بعد `pnpm run typecheck` |
| ضجيج ملفات: `audit/rc1/*.log`, `_*.txt` | Low | **لا ترفعها** | تجاهل / .gitignore |

**الخلاصة:** لا توجد «صيانة استخراج» حرجة مفتوحة في الكود. أي «صيانة» الآن = **تشغيل على staging** وليس كتابة features.

### 1.2 مخاطر تشغيلية (تحتاجك أنت — ليست bugs كود)

| # | الخطر | لماذا يهم | الإجراء |
|---|--------|-----------|--------|
| R1 | غياب smoke حقيقي على staging | قد ينجح الكود ويفشل الربط (Clerk/Storage) | `staging-p0-smoke.mjs` |
| R2 | `upload_claims` على DB الإنتاج/staging | بدون الجدول → 403 عند attach media | `verify-upload-claims-schema.mjs` |
| R3 | OTP / Google / Apple / Push / GPS | تكاملات بيئة Replit/Clerk | ضبط أسرار + اختبار جهاز |
| R4 | EAS غير موقّع / غير مسجّل دخول | لا APK/AAB للمتجر | `eas login` + build preview |
| R5 | CI على GitHub غير مؤكد من هذا الجهاز | `gh` غير مسجّل | افتح Actions أو `gh auth login` |
| R6 | Paymob معطّل عمداً | قرار منتج — ليس عيب | لا تفعّل حتى B5 |

---

## 2. ما الناقص في الخطط؟

### 2.1 اكتمال خطة الصيانة الأولى (MASTER)

| بند الخطة الأولى | الحالة |
|------------------|--------|
| P0 أمان + CI + upload_claims كود | ✅ |
| موجات بحث 1–5 (صناعي، عقارات، taxonomy، near-me، map) | ✅ |
| PH-1 / R1 / B1–B4 (فوترة بدون تفعيل دفع) | ✅ |
| P2 infra (GCP scaffold، ESLint، mobile CI) | ✅ |
| B5 تفعيل Paymob | ❌ **قرار إداري — متعمد مؤجّل** |
| EAS preview يدوي | ❌ **ناقص — عندك** |
| staging-p0-smoke بأسرار حقيقية | ❌ **ناقص — عندك** |
| موقع consumer (P5 / W0–W4) | 📋 **تخطيط فقط** — لم يبدأ بناء `banco-web` |
| مزامنة STATUS_REPORT مع HEAD الحالي | ⚠️ التقرير يذكر أحياناً commits أقدم — يحتاج تحديث دوري |

### 2.2 برنامج 21 مرحلة (production-readiness)

| اكتمل | ناقص |
|--------|--------|
| **01** Core architecture — **pass** | **02–17** مراجعات منهجية pending (DB، API runtime، auth، security audit عميق، admin/dealer/landing، AWS/GCP deploy verify) |
| ركيزتان جاهزتان: API versioning + backward compat | Feature flags / migration rollback / observability / DR / release rollback = **partial** (وثائق موجودة، تشغيل ناقص) |
| Phase 21 started (RC docs) | Phase **18** staging + **19** EAS = **blocked على أسرارك** |
| Playbooks + confidence scripts | تنفيذ smoke + rehearsal rollback على staging |

### 2.3 ثغرات في «تغطية الخطة» نفسها (ليست bugs منتج)

1. **المراحل 02–17** موثّقة كعناوين فقط — لم تُكتب تقارير PHASE-02… مثل PHASE-01.
2. **STATUS_REPORT** و **MASTER plan** يشيران أحياناً لـ commits أقدم من `facd6fc` — تحديث المرجع مطلوب.
3. **لا بوابة واحدة** تربط «موجات الصيانة» + «21 مرحلة» + «ركائز 7» — هذه الوثيقة تعالج ذلك.
4. **Website** مخطط ولم يُثبت قرارات نطاق/استضافة/SSR بعد.
5. **رصد الإنتاج** (Sentry/log shipping) موثّق جزئياً وليس مربوطاً بتشغيل حي.

---

## 3. أين وصلنا؟ (نسبة أهداف)

```
أهداف المنتج + الأمان + البحث + الفوترة (بدون دفع)     ████████████░░░░  ~90%
أهداف الجاهزية التقنية المحلية (typecheck/lint/tests)  ██████████████░░  ~85%
أهداف توثيق الإطلاق (playbooks / RC / pillars)          ████████████░░░░  ~80%
أهداف staging الحقيقي (smoke + DB + device)            ███░░░░░░░░░░░░░  ~25%
أهداف المتجر / إنتاج عام                               █░░░░░░░░░░░░░░░  ~10%
أهداف الموقع consumer                                  ██░░░░░░░░░░░░░░  ~15% (تخطيط)
────────────────────────────────────────────────────
الإطلاق العام الشامل                                    ██████████░░░░░░  ~70–75%
```

**تفسير:** من منظور «الصيانة والبحث والأمان والبناء» أنتم قريبون من الاكتمال.  
من منظور «رفع التطبيق على المتاجر بثقة تشغيلية» لم تكتمل الأهداف بعد — والناقص عند المشغّل لا عند الكود غالباً.

---

## 4. خطة الجاهزية الكاملة (مثل الخطة الأولى) — مسار واحد

### Wave A — إغلاق التشغيلي السابق (P0 بشري) — **الآن**

| # | المهمة | مالك | معيار النجاح |
|---|--------|------|---------------|
| A1 | ضبط `BANCO_API_URL` + `CLERK_BEARER_TOKEN` | أنت | smoke exit 0 |
| A2 | `node scripts/staging-p0-smoke.mjs` | أنت | مسارات رفع/صلاحيات خضراء |
| A3 | `DATABASE_URL` + `verify-upload-claims-schema.mjs` | أنت | PASS على staging DB |
| A4 | تأكيد GitHub Actions أخضر على `facd6fc` | أنت | 4/4 jobs |
| A5 | Publish smoke على جهاز: create → صور → publish → ظهور فيد/بحث | أنت | سجل يدوي في runbook |

**إيقاف:** لا تدفع EAS production قبل A1–A5.

### Wave B — برنامج المراحل 02–11 (صيانة مراجعة) — **تتابع الفريق/الوكيل**

| Phase | التركيز | مخرج | لا تمس |
|------:|---------|------|--------|
| 02 | DB / Drizzle / indexes / upload_claims على staging | `PHASE-02-DATABASE.md` | بيانات إنتاج بدون نافذة |
| 03 | API runtime / health / bootstrap | `PHASE-03-API-RUNTIME.md` | publish handlers إلا ببرهان نكسة |
| 04 | Auth Clerk | `PHASE-04-AUTH.md` | — |
| 05 | Security & ACL مراجعة | `PHASE-05-SECURITY.md` | — |
| 06 | Upload & media | `PHASE-06-MEDIA.md` | خوارزمية ظهور |
| 07 | Search / geo / maps مراجعة بعد موجات 4–5 | `PHASE-07-SEARCH.md` | ranking إلا bug مثبت |
| 08 | Billing/wallet (بدون تفعيل دفع) | `PHASE-08-BILLING.md` | Paymob |
| 09 | Payments structure only | `PHASE-09-PAYMENTS.md` | تفعيل |
| 10–11 | Mobile UX + search perf | تحديث فقط إن وُجدت نكسات | publish |

### Wave C — أسطح الويب 12–14

| Phase | الهدف |
|------:|--------|
| 12 | Admin-os: typecheck/build + رحلة moderation أساسية موثّقة |
| 13 | Dealer-os: رحلة seller listings/leads موثّقة |
| 14 | Landing: تبقى directory؛ لا تبدأ `banco-web` إلا بعد Wave A |

### Wave D — نشر وحدود 15–20

| Phase | الهدف |
|------:|--------|
| 15 | CI/CD: إثبات Actions + توثيق فشل/إعادة |
| 16–17 | AWS/GCP: تحقق scaffold vs readiness فعلي (لا deploy إنتاج هنا) |
| 18 | Staging validation — يعتمد Wave A |
| 19 | EAS preview → ثم production profile بعد اجتياز preview |
| 20 | Observability: webhook حي + checklist DR جزئي |

### Wave E — RC النهائي (Phase 21)

| الحالة بعد Wave A+D | الحكم |
|---------------------|-------|
| A كامل + preview device + CI أخضر | Staging **GO** مؤكد |
| + EAS production secrets + store forms | Production **GO** مشروط بالقرار الإداري |
| بدون Wave A | يبقى **CONDITIONAL / NO-GO prod** |

### Wave F — خارج الإطلاق الحالي (لا يعيق go-live الأساسي)

| بند | ملاحظة |
|-----|--------|
| Website W0–W4 | تخطيط جاهز؛ تنفيذ بعد ثقة staging |
| B5 Paymob | قرار إداري فقط |
| Geo index / sort=nearest / haptics | P2+ مليون مستخدم |
| Feature flags موحّدة `FEATURE_*` | تحسين تشغيلي لاحق |

---

## 5. قائمة تحقق «أهداف اكتملت؟»

### ✅ اكتمل فعلاً

- [x] أمان P0 + upload claims كود
- [x] موجات بحث 1–5 + map/geo parity
- [x] رحلة marketplace lifecycle اختبارات API
- [x] فوترة B1–B4 بدون تفعيل دفع
- [x] Phase 01–17 & 19–20 inspection reports (2026-07-08 freeze wave)
- [x] Expo/EAS config + monorepo Metro (~18/22)
- [x] سبعة ركائز (وثائق) + RC تقارير + OPEN-ITEMS + secrets inventory
- [x] Website separation plan (تخطيط)
- [x] بوابات محلية: typecheck، lint، 23 mobile، confidence
- [x] حماية مسار النشر في نطاق الـdiff الحالي
- [x] Release Freeze entered (engineering)

### ❌ لم يكتمل (يحدد الإطلاق — OPS فقط)

- [ ] Staging P0 smoke بأسرار → `STAGING-REQUIRED-SECRETS.md`
- [ ] Device publish smoke
- [ ] EAS preview build + تثبيت على جهاز
- [ ] إثبات CI أخضر من حسابك على آخر commit
- [ ] درل rollback/DR فعلي على staging
- [ ] أسرار production + store consoles
- [ ] Website build (اختياري — SKIP)
- [ ] Paymob B5 (اختياري — SKIP)

---

## 6. الأولوية المقترحة للأسبوع القادم (بدون تشتيت)

```
اليوم 1–2:  Wave A (أسرار + smoke + upload_claims + Actions)
اليوم 3–4:  EAS preview + device QA (بما فيها publish)
اليوم 5–7:  Phase 02–06 تقارير مراجعة (صافٍ/أدق بدون features)
لاحقاً:     Phase 12–14 ويب · Website W0 · Production EAS عند الموافقة
```

**قاعدة ذهبية:** أي مهمة جديدة ابحث أولاً في §4 من `MASTER-MAINTENANCE-READINESS-PLAN.md` ثم في هذه الوثيقة — إن كانت «عندك» فلا يُعاد كودها كأنها bug.

---

## 7. مصادر الحقيقة (لا تتعارض)

| المصدر | دوره |
|--------|------|
| هذا الملف | **الحالة الكلية + المسار المتبقي** |
| `MASTER-MAINTENANCE-READINESS-PLAN.md` | تاريخ موجات الصيانة 1–5 / B / P |
| `production-readiness/README.md` | فهرس 21 مرحلة |
| `FULL-STRICT-AUDIT-REPORT.md` | نتائج الاختبارات الصارمة |
| `RELEASE-CANDIDATE-FINAL.md` | حكم GO/NO-GO |
| `PHASE-LISTING-PUBLISH-LIFECYCLE.md` | سلامة النشر |
| `STATUS_REPORT.md` | ما تم تسليمه كمنتج (حدّث التاريخ عند الدفع) |

---

## 8. الخلاصة للإدارة

**وصلنا إلى:** منصة جاهزة تقنياً ومنتجياً للإغلاق على **staging**، مع صيانة الموجات مكتملة، ومسار النشر محمياً، وتوثيق الإطلاق شبه كامل.

**لم نصل إلى:** «إطلاق عالمي / متجر» — لأن الأهداف البشرية (أسرار، smoke، EAS، أجهزة) لم تُنفَّذ بعد، وبرنامج 21 مرحلة توقف منهجياً عند 01 مع بداية 21.

**هل الأهداف اكتملت؟**  
- أهداف **الصيانة والإصلاح والبحث**: **نعم تقريباً**.  
- أهداف **الإطلاق العام**: **لا بعد** — أكمل Wave A أولاً.
