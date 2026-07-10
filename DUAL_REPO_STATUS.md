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

| الريبو | الفرع | Tag |
|--------|--------|-----|
| **-BANCO-CA-OOM-** | `main` ← merge من `fix/mobile-master-stabilize` | `v1.1.0-stabilize-2026-07-10` @ `7822215` |
| **aws-virgen** | `main` (merge من الأساسي) | `v1.1.0-stabilize-2026-07-10` @ `99c486b` ✅ |

```bash
git fetch origin main && git rev-parse origin/main
node audit/mobile/scripts/ops-next-step.mjs   # LIVE FRESH متوقع
```

---

## التحقق المحلي (2026-07-10)

| المصدر | النتيجة |
|--------|---------|
| production-confidence | ✅ 19/19 |
| lib-hardening | ✅ 34/34 |
| pre-redeploy-code-gate | ✅ PASS |
| Live probe (Replit) | ✅ **FRESH** |
| Device QA | ❌ OPEN |
| staging-p0-smoke | ⚠️ يحتاج `CLERK_BEARER_TOKEN` |

---

## aws-virgen — مزامنة

```bash
export AWS_VIRGEN_SYNC_TOKEN="<PAT classic repo scope>"
./scripts/publish-aws-virgen-rc.sh v1.1.0-stabilize-2026-07-10
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
