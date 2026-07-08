# Expo & EAS Production Checklist — BANCO Mobile

**Last updated:** 2026-07-08  
**Scope:** `artifacts/banco-mobile` — Expo SDK 54, EAS Build, store submission readiness  
**Score:** **18 / 22 pass** (4 items need operator secrets or Apple/Google console setup)

---

## How to use

| Symbol | Meaning |
|--------|---------|
| ✅ PASS | Verified in repo or runnable locally without secrets |
| ⚠️ PARTIAL | Config present; needs EAS env / console action |
| ❌ FAIL | Blocker — fix before production build |
| 🔒 SECRET | Requires operator-provided credentials |

Run local gate: `node scripts/production-confidence-check.mjs`

---

## A. SDK & dependencies

| # | Item | Status | Notes |
|---|------|--------|-------|
| A1 | Expo SDK 54 pinned in `banco-mobile/package.json` | ✅ PASS | `expo ~54.0.27`, RN `0.81.5` |
| A2 | `@expo/vector-icons` single version (root override) | ✅ PASS | `15.0.3` exact; guarded by `test:icons` |
| A3 | React 19.1.0 via pnpm catalog (no duplicate) | ✅ PASS | `catalog:` in mobile |
| A4 | `expo-doctor`-style peer alignment | ✅ PASS | `babel-preset-expo ~54`, router `~6.0.24` |
| A5 | `expo-build-properties` META-INF fix | ✅ PASS | OkHttp/jspecify packaging exclude |

---

## B. Config files

| # | Item | Status | Notes |
|---|------|--------|-------|
| B1 | `app.json` identifiers (`com.bancooom.app`) | ✅ PASS | Android package + iOS bundle ID |
| B2 | `app.config.ts` dynamic `expo-router` origin | ✅ PASS | Dev default `https://replit.com/`; prod via `EXPO_PUBLIC_ROUTER_ORIGIN` on EAS |
| B3 | Deep link scheme `bancooom` | ✅ PASS | `app.json` → `scheme` |
| B4 | EAS project linked | ✅ PASS | `extra.eas.projectId` + `owner` |
| B5 | `eas.json` profiles (preview, production) | ✅ PASS | preview APK + production AAB; Node 24.18.0 |
| B6 | Metro monorepo `@workspace/*` resolution | ✅ PASS | `watchFolders` + `disableHierarchicalLookup` |

---

## C. Android

| # | Item | Status | Notes |
|---|------|--------|-------|
| C1 | `targetSdkVersion` / `compileSdkVersion` 35 | ✅ PASS | via `expo-build-properties` |
| C2 | Adaptive icon | ✅ PASS | foreground `icon.png`, bg `#000000` |
| C3 | Camera + location permissions declared | ✅ PASS | Matches expo-image-picker / expo-location |
| C4 | Play signing key | 🔒 SECRET | EAS credentials or upload keystore in Expo dashboard |
| C5 | Production `EXPO_PUBLIC_DOMAIN` baked at build | 🔒 SECRET | EAS production env var |

---

## D. iOS

| # | Item | Status | Notes |
|---|------|--------|-------|
| D1 | Privacy usage strings (photos, location) | ✅ PASS | `infoPlist` + plugin permissions |
| D2 | `ITSAppUsesNonExemptEncryption: false` | ✅ PASS | Standard export compliance |
| D3 | Privacy manifest placeholder | ✅ PASS | `privacyManifests.NSPrivacyAccessedAPITypes` |
| D4 | Sign in with Apple capability | ⚠️ PARTIAL | `usesAppleSignIn: true` in config; **Clerk + Apple Developer Services ID required** |
| D5 | ATS (App Transport Security) | ✅ PASS | Default HTTPS-only; API uses `https://` via `EXPO_PUBLIC_DOMAIN` |
| D6 | Apple distribution cert / provisioning | 🔒 SECRET | EAS + Apple Developer Program |

---

## E. Build & runtime env (EAS)

| # | Item | Status | Notes |
|---|------|--------|-------|
| E1 | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | 🔒 SECRET | Required at build; app throws without it |
| E2 | `EXPO_PUBLIC_DOMAIN` (API host) | 🔒 SECRET | `_layout.tsx` → `setBaseUrl(https://…)` |
| E3 | `EXPO_PUBLIC_CLERK_PROXY_URL` | ⚠️ PARTIAL | Optional; only if multi-domain Clerk |
| E4 | `EXPO_PUBLIC_ROUTER_ORIGIN` (production) | ⚠️ PARTIAL | Set before **production** store build; omit for preview/dev |
| E5 | `EXPO_PUBLIC_PUBLIC_APP_URL` | ⚠️ PARTIAL | Share links `/l/{id}`; optional until web domain live |

---

## F. Publish lifecycle safety

| # | Item | Status | Notes |
|---|------|--------|-------|
| F1 | No Paymob / paid checkout enabled in mobile | ✅ PASS | Billing hub routes only; no payment SDK added |
| F2 | Listing create → upload → publish unchanged | ✅ PASS | No changes to publish API paths this pass |
| F3 | Search / feed / map filters unchanged semantically | ✅ PASS | Performance-only mobile diffs |

---

## G. Verification commands

```powershell
# Local (no secrets)
node scripts/production-confidence-check.mjs

# EAS config dry-run (requires eas login)
cd artifacts/banco-mobile
npx eas build:configure

# Preview APK (needs EAS env vars)
npx eas build --platform android --profile preview
```

---

## Before store submission (operator)

1. Set EAS **production** env: `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_ROUTER_ORIGIN=https://your-domain`.
2. Bump `version` / `versionCode` / `buildNumber` in `app.json`.
3. Run staging smoke + device QA ([STAGING-EAS-DEVICE-RUNBOOK.md](./STAGING-EAS-DEVICE-RUNBOOK.md)).
4. `eas build --profile production` then `eas submit`.

See also: [release/EAS_BUILD.md](../../release/EAS_BUILD.md), [release/STORE_PUBLISHING_GUIDE.md](../../release/STORE_PUBLISHING_GUIDE.md).
