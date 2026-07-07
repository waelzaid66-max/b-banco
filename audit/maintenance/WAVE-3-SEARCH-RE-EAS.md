# Maintenance Wave 3 — Real estate search + route unification + EAS

**Date:** 2026-07-07  
**Builds on:** Wave 1 (upload/CI/health/EAS metadata), Wave 2 (industrial search)

## Changes

| Area | Fix | Files |
|------|-----|-------|
| Real-estate rent | Inline rental-system chips when rent (not sale) — same rules as FilterSheet | `app/(tabs)/search.tsx` |
| Real-estate types | Facet-gated `land` + `hotel` engine chips (inventory-backed only) | `constants/engines.ts`, `i18n.ts` |
| Engine hygiene | Selecting تمليك (sale) clears `rentalTerm` | `app/(tabs)/search.tsx` |
| Deep links | `search-results` → `/(tabs)/search` redirect (single search surface) | `app/search-results.tsx` |
| Nav params | Search tab accepts `engine` from assistant / legacy routes | `app/(tabs)/search.tsx` |
| EAS preview | Explicit iOS block on preview profile | `eas.json` |

## EAS build checklist (manual)

```bash
cd artifacts/banco-mobile
eas env:create --environment production --name EXPO_PUBLIC_DOMAIN --value api.YOURDOMAIN
eas env:create --environment production --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_live_...
eas build --platform android --profile preview    # APK smoke test
eas build --platform all --profile production     # store-bound (AAB + iOS)
```

Before store: bump `version` / `versionCode` / `buildNumber`; change `expo-router` `origin` only when production domain is approved.

## Deferred (product decision)

- `near_lat` / `radius_km` on mobile (API ready; needs OpenAPI + UX for "near me" on Search).
- Listing edit screen (not in current maintenance scope).
