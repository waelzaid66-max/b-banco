# حالة الريبوهين الرسميين — مصدر الحقيقة

**آخر تحديث:** 2026-07-09  
**النطاق:** ريبوهان فقط — لا مرآات ولا ريبوهات أخرى.

| الريبو | الرابط | الدور |
|--------|--------|-------|
| **أساسي** | https://github.com/waelzaid66-max/-BANCO-CA-OOM- | كود + CI + تقارير + GCP + Replit |
| **AWS** | https://github.com/waelzaid66-max/aws-virgen | نشر EC2/Elastic Beanstalk (نسخة مطابقة للأساسي) |

---

## SHA المعتمد

| الريبو | `main` | Tag |
|--------|--------|-----|
| **-BANCO-CA-OOM-** | `69fc26d` (وثائق فقط؛ الكود المُختبَر @ `3a95afa`) | `v1.0.0-rc.2` |
| **aws-virgen** | `39b1e63` (merge من الأساسي @ `3a95afa`) | `v1.0.0-rc.2` ✅ |

```bash
git fetch origin main && git rev-parse origin/main
# يجب: 3a95afa (أو أحدث بعد هذا الملف)
```

---

## GitHub Actions CI — الأساسي (حقيقي من API)

### ⚠️ حاجز تشغيل (ليس عيب كود)

**Run #50** @ `69fc26d` — ❌ فشل خلال 4 ثوانٍ — **كل الـ jobs:**

> *The job was not started because your account is locked due to a billing issue.*

**الإجراء المطلوب من المالك:** [GitHub Billing](https://github.com/settings/billing) — سداد/تحديث طريقة الدفع ثم إعادة تشغيل Workflow أو دفع commit جديد.

### آخر تشغيل ناجح على `main` (كود مُختبَر)

Run **#49** @ `3a95afa` — ✅ **success** (5/5 jobs)

| Job | الحالة |
|-----|--------|
| Typecheck & build | ✅ |
| API tests (Postgres) | ✅ |
| ESLint (scripts) | ✅ |
| GCP config gate | ✅ |
| Mobile regression (static) | ✅ |

**رابط #49 (أخضر):** https://github.com/waelzaid66-max/-BANCO-CA-OOM-/actions/runs/28979326703  
**رابط #50 (فوترة):** https://github.com/waelzaid66-max/-BANCO-CA-OOM-/actions/runs/29000838045

### آخر فشل **كود** (قديم — مُصلَح)

| Run | SHA | السبب |
|-----|-----|--------|
| #40 | `38de1c0` | `pnpm-lock.yaml` ناقص `globals` بعد merge PR #2 |
| **الإصلاح** | `eff3471`+ | sync lockfile + PR #5 GCP/handoff |

> إذا رأيت ❌ أحمر: تحقق من **سبب الفشل** في Annotations — فوترة GitHub ≠ أخطاء ESLint/Tests. آخر فشل **كود** كان Run #40 (lockfile).

---

## حالة التحقق الحالية (2026-07-09)

| المصدر | النتيجة |
|--------|---------|
| CI Run #49 @ `3a95afa` | ✅ 5/5 |
| محلي: lint + typecheck | ✅ |
| محلي: production-confidence | ✅ 13/13 |
| محلي: GCP gate | ✅ |
| aws-virgen `main` | ✅ `39b1e63` + tag `v1.0.0-rc.2` |
| CI Run #50 @ `69fc26d` | ⛔ GitHub billing — unblock مطلوب |

---

## فحص محلي (Windows — بدون Postgres)

| البوابة | الأمر | النتيجة المتوقعة |
|---------|--------|------------------|
| Lockfile | `pnpm install --frozen-lockfile` | PASS |
| Lint | `pnpm run lint` | PASS |
| Typecheck | `pnpm run typecheck` | PASS |
| Confidence | `node scripts/production-confidence-check.mjs` | 13/13 PASS |
| GCP gate | `node scripts/verify-gcp-docker-build-config.mjs` | PASS |
| Mobile static | `pnpm --filter @workspace/banco-mobile run test:icons/lib/resilience` | PASS |
| API tests | `pnpm --filter @workspace/api-server test` | يتطلب Postgres (يعمل على CI/Linux) |

---

## Replit — تشغيل

```bash
git pull origin main
pnpm install --frozen-lockfile
PORT=$PORT DATABASE_URL=$DATABASE_URL pnpm --filter @workspace/api-server run dev
./turbo.sh check
```

**مرجع كامل:** `release/REPLIT_GOOGLE_AWS_UNIFIED_RUNBOOK.md` · `replit.md`

---

## Google Cloud Platform — نشر

| الملف | الغرض |
|-------|--------|
| `deploy/gcp/reports/00-README.md` | ترتيب القراءة |
| `deploy/gcp/reports/01-GCP_HOSTING_REQUIREMENTS.md` | متطلبات Cloud Run/Build/SQL |
| `deploy/gcp/reports/06-READINESS_CHECKLIST_GONOGO.md` | Go/No-Go |
| `deploy/gcp/TRIGGER_MIGRATION.md` | إصلاح Cloud Build exit 125 |
| `deploy/gcp/cloudbuild.deploy.yaml` | build + deploy |
| `deploy/gcp/env/SECRET_MANAGER_MAPPING.md` | أسماء الأسرار |

**Dockerfile للـ Console:** `Dockerfile` (جذر الريبو) · **سياق البناء:** `.` (جذر الريبو)

---

## aws-virgen — مزامنة

```bash
export AWS_VIRGEN_SYNC_TOKEN="$(gh auth token)"   # PAT بصلاحية repo
./scripts/publish-aws-virgen-rc.sh v1.0.0-rc.2
```

أو: Actions → **Sync aws-virgen (full main)** (سر `AWS_VIRGEN_SYNC_TOKEN`).

**التحقق:**

```bash
git ls-remote https://github.com/waelzaid66-max/aws-virgen.git refs/heads/main
git ls-remote https://github.com/waelzaid66-max/aws-virgen.git refs/tags/v1.0.0-rc.2
```

---

## تقارير للمطورين والوكلاء

| التقرير | المسار |
|---------|--------|
| تسليم الوكيل | `release/PRIMARY_AGENT_HANDOFF.md` |
| Replit + GCP + AWS | `release/REPLIT_GOOGLE_AWS_UNIFIED_RUNBOOK.md` |
| جاهزية إنتاج | `audit/production-readiness/BANCO-STORE-FINAL-PRODUCTION-READINESS-REPORT.md` |
| AWS نشر | `deploy/aws/reports/00-README.md` |
| GCP نشر | `deploy/gcp/reports/00-README.md` |
| Expo/EAS | `release/EAS_BUILD.md` |
| Docker/GCP verify | `scripts/verify-gcp-docker-build-config.mjs` |

---

*هذا الملف هو المرجع الوحيد لحالة الريبوهين — لا تستخدم مرآات `b-banco` / `b.deals` / `B-OOM`.*
