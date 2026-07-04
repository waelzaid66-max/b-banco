# Release Checklist (RC)

## Code / build
- [x] Typecheck 0 across 7 packages
- [x] Backend tests 255 passed / 0 failed (real Postgres)
- [x] CI green (typecheck + build 4 apps + Postgres tests, Linux)
- [x] No TODO/mock/placeholder/dead‑button in mobile
- [x] No broken navigation (every route target has a file)
- [x] i18n complete (AR/EN + RTL; admin 17/17; mobile 1388 t())
- [x] Secret scan clean; no tracked `.env`
- [x] GitHub `boom` and `origin` in sync with local `main`

## Backend deploy
- [ ] `push-force` run (creates reference_* + price_observations)
- [ ] `seed` + `seed:reference` + `backfill:observations` run
- [ ] Secrets set: OPENAI, RESEND, CLERK, PAYMOB, Object Storage
- [ ] Clerk dashboard: Email OTP + Google/Apple enabled
- [ ] Paymob switched to live (when ready)

## Mobile store prep
- [x] App name / package / bundle / EAS project set (`com.bancooom.app`)
- [x] Permissions strings (camera, photos, location, notifications) via plugins
- [x] Icons / splash / logo assets present
- [ ] `expo-router.origin` changed from `replit.com` → production domain
- [ ] iOS `buildNumber` set explicitly
- [ ] Privacy Policy + Terms URLs live (screens exist: `/legal/privacy`, `/legal/terms`)
- [ ] Store listings: screenshots, Data Safety (Android) / App Privacy (iOS)
- [ ] EAS production build (Android app‑bundle / iOS) + device smoke test

## Sign‑off condition (per RC brief)
Release only when every journey works end‑to‑end on a device, no user‑visible half‑feature, no console/runtime error, and this folder is up to date. Code side is ✅; the open boxes above are environment/store actions.
