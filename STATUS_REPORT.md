# BANCO Store — Completion & Status Report

_Last updated: 2026-06-30 — pushed to the B-OOM repository as the current complete, updated snapshot._

This is the live status of the BANCO Store monorepo (Banco Mobile · Banco Admin · Banco Market/dealer-os · API Server · shared libs). It records what is **done and verified**, the **architecture**, and the **honest remaining items** with the reason each is or isn't locally verifiable.

---

## 1. How verification works here

- **Backend (api-server):** real integration tests on a real PostgreSQL — `pnpm --filter @workspace/api-server test`. Current state: **247 passed / 3 skipped / 0 failing**.
- **Type safety (all surfaces):** `pnpm -r --if-present run typecheck` → **0 errors across 7 packages** (api-server, banco-mobile, admin-os, dealer-os, landing, mockup-sandbox, scripts).
- **API contract:** `lib/api-spec/openapi.yaml` is the source of truth → `orval` regenerates the typed client (`lib/api-client-react`) + zod (`lib/api-zod`). Generated diffs this session were **purely additive (0 deletions)**.
- **Build:** runs on CI (Linux). Locally on Windows the esbuild native binary differs, so **typecheck is the local proxy** for compilation.

---

## 2. Delivered & verified this phase

| Area | What | Verification |
|---|---|---|
| **Server-side map clustering** | `GET /v1/search/map` → grid-clustered pins for a viewport, reusing the **exact** search filters. Scales (returns cells, not all pins). | DB test: zoom-out clusters, zoom-in pins, bbox gates, total conserved |
| **Booking-style RENT map** | `offer_type=rent` on the map/search clusters **only rentals** — real-estate, land, factories. One shared filter path (`parsedFromSearchQuery` + `buildAttributeConditions`) → map & list always consistent. | DB test (rent vs sale) |
| **Admin "control keys"** | Full plan management (price, quota, CPL ×4, boost, ranking, active/baseline) via `GET/POST/PATCH /admin/plans` (gated `manage_payments`) + **Plans & Pricing** page in Banco Admin. | service tests + admin-os typecheck |
| **Observability** | Server: structured error reporting + optional alert webhook + process-level unhandled-error capture. Mobile: global JS + React render crash capture. | tests + wired |
| **Marketplace lifecycle** | publish → appears (feed + search + SEO) → open → message → favorite → edit → bump → archive → republish → delete (+ cascade). | end-to-end DB test |
| **Adaptive Data philosophy** | Custom specs (unlimited), search across description + spec values, minimal floor, Candidate-Attributes learning pipeline. | tests |

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
| **Map UI wiring (pan/zoom → clusters)** | backend ready; UI is the last piece | The map is a Leaflet/WebView bridge; a mobile-UI change can't be runtime-verified here — needs device QA so the locked, working map isn't risked blind. |
| **Image-upload byte path** | validation logic present; byte path not locally tested | The presigned PUT + stored-object metadata check needs the Object Storage backend (your environment keys). |
| **Real-device / store / load QA** | — | Android/iPhone/iPad device runs, store forms, and load testing are environment tasks. |

These are flagged rather than faked — nothing was marked "done" that wasn't actually verified.

---

## 5. Sections, journeys & "no feature blocks another"

The four markets (cars · real-estate incl. land · industrial/factories · B2B) all flow through **one** search + map + filter engine. Per-section filters (offer_type, property_type, fuel/transmission/brand/model/year, industry, origin, industrial_type) are additive and independent — a filter that doesn't apply to a section is simply absent, never conflicting. Adding a filter once makes it work in **both** the list and the map (single source of truth).

---

## 6. Path to 100% (next, in this same environment)

1. Wire the existing map UI to the new `/v1/search/map` (additive; device-QA gated).
2. GIN/tsvector search index for large-catalog scale (additive, DB-testable).
3. Image-upload byte-path test once Object Storage is reachable.
4. Profile-completion polish + phone-permission flow review (account creation UX).
5. Continued deploy/log hardening with real deploy runs.

Work continues in the same environment; this report and the codebase are kept in sync on each push.
