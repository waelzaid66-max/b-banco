# Website ↔ Mobile Independence Checklist

**Use before merging any PR that touches `artifacts/landing`, `artifacts/banco-web`, or shared search/taxonomy libs.**

Reference: [`WEBSITE-SEPARATION-AND-COMPATIBILITY-PLAN.md`](./WEBSITE-SEPARATION-AND-COMPATIBILITY-PLAN.md)

---

## Pre-merge (every website PR)

- [ ] **No imports** from `artifacts/banco-mobile/**` (grep: `banco-mobile`)
- [ ] **No changes** to `artifacts/banco-mobile/app.json`, `eas.json`, or EAS scripts unless explicitly scoped to mobile
- [ ] **No breaking changes** to `lib/api-spec/openapi.yaml` (additive optional fields only)
- [ ] If OpenAPI changed: `pnpm --filter @workspace/api-spec run codegen` + typecheck all consumers
- [ ] Taxonomy/filter labels come from **`@workspace/taxonomy`** (or approved `lib/search-contract`) — not copied constants
- [ ] Website env vars use **`VITE_*` / `NEXT_PUBLIC_*`** — never `EXPO_PUBLIC_*`
- [ ] CI: mobile jobs (`mobile-regression`, api tests) still run and pass without website build

---

## Wave-specific gates

### W0 — CI isolation

- [ ] Website build job is **path-filtered** or `workflow_dispatch`
- [ ] Default `build` job does not **require** website success for mobile release decisions
- [ ] ESLint boundary rule documented in PR

### W1 — SEO hubs

- [ ] `/l/{id}` on api-server still returns 200 for shared listing (smoke one ID)
- [ ] Mobile `lib/share.ts` URLs unchanged or redirected with 301
- [ ] `PUBLIC_APP_URL` / canonical documented in deploy env

### W2 — Search browse

- [ ] Golden tests: `buildSearchParams(mobile criteria)` === `buildSearchParams(web criteria)` for fixture set
- [ ] Public pages work **without** Clerk sign-in
- [ ] No new DB migrations for web-only tables

### W3 — Map

- [ ] Same search params → list count ≈ map cluster item count (known clustering tolerance documented)
- [ ] `near_lat` / `near_lng` / `radius_km` match OpenAPI docs

### W4 — Auth (optional)

- [ ] Browse/search still public when signed out
- [ ] Web auth uses cookies on same origin — no `setAuthTokenGetter` in browser bundle for public pages

---

## Rollback readiness

- [ ] Feature flag or deploy toggle to disable website CDN without API redeploy
- [ ] Previous static `dist/` artifact retained (one version back)
- [ ] No irreversible API deprecation tied to website launch

---

## Mobile unaffected smoke (run on website-only PRs)

```bash
pnpm --filter @workspace/banco-mobile run typecheck
pnpm --filter @workspace/banco-mobile run test:icons
pnpm --filter @workspace/banco-mobile run test:lib
pnpm --filter @workspace/banco-mobile run test:resilience
```

Expected: **all pass** with zero mobile file changes in the PR.

---

## Post-deploy (website production)

- [ ] Synthetic check: `GET /` website 200
- [ ] `GET /api/healthz` 200 (API independent)
- [ ] Sample `GET /l/{known-id}` 200 + OG tags present
- [ ] Mobile staging still connects to same API base URL
- [ ] Alerts: website monitors separate from API PagerDuty/on-call

---

*Checklist version: 2026-07-08 — update when `artifacts/banco-web` is scaffolded.*
