# BANCO Store — Completion & Status Report

_Last updated: 2026-07-10 — Mobile stabilize M01–M31 on `fix/mobile-master-stabilize`; security P0 closed; Live Replit still STALE until API redeploy. Canonical mobile publish gate: `audit/mobile/MOBILE-PUBLISH-SUCCESS-GATE.md`._

> **Release line:** worktree branch `fix/mobile-master-stabilize` (see `git log -1` / `git status`). Mobile regression via `pnpm --filter @workspace/banco-mobile run test` (icons + lib + resilience + universal-links). Staging smoke still **OPS** (secrets). Website does **not** block mobile (O17 SKIP).

This is the live status of the BANCO Store monorepo (Banco Mobile · Banco Admin · Banco Market/dealer-os · API Server · shared libs · optional banco-web). It records what is **done and verified**, the **architecture**, and the **honest remaining items** with the reason each is or isn't locally verifiable.

---

## 1. How verification works here

- **Backend (api-server):** large vitest suite (needs `DATABASE_URL` / CI Postgres). Includes geo map/list parity, map clusters, rental_term, industrial isolation, material gate (pure unit).
- **Mobile regression:** `test:icons` + `test:lib` + `test:resilience` + `test:universal-links` (CI `mobile-regression` runs all four).
- **Search isolation proofs:** `audit/mobile/scripts/proof-isolation.mjs` + `proof-create-fields.mjs`.
- **ESLint:** `pnpm run lint` on `scripts/**`.
- **Type safety:** `pnpm run typecheck` (core excludes consumer web; website has its own workflow).
- **API contract:** `lib/api-spec/openapi.yaml` → orval → `lib/api-client-react` + `lib/api-zod`.
- **Build:** CI Linux. Local Windows may need `pnpm install --ignore-scripts` when `preinstall` needs `sh`.

---

## 2. Delivered & verified (product + stabilize)

| Area | What | Verification |
|---|---|---|
| **P0 security** | Upload IDOR claims, LIKE escape, deleted-user visibility, ACL owner IDs | `audit/fixes/C-01…H-03`, commit history on main |
| **Mobile stabilize M01–M27** | Profile phone, create permissions, home paint, search chrome, market picker, map, isolation | ACCEPTANCE + lib-hardening |
| **Section companies M28–M31** | material filter, CLEAR_SECTION_ATTRS, web parity, hub new_law, feed `market_country` | proof-isolation + create-fields |
| **Server-side map clustering** | `GET /v1/search/map` + bookable/price on single pins (local code) | DB tests when DATABASE_URL set; **live STALE** |
| **Market country** | list + map + feed filter; create stamps `specs.market_country` | search-contract + home feed asserts |
| **Rental systems** | per-country law terms; rent engine gate | FilterSheet + SearchControls |
| **Billing B1–B4** | invoices/PDF/CSV without Paymob | test:lib |
| **Expo/EAS config** | preview APK + production AAB profiles | `eas.json`, production-readiness checklists |

---

## 3. Content / i18n (reviewed — sound)

- Mobile i18n EN/AR with `ar: typeof en` parity at typecheck.
- AI assistant language follows user input when key present.

---

## 4. Honest remaining items (need your environment)

| Item | Status | Why it needs you |
|---|---|---|
| **API redeploy** | Live Replit **STALE** (code gate PASS @ `fe745f3`; probe fails until redeploy) | Run `pre-redeploy-code-gate` then Replit § `NEXT-OPS-REPLIT-REDEPLOY.md` |
| **Image-upload byte path** | OPS | Object Storage + device |
| **OTP / Google / Apple / GPS / Push / AI key** | OPS | Clerk + secrets |
| **Staging P0 smoke + upload_claims table** | O16 OPEN | `STAGING-REQUIRED-SECRETS.md` |
| **EAS preview install + Device QA** | OPEN | `MOBILE-PUBLISH-SUCCESS-GATE.md` §2–3 |
| **Store production submit** | NO-GO until above | Play / App Store consoles |

These are flagged rather than faked — nothing was marked "done" that wasn't actually verified.

---

## 5. Sections, journeys & "no feature blocks another"

The four browse companies (cars · real-estate · facilities · materials) plus host (Profile) and B2B (Business hub) stay isolated. Filters that don't apply to a section are absent, never conflicting. List / map / feed share the same attribute + market gates.

---

## 6. Path to mobile publish success

Follow **`audit/mobile/MOBILE-PUBLISH-SUCCESS-GATE.md`** only:

1. Redeploy API from this branch  
2. Live probe green  
3. Staging smoke + upload_claims  
4. EAS preview on device  
5. Device QA matrix  
6. Then production EAS / stores  

Website / Paymob remain optional SKIP and must not block mobile.

---

## Consolidation

- Canonical readiness: `audit/production-readiness/FULL-READINESS-STATUS-PLAN.md`
- Mobile gate: `audit/mobile/MOBILE-PUBLISH-SUCCESS-GATE.md`
- Open OPS: `audit/production-readiness/OPEN-ITEMS-BACKLOG.md` → **O16 only**
