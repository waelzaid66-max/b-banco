# Mobile — real device build (EAS)

**Why:** Expo Go over the Replit tunnel cannot reach Metro ("Could not connect to
development server"), and Replit has no iOS Simulator. The only way to run the
real app on a phone is a **standalone build (EAS)** — it bundles the JS and talks
to the **production API**, with no Replit/Metro dependency.

## Build profiles (`artifacts/banco-mobile/eas.json`)
- `preview` — installable **APK**, uses the production environment. Use this to
  test the real app on your Android phone.
- `development` — dev‑client APK (hot reload on device).
- `production` — Play Store **app‑bundle** (final release).

## One‑time: set the build‑time env vars (baked into the app)
The app reads these `EXPO_PUBLIC_*` vars at build time (see `app/_layout.tsx`):

| Var | What | Required |
|---|---|---|
| `EXPO_PUBLIC_DOMAIN` | production API host, e.g. `api.banco.app` (the app calls `https://<domain>/api/...`) | ✅ |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | ✅ |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | Clerk proxy (only if used) | optional |
| `EXPO_PUBLIC_PUBLIC_APP_URL` | canonical web URL for share links | optional |
| `EXPO_PUBLIC_ROUTER_ORIGIN` | deep-link origin for expo-router (production store builds only) | prod store |

Set them in the EAS **production** environment (dashboard → Project → Environment
variables, scope = production), or via CLI:
```bash
cd artifacts/banco-mobile
eas env:create --environment production --name EXPO_PUBLIC_DOMAIN --value api.YOURDOMAIN
eas env:create --environment production --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_live_...
```

`eas.json` profiles:
- `preview` — internal APK (Android) + iOS device build; uses production env vars.
- `production` — Play **app-bundle** + iOS with `autoIncrement` on build number.
- `app.json` — `android.versionCode`, `ios.buildNumber` (local source; EAS `appVersionSource: local`).

## Build + install
```bash
cd artifacts/banco-mobile
npx eas login                                             # once
npx eas build --platform android --profile preview        # → produces an APK URL
```
Open the APK URL on your phone → install → the app runs against the production API
(real data, real auth). For iOS, `--platform ios` needs an Apple Developer account.

## Before store submission
- Set `EXPO_PUBLIC_ROUTER_ORIGIN` in the EAS **production** environment to your
  canonical web domain (e.g. `https://banco.app`). Dev/preview builds omit it —
  `app.config.ts` defaults to `https://replit.com/` so local Expo Go is unchanged.
- Bump `versionCode` (Android) / set `buildNumber` (iOS) per release.
- Backend secrets live server‑side (Replit): `OPENAI_API_KEY` (real `sk-...`),
  `RESEND_API_KEY`, Object Storage; Clerk dashboard: OTP + Google/Apple.
  **Paymob remains disabled** until explicitly approved.
