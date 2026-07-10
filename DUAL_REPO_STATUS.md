# حالة الريبوهين الرسميين — مصدر الحقيقة

**آخر تحديث:** 2026-07-10  
**النطاق:** ريبوهان فقط — لا مرآات ولا ريبوهات أخرى.

| الريبو | الرابط | الدور |
|--------|--------|-------|
| **أساسي** | https://github.com/waelzaid66-max/-BANCO-CA-OOM- | كود + CI + تقارير + GCP + Replit |
| **AWS** | https://github.com/waelzaid66-max/aws-virgen | نشر EC2/Elastic Beanstalk (نسخة مطابقة للأساسي) |

**مرجع التجربة الكاملة:** `release/FULL-STABLE-SNAPSHOT-2026-07-10.md`

---

## SHA والوسم المستهدف

| الريبو | الفرع | Tag | SHA |
|--------|--------|-----|-----|
| **-BANCO-CA-OOM-** | `main` | `v1.1.1-product-truth-2026-07-10` | `1aecea5` |
| **aws-virgen** | `main` | `v1.1.1-product-truth-2026-07-10` | `f9acaf7` ✅ |

```bash
git fetch origin main && git rev-parse origin/main   # 1aecea5
node audit/mobile/scripts/ops-next-step.mjs          # LIVE FRESH
```

---

## التحقق المحلي (2026-07-10 — موجة 6)

| المصدر | النتيجة |
|--------|---------|
| production-confidence | ✅ **19/19** |
| lib-hardening | ✅ **36/36** (بروفايل: روابط ≠ هاتف) |
| pre-redeploy-code-gate | ✅ PASS @ `1aecea5` |
| post-redeploy-verify | ✅ **FRESH** |
| Live probe (Replit) | ✅ **FRESH** — `badIsoStatus=400`, map `is_bookable` + `price_display`, EG≠SA |
| Device QA | ❌ OPEN |
| staging-p0-smoke (upload) | ⚠️ يحتاج `CLERK_BEARER_TOKEN` |

---

## aws-virgen — مزامنة

```bash
export AWS_VIRGEN_SYNC_TOKEN="<PAT classic repo scope>"
./scripts/publish-aws-virgen-rc.sh v1.1.1-product-truth-2026-07-10
```

أو PowerShell:

```powershell
$env:AWS_VIRGEN_SYNC_TOKEN = "<PAT>"
.\scripts\publish-aws-virgen-rc.ps1 v1.1.1-product-truth-2026-07-10
```

أو: Actions → **Sync aws-virgen (full main)** (سر `AWS_VIRGEN_SYNC_TOKEN`).

```bash
git ls-remote https://github.com/waelzaid66-max/aws-virgen.git refs/heads/main
git ls-remote https://github.com/waelzaid66-max/aws-virgen.git refs/tags/v1.1.0-stabilize-2026-07-10
```

---

## ملاحظات

- `cursor[bot]` قد يفشل push إلى `aws-virgen` (403) — نفّذ السكربت بحساب المالك.
- GitHub Actions billing قد يعطل CI (Run #50) — لا يعني فشل الكود.
- أسرار التشغيل في `.secrets/local.env` فقط — انظر `scripts/local.env.example`.
