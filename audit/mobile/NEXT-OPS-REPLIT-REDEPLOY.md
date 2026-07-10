# NEXT OPS — Redeploy Replit from stabilize branch

**Goal:** Make live API **FRESH** so Device QA / EAS claims are honest.  
**Branch:** `fix/mobile-master-stabilize`  
**Tip commit:** `fe745f3` (pull latest before redeploy)  
**Repo:** `https://github.com/waelzaid66-max/-BANCO-CA-OOM-.git`

Live host (`https://banco-ca-oom.replit.app`) is **STALE** until this branch is what the API runs.

---

## 0) Verify reality (your PC — before Replit)

```powershell
cd C:\Users\waelz\Downloads\BANCO-CA-OOM
pnpm run confidence -- --skip-typecheck          # 14/14 local proofs
node audit/mobile/scripts/pre-redeploy-code-gate.mjs   # static: branch has probe signals
node audit/mobile/scripts/ops-next-step.mjs      # code gate + live probe
```

**Reality check 2026-07-10:**

| Check | Result | Meaning |
|-------|--------|---------|
| Local confidence | PASS | كود الفرع سليم |
| `pre-redeploy-code-gate` | PASS @ `fe745f3` | بعد redeploy يجب أن يمر probe |
| Live `healthz` + `readyz` | PASS | السيرفر شغّال — لكن **كود قديم** |
| Live probe | **STALE** | `EGYPT→200`, map بدون `is_bookable`/`price_display` |
| `CLERK_BEARER_TOKEN` | missing | upload smoke لاحقاً |
| `DATABASE_URL` | missing | schema verify لاحقاً |

---

## 1) Copy-paste on Replit Shell (blocking — do this now)

```bash
git fetch origin
git checkout fix/mobile-master-stabilize
git pull --ff-only origin fix/mobile-master-stabilize
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

**Fail (exit 2):** host still on old build — repeat §1 (confirm `git log -1` shows `fe745f3` or newer on Replit).

---

## 3) After FRESH only

```powershell
$env:BANCO_API_URL = "https://banco-ca-oom.replit.app"
$env:CLERK_BEARER_TOKEN = "<paste Clerk session JWT>"
node scripts/staging-p0-smoke.mjs

$env:DATABASE_URL = "<staging postgres>"
node scripts/verify-upload-claims-schema.mjs

cd artifacts\banco-mobile
eas build --profile preview --platform android
```

Then Device QA: `audit/mobile/DEVICE-QA-SECTION-COMPANIES.md` + ACCEPTANCE.

**Do not** point smoke at a stopped `*.janeway.replit.dev` URL (404 “Run this app…”).

---

## 4) Optional — GitHub PR

https://github.com/waelzaid66-max/-BANCO-CA-OOM-/pull/new/fix/mobile-master-stabilize

Merge into `main` only if Replit tracks `main` instead of direct checkout.

---

## 5) What NOT to do

- Do not claim market/map Device QA green while probe is STALE.
- Do not wait on `banco-web` / website commits — they do not block this path.
- Do not enable Paymob (B5) for this gate.
