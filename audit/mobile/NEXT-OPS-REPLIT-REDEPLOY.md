# NEXT OPS — Redeploy Replit from stabilize branch

**Goal:** Make live API **FRESH** so Device QA / EAS claims are honest.  
**Branch:** `fix/mobile-master-stabilize`  
**Commit (pushed):** `33ae6dd` — `fix(mobile): stabilize M01-M31 search companies + publish gate`  
**Repo:** `https://github.com/waelzaid66-max/-BANCO-CA-OOM-.git`

Live host today (`banco-ca-oom.replit.app`) is **STALE** until this branch is what the API runs.

---

## A) On GitHub (2 minutes)

1. Open PR:  
   https://github.com/waelzaid66-max/-BANCO-CA-OOM-/pull/new/fix/mobile-master-stabilize
2. Merge into the branch Replit deploys from (`main` or your Replit tracking branch).
3. Or, on Replit only: checkout this branch without merging (see B).

---

## B) On Replit Shell (authoritative)

```bash
cd ~/BANCO-CA-OOM   # or your Replit project root
git fetch origin
git checkout fix/mobile-master-stabilize
# OR after merge: git checkout main && git pull

pnpm install --frozen-lockfile

# Additive schema (upload_claims + any pending columns) — safe / no drops
pnpm --filter @workspace/db run push-force

# Restart the API workflow (Stop → Run the api-server workflow)
# Confirm:
curl -sS https://banco-ca-oom.replit.app/api/healthz
```

Secrets that must already exist in Replit Secrets (do not paste into chat):

| Secret | Needed for |
|--------|------------|
| `DATABASE_URL` | boot |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | auth |
| Object Storage | uploads |
| `RESEND_API_KEY` | OTP email (soft) |
| `OPENAI_API_KEY` | assistant (soft) |

---

## C) Prove FRESH (from your PC)

```powershell
cd C:\Users\waelz\Downloads\BANCO-CA-OOM
node audit/mobile/scripts/probe-live-deploy.mjs
```

**Pass (exit 0):**

- `badIsoStatus` ≥ 400 (`market_country=EGYPT` rejected)
- `hasBookable` + `hasPrice` = true on map clusters
- `egEqSa` = false when inventory is tagged by country (if all listings are EG-only, IDs may still match — then check `badIso` + map keys first)

**Fail (exit 2):** host still on old build — repeat B.

---

## D) After FRESH only

```powershell
# Staging smoke (needs your JWT — never commit it)
$env:BANCO_API_URL = "https://banco-ca-oom.replit.app"
$env:CLERK_BEARER_TOKEN = "<paste Clerk session JWT>"
node scripts/staging-p0-smoke.mjs

$env:DATABASE_URL = "<staging postgres>"
node scripts/verify-upload-claims-schema.mjs

cd artifacts/banco-mobile
eas build --profile preview --platform android
```

Then Device QA: `audit/mobile/DEVICE-QA-SECTION-COMPANIES.md` + ACCEPTANCE.

---

## E) What NOT to do

- Do not claim market/map Device QA green while probe is STALE.
- Do not wait on `banco-web` / website commits — they do not block this path.
- Do not enable Paymob (B5) for this gate.
