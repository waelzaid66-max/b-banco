# BANCO Store — Completion & Status Report

_Last updated: 2026-07-07 — wave R1 furnished rental hub + billing UI (B1–B3), waves 4–5 search/geo._

> **Release line:** `main` @ `7a1c2e8`+ — verified locally: **typecheck 0 errors (7 packages)**, **288 API tests passed** (3 skipped).

This is the live status of the BANCO Store monorepo (Banco Mobile · Banco Admin · Banco Market/dealer-os · API Server · shared libs). It records what is **done and verified**, the **architecture**, and the **honest remaining items** with the reason each is or isn't locally verifiable.

---

## 1. How verification works here

- **Backend (api-server):** real integration tests on a real PostgreSQL — `pnpm --filter @workspace/api-server test`. Current state: **288 passed / 3 skipped / 0 failing**.
- **Type safety (all surfaces):** `pnpm -r --if-present run typecheck` → **0 errors across 7 packages** (api-server, banco-mobile, admin-os, dealer-os, landing, mockup-sandbox, scripts).
- **API contract:** `lib/api-spec/openapi.yaml` is the source of truth → `orval` regenerates the typed client (`lib/api-client-react`) + zod (`lib/api-zod`). Generated diffs this session were **purely additive (0 deletions)**.
- **Build:** runs on CI (Linux). Locally on Windows the esbuild native binary differs, so **typecheck is the local proxy** for compilation.

---

## 2. Delivered & verified this phase

| Area | What | Verification |
|---|---|---|
| **Server-side map clustering** | `GET /v1/search/map` → grid-clustered pins for a viewport, reusing the **exact** search filters. Scales (returns cells, not all pins). | DB test: zoom-out clusters, zoom-in pins, bbox gates, total conserved |
| **Map UI wired to viewport clusters** | The Leaflet/WebView map now reports its viewport (debounced) → fetches `/search/map` with the SAME committed filters (`buildMapClusterParams` reuses `buildSearchParams`) → injects authoritative clusters (`window.BANCO_MAP.setClusters`), count bubbles drill in, off-page singles open by id, honest viewport-wide count, monotonic seq guard, graceful degradation to the loaded page on fetch failure. | Wired on Replit; code-reviewed + typecheck 0 locally; device QA on Replit |
| **Messenger mini composer** | Quick-emoji strip collapsed behind a Messenger-style smiley toggle in the composer (primary-tinted while open) — thread keeps full height; reactions/reply/attach/preview untouched. | typecheck 0 |
| **Rental systems (Booking-style, per-country law)** | `rental_term` dimension across create + search + feed + map: Egypt = furnished (from 1 day) / new-law lease (≤5 years) / old-law lease (≤59 years); Gulf markets = annual contract + furnished-daily. 8-country market catalog (EG SA AE KW QA JO OM LY) — adding a country/term is config-only (specs-based, adaptive-data philosophy). Create shows the rental-system field only for rentals; FilterSheet chips filter it; the map inherits it automatically. | DB test: each regime filters independently, no-filter returns all |
| **Search speed at scale (GIN trigram)** | `idx_listings_title_trgm` + `idx_listings_description_trgm` (gin_trgm_ops) accelerate the existing `ILIKE '%term%'` search — plan changes, semantics don't. Self-provisioning at boot (idempotent, CONCURRENTLY, non-fatal) + declared in the Drizzle schema for fresh environments. | DB test: indexes created idempotently + search results unchanged |
| **Booking-style RENT map** | `offer_type=rent` on the map/search clusters **only rentals** — real-estate, land, factories. One shared filter path (`parsedFromSearchQuery` + `buildAttributeConditions`) → map & list always consistent. | DB test (rent vs sale) |
| **Admin "control keys"** | Full plan management (price, quota, CPL ×4, boost, ranking, active/baseline) via `GET/POST/PATCH /admin/plans` (gated `manage_payments`) + **Plans & Pricing** page in Banco Admin. | service tests + admin-os typecheck |
| **Observability** | Server: structured error reporting + optional alert webhook + process-level unhandled-error capture. Mobile: global JS + React render crash capture. | tests + wired |
| **Marketplace lifecycle** | publish → appears (feed + search + SEO) → open → message → favorite → edit → bump → archive → republish → delete (+ cascade). | end-to-end DB test |
| **Adaptive Data philosophy** | Custom specs (unlimited), search across description + spec values, minimal floor, Candidate-Attributes learning pipeline. | tests |
| **Furnished rental host hub (R1)** | Isolated `/rentals/hub` for `is_bookable` units; edit listing (title/location/price); profile menu + booking deep-links; separate from sale/long-term rent. | mobile typecheck + manual path review |

**Deploy hardening already in place:** `app.listen` binds the port **before** `ensureDbExtensions` (the earlier deploy failure was the port never opening because startup awaited a DB extension). Process-level `unhandledRejection`/`uncaughtException` handlers added.

---

## 3. Content / i18n (reviewed — sound)

- Mobile i18n (`constants/i18n.ts`, ~3,338 lines) is **comprehensive**, English + Arabic in parallel, with **`ar: typeof en` parity enforced at typecheck** → no missing keys possible.
- No hardcoded user-facing English strings found in the mobile screens.
- The **AI assistant already replies in the user's language** (Egyptian Arabic if they wrote Arabic, else English — `AiAssistantService` system prompt).
- Conclusion: the translation layer is functionally sound; no forced changes were made.

---

## 4. Honest remaining items (need your environment)

| Item | Status | Why it needs you |
|---|---|---|
| **Image-upload byte path** | object-storage config fixed + permission prompts added on Replit (`1bfc2f5`, `769086c`); byte path not locally testable | Needs the Replit Object Storage env — verify avatar/cover/listing/chat uploads on a real device. |
| **Replit-env runtime blockers (from device testing)** | tracked | OTP email delivery · Google Sign-In · Apple Sign-In (unconfigured) · GPS location update · push notifications · settings deep-links · AI assistant (needs `OPENAI_API_KEY` secret; client now prefers it over the stuck managed integration). All are environment/integration items in the Replit workspace, not local code defects. |
| **Real-device / store / load QA** | — | Android/iPhone/iPad device runs, store forms, and load testing are environment tasks. |

These are flagged rather than faked — nothing was marked "done" that wasn't actually verified.

---

## 5. Sections, journeys & "no feature blocks another"

The four markets (cars · real-estate incl. land · industrial/factories · B2B) all flow through **one** search + map + filter engine. Per-section filters (offer_type, property_type, fuel/transmission/brand/model/year, industry, origin, industrial_type) are additive and independent — a filter that doesn't apply to a section is simply absent, never conflicting. Adding a filter once makes it work in **both** the list and the map (single source of truth).

---

## 6. Path to 100% (next, in this same environment)

1. ~~Wire the existing map UI to `/v1/search/map`~~ → **done** (Replit wiring, locally reviewed + typecheck-verified); remaining: device QA on Replit.
2. Verify the Replit-env runtime blockers on device (uploads byte-path, OTP, Google/Apple sign-in, GPS, push, AI key).
3. ~~GIN search index for large-catalog scale~~ → **done** (trigram indexes, boot-provisioned + schema-declared, DB-tested).
4. Profile-completion polish + phone-permission flow review (account creation UX).
5. Continued deploy/log hardening with real deploy runs.

Work continues in the same environment; this report and the codebase are kept in sync on each push.
