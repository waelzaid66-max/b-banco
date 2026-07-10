# Honest inventory — 2026-07-10

Rules applied: no fake “all green”, no deleted account/section journeys, no wrong duplicate options, mobile strength preserved.

## Layers (truth)

| Layer | Truth |
|-------|--------|
| Local branch code (M01–M31 + waves 6–10C) | Present in workspace |
| Automated tests offline | **PASS** — lib-hardening **57/57**, search-contract **37**, production-confidence **17/17** (--skip-typecheck) |
| Live Replit wave 6 | **FRESH** — ISO reject + map `is_bookable`/`price_display` |
| Live Replit wave 8 | **STALE** — `seller.social_links` not on live JSON |
| Real-device DoD | **OPEN** until redeploy wave 8 + Expo/device QA |
| OPS O16 | **OPEN** (secrets / EAS / staging upload smoke) |

Proof artifact: `audit/mobile/live-probes/2026-07-10-full-deploy-proof.json`

## Account / section journeys — still present

| Surface | Status | Notes |
|---------|--------|-------|
| Roles: `individual` / `dealer` / `company` | Intact | `enterprise` admin-only |
| Business activities (developer, car_dealer, …) | Intact | Not roles; hub routes remain |
| `host` booking / `bank` RFQ axes | Intact | Not removed by stabilize |
| Create categories + rent / import / supply | Intact | CTAs + engines remain |
| Discover → supply hub + car import CTA | Intact | Journey entry, not wrong duplicate |
| Profile business menu | Intact | M17 + wave 9 overflow (saved, notifications) |

## Wave 9 product (local code)

| Item | Status |
|------|--------|
| Search: sale vs buy chips | ✅ `listing_mode` contract |
| B = Potential (not heart primary) | ✅ `BReactionButton` |
| Profile ⋮ vs camera corners | ✅ RTL-aware |
| Messenger send + viewer close RTL | ✅ |
| Create listing geocode label | ✅ after GPS |

**Deferred (not blockers):** map inside LocationPicker · per-hub maps · near-me web · persistent Potential state

## Wave 10C (local code, `9818ac0`)

| Item | Status |
|------|--------|
| Edit listing media (add/reorder/remove) | ✅ `ListingMediaEditor` + PATCH `media[]` |
| Draft resume with promoted upload URLs | ✅ `promotedMedia` in `listingDraft.ts` |
| Live Replit + device QA for edit media | ⏳ OPEN |

## Safe next (only if it improves)

1. Redeploy Replit from `origin/main` @ `9818ac0` → wave 8+10C FRESH.
2. `node audit/mobile/scripts/post-redeploy-verify.mjs` → exit 0.
3. `CLERK_BEARER_TOKEN` → `staging-p0-smoke.mjs`.
4. EAS preview + `DEVICE-QA-SECTION-COMPANIES.md`.
5. Do **not** strip import/supply/rent/business paths for “cleanup aesthetics”.
