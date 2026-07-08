# Staging → EAS → Device QA Runbook

**Last updated:** 2026-07-08  
**Order:** staging smoke → upload_claims verify → EAS preview → device QA → production build

---

## 1. Environment variables

### Staging API smoke (`scripts/staging-p0-smoke.mjs`)

| Variable | Required | Description |
|----------|----------|-------------|
| `BANCO_API_URL` | ✅ | Staging API origin, e.g. `https://api-staging.example.com` |
| `CLERK_BEARER_TOKEN` | For steps 3–8 | Primary user session JWT |
| `CLERK_BEARER_TOKEN_OTHER` | Optional | Second user JWT (IDOR step 7) |

### DB schema verify (`scripts/verify-upload-claims-schema.mjs`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Staging/prod Postgres connection string |

### EAS build-time (Expo dashboard → Project → Environment → **production**)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_DOMAIN` | ✅ | API host only (no scheme), e.g. `api.example.com` |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk publishable key (`pk_live_…` or staging) |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | Optional | Clerk proxy for multi-domain |
| `EXPO_PUBLIC_ROUTER_ORIGIN` | Production store builds | Canonical web origin, e.g. `https://banco.app` |
| `EXPO_PUBLIC_PUBLIC_APP_URL` | Optional | Share link base for `/l/{id}` |

### API server (staging/production — not in mobile bundle)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `CLERK_SECRET_KEY` | Auth |
| `OBJECT_STORAGE_*` / Replit storage | Upload byte path |
| `RESEND_API_KEY` | OTP email |
| `OPENAI_API_KEY` | AI assistant |
| `ERROR_ALERT_WEBHOOK` | Ops alerts |

**Not enabled:** `PAYMOB_*` — paid checkout remains off per release policy.

---

## 2. Step-by-step (Windows PowerShell)

### Step 0 — Local confidence (no secrets)

```powershell
cd C:\Users\waelz\Downloads\BANCO-CA-OOM
node scripts/production-confidence-check.mjs
```

Expected: libs + mobile typecheck, 23 mobile tests, eas/app config checks pass.

### Step 1 — Staging smoke

```powershell
$env:BANCO_API_URL = "https://YOUR-STAGING-API.example.com"
$env:CLERK_BEARER_TOKEN = "eyJ..."   # from Clerk session / devtools
# optional:
$env:CLERK_BEARER_TOKEN_OTHER = "eyJ..."

node scripts/staging-p0-smoke.mjs
```

Exit `0` = health + upload path OK. Exit `2` = missing URL. Exit `1` = failed step.

### Step 2 — upload_claims schema

```powershell
$env:DATABASE_URL = "postgresql://user:pass@host:5432/db"
node scripts/verify-upload-claims-schema.mjs
```

Or push schema:

```powershell
pnpm --filter @workspace/db run push-force
```

### Step 3 — EAS preview build (real device)

```powershell
cd artifacts\banco-mobile
npx eas login
# Set production env vars in Expo dashboard first (see table above)

npx eas build --platform android --profile preview
# iOS (needs Apple Developer):
# npx eas build --platform ios --profile preview
```

Install APK from EAS build URL on physical device.

### Step 4 — Device QA checklist

Run on **preview** build against staging or production API (match `EXPO_PUBLIC_DOMAIN`).

#### Auth & account
- [ ] Email OTP sign-in delivers code (needs `RESEND_API_KEY` on API)
- [ ] Google Sign-In (Clerk OAuth configured)
- [ ] Apple Sign-In (Clerk + Apple Services ID; iOS only)
- [ ] Sign out / session restore

#### Listings & publish lifecycle (do not skip)
- [ ] Create listing with **camera** photo + **gallery** photo
- [ ] Save draft → resume draft
- [ ] **Publish** listing
- [ ] Listing appears in **home feed**
- [ ] Listing appears in **search** (text + filters)
- [ ] Open listing detail from feed and search
- [ ] Edit listing → changes visible
- [ ] Bump / archive / republish (if applicable to account)

#### Uploads & media
- [ ] Profile avatar upload
- [ ] Chat image attachment
- [ ] Business verification document upload

#### Location & maps
- [ ] “Use my location” on create listing (GPS permission)
- [ ] Search map loads clusters; pan/zoom fetches viewport clusters
- [ ] Tap pin → listing detail

#### Messaging & notifications
- [ ] Send message from listing
- [ ] Push notification received (Expo push token + API configured)
- [ ] Notification tap deep-links to correct screen

#### Billing (read-only — no Paymob)
- [ ] Profile → Payments → Billing hub loads
- [ ] Invoices list / PDF download (if invoices exist)
- [ ] **No** live payment capture

#### Settings & stability
- [ ] Language toggle AR ↔ EN
- [ ] Settings deep links open correct screens
- [ ] No crash on cold start ×3
- [ ] Offline / airplane mode shows graceful error (not white screen)

### Step 5 — Production build (after QA pass)

```powershell
cd artifacts\banco-mobile
# Ensure EXPO_PUBLIC_ROUTER_ORIGIN set in EAS production env
npx eas build --platform android --profile production
npx eas submit --platform android
```

---

## 3. Exit codes reference

| Script | Code | Meaning |
|--------|------|---------|
| `staging-p0-smoke.mjs` | 0 | Pass |
| | 1 | Step failure |
| | 2 | Missing `BANCO_API_URL` |
| `verify-upload-claims-schema.mjs` | 0 | Schema OK |
| | 1 | Missing table/column/index |
| | 2 | Missing `DATABASE_URL` |
| `production-confidence-check.mjs` | 0 | All local checks pass |
| | 1 | Check failure |
| | 2 | Repo layout invalid |

---

## 4. What automation cannot do (needs you)

| Item | Why |
|------|-----|
| Clerk JWT for smoke | Session-specific; copy from signed-in client |
| EAS env vars | Stored in Expo dashboard / `eas env:create` |
| OTP / Google / Apple on device | Clerk + Resend + OAuth console config |
| Push notifications | FCM/APNs credentials in EAS + API |
| Object storage byte path | Cloud/Replit storage credentials on API |
| Store submission | Play Console / App Store Connect accounts |

---

## Related

- [EXPO-EAS-PRODUCTION-CHECKLIST.md](./EXPO-EAS-PRODUCTION-CHECKLIST.md)
- [WAVE-P0-STAGING-VALIDATION.md](../maintenance/WAVE-P0-STAGING-VALIDATION.md)
- [release/EAS_BUILD.md](../../release/EAS_BUILD.md)
