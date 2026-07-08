# BANCO — حالة مزامنة الريبوهات (نسخة الإنتاج)

**التاريخ:** 2026-07-08 (closure wave)  
**HEAD على `main` (origin):** `08a5256`  
**مرآات GitHub:** `b-banco` / `b.deals` / `B-OOM` — sync to `08a5256` · **`aws-virgen`** — `./scripts/publish-aws-virgen-rc.sh`  
**أداة دفع المرآات:** `scripts/push-mirror-remotes.sh`

**آخر commit إصلاحات (هذه الموجة):** release-freeze — Windows preinstall، Universal Links env، ops secrets loader، 25 اختبار موبايل

---

## أين تقارير التحديثات والتشغيل؟

| التقرير | المسار | المحتوى |
|---------|--------|---------|
| **تسليم للوكيل الأساسي** | `release/PRIMARY_AGENT_HANDOFF.md` | SHA، مرآات، ما يبقى OPS |
| **مزامنة الريبوهات (هذا الملف)** | `REPO_SYNC_STATUS.md` | SHA، الريموتات، نتائج الدفع |
| **اعتماد إنتاج + نشر** | `audit/production-readiness/PRODUCTION-SIGN-OFF-AND-DEPLOYMENT.md` | جاهزية، أمن، امتثال، GO/NO GO |
| **تقرير جاهزية نهائي** | `audit/production-readiness/BANCO-STORE-FINAL-PRODUCTION-READINESS-REPORT.md` | مصفوفة الحالة |
| **مرشح الإصدار** | `audit/production-readiness/RELEASE-CANDIDATE-FINAL.md` | قرار التجميد |
| **تشغيل EAS + جهاز** | `audit/production-readiness/STAGING-EAS-DEVICE-RUNBOOK.md` | أوامر PowerShell |
| **بناء EAS** | `release/EAS_BUILD.md` | متغيرات `EXPO_PUBLIC_*` |
| **صيانة رئيسي** | `audit/maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md` | موجات الصيانة |
| **فحص محلي بدون أسرار** | `node scripts/production-confidence-check.mjs` | 12/12 بوابات |

---

## الريموتات

| الاسم | GitHub URL | دور | `main` @ |
|-------|------------|-----|----------|
| **origin** | `waelzaid66-max/-BANCO-CA-OOM-` | مصدر العمل | `08a5256` ✅ |
| **bbanco** | `waelzaid66-max/b-banco` | مرآة | sync → `08a5256` |
| **bdeals** | `waelzaid66-max/b.deals` | deploy أصلي | sync → `08a5256` |
| **boom** | `waelzaid66-max/B-OOM` | B-OOM | sync → `08a5256` |
| **aws-virgen** | `waelzaid66-max/aws-virgen` | AWS EC2/CD | `./scripts/publish-aws-virgen-rc.sh` |
| **upstream** (محلي) | `banco stor app/banco.store-main` | نسخة محلية | يدوي |

> لا يوجد فرع `aws-virgen-main`.

---

## اختبارات Full Production Validation (موجة واحدة — 2026-07-08)

| البوابة | النتيجة |
|---------|---------|
| `production-confidence-check.mjs` | **12/12 PASS** |
| `pnpm run typecheck` | **PASS** |
| `pnpm run lint` | **PASS** |
| `banco-mobile build` | **PASS** |
| `banco-mobile test` | **PASS (25)** |
| `staging-p0-smoke.mjs` | **FAIL** — API غير شغّال + لا JWT |
| `verify-upload-claims-schema.mjs` | **FAIL** — DNS DB |
| EAS `whoami` | **PASS** |
| EAS preview Android | **IN PROGRESS** `2b030ca4-b001-43a5-9723-00128f471d07` |

---

## قرار الإصدار

| النطاق | الحكم |
|--------|--------|
| كود + بوابات محلية | **GO WITH FIXES** |
| Staging | **NO GO** |
| متاجر / إنتاج عالمي | **NO GO** |

---

*يُحدَّث بعد كل دفع إنتاج.*
