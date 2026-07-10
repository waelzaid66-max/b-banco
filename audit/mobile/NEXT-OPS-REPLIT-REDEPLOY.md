# NEXT OPS — Redeploy Replit from stabilize branch

**Goal:** Make live API **FRESH** so Device QA / EAS claims are honest.  
**Branch:** `main` @ Wave 10C (بعد `b2926a5`)  
**Tip commit:** Wave 10C — edit media PATCH + draft promotedMedia  
**Repo:** `https://github.com/waelzaid66-max/-BANCO-CA-OOM-.git`

**2026-07-10:** المضيف الحي **FRESH لموجة 6** (ISO + خريطة) لكن **STALE لموجة 8** — حقل `seller.social_links` غير موجود في JSON الحي. أعد النشر من `origin/main`.

---

## 0) Verify reality (your PC — before Replit)

```powershell
cd C:\Users\waelz\Downloads\BANCO-CA-OOM
pnpm run confidence -- --skip-typecheck          # 16/16 local proofs
node audit/mobile/scripts/pre-redeploy-code-gate.mjs   # static: branch has probe signals
node audit/mobile/scripts/ops-next-step.mjs      # code gate + live probe
```

**Reality check 2026-07-10:**

| Check | Result | Meaning |
|-------|--------|---------|
| Local confidence | PASS | كود الفرع سليم |
| `pre-redeploy-code-gate` | PASS @ `f8273d0` | بعد redeploy يجب أن يمر probe |
| Live `healthz` + `readyz` | PASS | السيرفر شغّال |
| Live probe (موجة 6) | **FRESH** | `EGYPT→400`, map فيه `is_bookable`/`price_display` |
| probe-wave8-seller-social | **STALE** | `seller` بلا `social_links` — أعد النشر من `main` |
| `CLERK_BEARER_TOKEN` | missing | upload smoke لاحقاً |
| `DATABASE_URL` | missing | schema verify لاحقاً |

---

## 1) Copy-paste on Replit Shell (blocking — do this now)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force
```

Then in Replit UI: **Stop** the `api-server` workflow → **Run** it again.

Confirm process up:
```bash
curl -sS https://banco-ca-oom.replit.app/api/healthz
curl -sS https://banco-ca-oom.replit.app/api/readyz
```

---

## 2) Prove FRESH (from your PC)

```powershell
node audit/mobile/scripts/post-redeploy-verify.mjs
```

**Pass (exit 0):**

- `badIsoStatus` ≥ 400 (`market_country=EGYPT` rejected)
- `hasBookable` + `hasPrice` = true on map clusters
- healthz/readyz smoke on the same host

**Note:** `egEqSa` may stay true if all live cars are EG-only — that alone is not STALE after core signals pass.

**Fail (exit 2):** host still on old build — repeat §1 (confirm `git log -1` shows `8ba704e` or newer on Replit).

---

## 3) After FRESH only

```powershell
pnpm run ops:wave-b
# أو يدوياً:
$env:BANCO_API_URL = "https://banco-ca-oom.replit.app"
node scripts/staging-p0-smoke.mjs
node scripts/run-with-local-secrets.mjs node scripts/verify-upload-claims-schema.mjs

cd artifacts\banco-mobile
eas build --profile preview --platform android
```

Then Device QA: `audit/mobile/DEVICE-QA-SECTION-COMPANIES.md` + ACCEPTANCE.

**Do not** point smoke at a stopped `*.janeway.replit.dev` URL (404 “Run this app…”).

---

## 4) GitHub

`fix/mobile-master-stabilize` merged into `main`. Replit must track **`main`** only.

---

## 5) What NOT to do

- Do not claim market/map Device QA green while probe is STALE.
- Do not wait on `banco-web` / website commits — they do not block this path.
- Do not enable Paymob (B5) for this gate.
