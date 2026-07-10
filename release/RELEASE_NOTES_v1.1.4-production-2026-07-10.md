# Release Notes — v1.1.4-production-2026-07-10

**Date:** 2026-07-10  
**Branch:** `main`  
**Scope:** Production snapshot — mobile stabilize waves 6–10C + deploy tooling

## Highlights

- **Wave 10C:** Edit listing media (upload/reorder/remove) via PATCH `media[]`
- **Wave 10C:** Listing draft persists `promotedMedia` after verified uploads
- **Wave 10A:** Safe feed thumbnails · home boot stability · assistant routes · push invalidation
- **Wave 8:** `seller.social_links` on listing detail (API + mobile)
- **Wave 6:** Market country ISO · map bookable/price · section isolation
- **Fix:** `ListingMediaEditor` TypeScript — narrow to `uploaded` state in `buildMediaPayload`
- **Ops:** `replit-redeploy-watch.mjs` · `REPLIT-SHELL-COPYPASTE.sh` · updated sync manifest

## Verification

| Gate | Result |
|------|--------|
| production-confidence | **19/19** |
| ops:full-verify | 17/17 + 57/57 + 37/37 |
| Live Replit | PARTIAL — redeploy required for wave 8 |

## Deploy

1. Replit: `bash audit/mobile/REPLIT-SHELL-COPYPASTE.sh` → `pnpm run ops:redeploy-watch`
2. aws-virgen: `./scripts/publish-aws-virgen-rc.sh v1.1.4-production-2026-07-10`
3. EAS: `eas build --profile preview` after Live FRESH

See `release/PRODUCTION-FULL-SNAPSHOT-2026-07-10.md`.
