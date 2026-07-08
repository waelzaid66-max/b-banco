# خطة فصل وتوافق موقع BANCO العام (Consumer Website)

**التاريخ:** 2026-07-08  
**النطاق:** تخطيط فقط — **لا تنفيذ كود** في هذه المرحلة  
**الريبو:** `C:\Users\waelz\Downloads\BANCO-CA-OOM`  
**المرجع الرئيسي للصيانة:** [`audit/maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md`](../maintenance/MASTER-MAINTENANCE-READINESS-PLAN.md)

---

## 0. ملخص تنفيذي

موقع BANCO العام (Landing + SEO + Browse/Search) يُبنى كـ **Bounded Context** مستقل: **Consumer Web Surface** اختياري يستهلك نفس الـ API العامة والـ taxonomy المشتركة، دون أن يلمس runtime الموبايل أو يفرض migrations/schema خاصة بالويب.

**الوضع الحالي (مُحقَّق من الكود):**

| Artifact | الدور | Stack | API / Taxonomy |
|----------|------|-------|----------------|
| `artifacts/banco-mobile` | تطبيق المستهلك (Expo) | Expo Router 6, Clerk Expo, RN | `@workspace/api-client-react`, `@workspace/taxonomy` |
| `artifacts/dealer-os` | Banco Market (B2B للتجار) | Vite + wouter, Clerk React | نفس الـ client + taxonomy |
| `artifacts/admin-os` | لوحة التحكم | Vite + wouter, Clerk React | admin endpoints |
| `artifacts/landing` | **صفحة دخول/دليل** (ليست موقع browse كامل) | Vite SPA, inline CSS | `@workspace/api-client-react` في `package.json` **غير مستخدم** في `App.tsx` حالياً |
| `artifacts/api-server` | JSON API + **SEO HTML** على `/l/:id` | Express 5, Drizzle | `lib/api-zod`, `@workspace/db` |
| `lib/taxonomy` | SSOT للتصنيفات (categories, locations, cars) | pure TS | بدون React |
| `lib/api-spec` | OpenAPI → Orval codegen | `openapi.yaml` | يولّد `api-client-react` + `api-zod` |

**قرار معماري أساسي:**  
الموقع **لا يُدمج** داخل `banco-mobile` و**لا يستورد** منه. التوافق يتحقق عبر **Contract-first** (`lib/api-spec/openapi.yaml`) + **`@workspace/taxonomy`** + (لاحقاً) **`lib/search-contract`** لترجمة الفلاتر — وليس عبر مشاركة مكوّنات UI.

**مسار التقنية الموصى به للـ SEO الحقيقي:**  
- **W0–W1:** الإبقاء على `artifacts/landing` كـ hub + health  
- **W1+:** إضافة `artifacts/banco-web` (Next.js App Router أو بديل SSR/SSG) للصفحات القابلة للفهرسة؛ الإبقاء على `artifacts/api-server/src/seoRoutes.ts` لـ `/l/:id` كـ fallback/OG حتى اكتمال migration  
- **بديل مؤجل:** ترقية landing إلى SSR — أقل فصلاً عن dealer-os/admin-os patterns

---

## A. Architecture principles — مبادئ المعمارية

### A.1 Bounded context: Website as optional consumer surface

```
┌─────────────────────────────────────────────────────────────────┐
│                     BANCO Monorepo (pnpm)                        │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│ banco-mobile │  banco-web   │  dealer-os   │    admin-os        │
│  (Expo RN)   │ (SSR public) │ (B2B Vite)   │  (admin Vite)      │
│  REQUIRED    │  OPTIONAL    │  OPTIONAL    │  OPTIONAL          │
└──────┬───────┴──────┬───────┴──────┬───────┴─────────┬──────────┘
       │              │              │                 │
       └──────────────┴──────────────┴─────────────────┘
                              │
                    HTTP(S) read-mostly
                              ▼
              ┌───────────────────────────────┐
              │   api.banco.com (api-server)   │
              │   /api/v1/*  JSON (OpenAPI)    │
              │   /l/:id, /sitemap.xml (SEO)   │
              └───────────────────────────────┘
                              │
                              ▼
                     PostgreSQL (shared)
```

- **الموبايل** هو المنتج الأساسي للمستهلك؛ **الموقع** consumer اختياري.
- إزالة مجلد `artifacts/banco-web` أو تعطيل build الـ landing **لا يكسر** EAS/mobile CI.
- **dealer-os** ≠ consumer website — B2B market منفصل (`/market/` في nginx).

### A.2 Contract-first: OpenAPI as single API truth

| مصدر | مسار | دور |
|------|------|-----|
| OpenAPI | `lib/api-spec/openapi.yaml` | SSOT لكل endpoints + query params |
| Codegen | `pnpm --filter @workspace/api-spec run codegen` | `lib/api-client-react`, `lib/api-zod` |
| Server validation | `lib/api-zod` في api-server | Zod schemas متطابقة |

**قواعد:**

1. أي param جديد للبحث على الويب **يُضاف أولاً** إلى OpenAPI ثم codegen — **نفس مسار Wave 5** (`near_lat`, `near_lng`, `radius_km`).
2. الويب **لا يخترع** query params غير موثّقة (مثل `marketCountry` في الموبايل — UI-only، لا يُرسل للـ API).
3. Breaking changes **ممنوعة** على `/v1/*`؛ إضافات optional فقط.

### A.3 Shared read-only libs vs app-specific UI

| مشترك (import مسموح) | خاص بالتطبيق (لا cross-import) |
|----------------------|----------------------------------|
| `@workspace/taxonomy` | `artifacts/banco-mobile/components/*` |
| `@workspace/api-client-react` | `artifacts/banco-mobile/lib/searchParams.ts` (حتى extraction) |
| `@workspace/api-zod` (server فقط) | `artifacts/banco-mobile/hooks/*`, contexts |
| (مستقبل) `lib/search-contract` pure TS | Expo modules, native maps WebView |
| i18n keys strategy: **duplicate AR/EN strings في web** أو `lib/i18n-keys` لاحقاً | `listingCreateTaxonomy.ts` في mobile — **migrate تدريجياً** إلى taxonomy |

**ملاحظة taxonomy:**  
`lib/taxonomy/src/categories.ts` يعرّف `Category`, `apiCategoryFor`, industrial groups — **مستخدم فعلياً** من mobile عبر `CategoryTabs.tsx`.  
`MARKET_COUNTRIES` / `RENTAL_TERMS` ما زالت في `artifacts/banco-mobile/constants/listingCreateTaxonomy.ts` مع adapter `lib/searchTaxonomy.ts` — **الموقع يجب أن يعيد استخدام نفس adapter بعد نقله إلى lib مشترك** (موجة taxonomy-web، additive).

### A.4 Deploy independence

| Surface | Build | Host | Env prefix |
|---------|-------|------|------------|
| API | `artifacts/api-server/build.mjs` | Cloud Run / EB / Replit | `DATABASE_URL`, `CLERK_*`, `PUBLIC_APP_URL` |
| Mobile | EAS (`release/EAS_BUILD.md`) | App stores | `EXPO_PUBLIC_*` |
| Landing / banco-web | Vite أو Next build | CDN / Firebase / GCS+CDN | `VITE_*` أو `NEXT_PUBLIC_*` |
| dealer-os | Vite | `/market/` path | `VITE_*` + Clerk |
| admin-os | Vite | `/admin/` path | `VITE_*` + Clerk |

**مرجع نشر موجود:**  
- `deploy/aws/Dockerfile.web` — يبني admin + dealer + landing معاً (nginx path routing)  
- `deploy/aws/nginx.conf` — `/` landing, `/market/` dealer, `/admin/` admin, `/api/` proxy  
- `deploy/gcp/README.md` — API على Cloud Run؛ web static على GCS+CDN

**الفصل المطلوب:** pipeline GitHub Actions **منفصل** لـ website (§F) بحيث فشل build الويب لا يحجب mobile-regression.

### A.5 Failure isolation

| حدث | تأثير على Mobile | تأثير على API |
|-----|------------------|---------------|
| Website CDN down | **لا شيء** — التطبيق يتصل بـ API مباشرة | لا شيء |
| Website build broken في CI | **لا شيء** إذا CI معزول | لا شيء |
| API down | التطبيق offline | الويب offline أيضاً (متوقع) |
| `seoRoutes` down | مشاركة `/l/:id` من الموبايل (`lib/share.ts`) تتأثر | JSON API قد يعمل |

---

## B. Monorepo layout — الهيكل المستهدف

### B.1 Workspace الحالي

```yaml
# pnpm-workspace.yaml
packages:
  - artifacts/*
  - lib/*
  - scripts
```

**Packages (16 `package.json`):**

| Package | Name |
|---------|------|
| Root | `workspace` |
| `artifacts/api-server` | `@workspace/api-server` |
| `artifacts/banco-mobile` | `@workspace/banco-mobile` |
| `artifacts/dealer-os` | `@workspace/dealer-os` |
| `artifacts/admin-os` | `@workspace/admin-os` |
| `artifacts/landing` | `@workspace/landing` |
| `artifacts/mockup-sandbox` | `@workspace/mockup-sandbox` |
| `lib/taxonomy` | `@workspace/taxonomy` |
| `lib/api-spec` | `@workspace/api-spec` |
| `lib/api-client-react` | `@workspace/api-client-react` |
| `lib/api-zod` | `@workspace/api-zod` |
| `lib/db` | `@workspace/db` |
| `lib/integrations-openai-ai-server` | `@workspace/integrations-openai-ai-server` |
| `scripts` | scripts workspace |

**لا يوجد `turbo.json`** — orchestration عبر `pnpm -r` و CI filters.

### B.2 Target structure (additive)

```
artifacts/
├── banco-mobile/          # unchanged — production mobile
├── api-server/            # unchanged — + optional public BFF routes only if OpenAPI demands
├── dealer-os/             # B2B — unchanged
├── admin-os/              # unchanged
├── landing/               # W0: entry hub (existing App.tsx directory)
└── banco-web/             # W1+: SSR consumer site (NEW — Next.js recommended)

lib/
├── taxonomy/              # SSOT — extend with market/rental enums (from mobile, re-export)
├── api-spec/              # OpenAPI — unchanged process
├── api-client-react/      # generated hooks + customFetch
├── api-zod/               # server validators
└── search-contract/       # NEW (W2): pure buildSearchParams + SearchCriteria types
    # Extracted FROM mobile logic, NO RN imports — mobile re-exports for compat

audit/website/             # this plan + checklist
deploy/
├── aws/Dockerfile.web     # update W1: optional banco-web dist path
└── gcp/                   # separate static bucket for banco-web
```

### B.3 ما يبقى في shared packages

| Package | محتوى | مستهلكون |
|---------|--------|----------|
| `@workspace/taxonomy` | categories, locations, cars, (future) market countries | mobile, dealer-os, api-server seed, **banco-web** |
| `@workspace/api-client-react` | `searchListings`, `getListing`, `getMapClusters`, React Query hooks | mobile, dealer-os, admin-os, **banco-web** |
| `@workspace/api-spec` | openapi.yaml | codegen only |
| `@workspace/search-contract` (future) | `SearchCriteria`, `buildSearchParams`, `hasActiveCriteria` | mobile (re-export), **banco-web** |

### B.4 ما يعيش ONLY في artifacts/banco-web (أو landing للـ hub)

- Layouts SSR/SSG، meta tags، structured data للصفحات المركّبة (category/location)
- Routing: `/`, `/cars`, `/real-estate`, `/search`, `/listing/[id]` (canonical may redirect to `/l/[id]` on API host during transition)
- Web-only analytics (Plausible/GA — env gated)
- Clerk `@clerk/nextjs` أو `@clerk/react` (web session cookies — see §C)
- Map UI: `@vis.gl/react-google-maps` (same as mobile web path) — **not** mobile WebView HTML

### B.5 ما يعيش ONLY في artifacts/landing (مرحلة انتقالية)

- صفحة الدليل الحالية (`artifacts/landing/src/App.tsx`) — env: `VITE_MARKET_URL`, `VITE_ADMIN_URL`, `VITE_APP_*`
- يمكن **دمجها** في banco-web `/` لاحقاً ثم deprecate landing package

### B.6 Cross-import boundaries — ممنوعات صريحة

```typescript
// ❌ NEVER in banco-web or landing
import { ... } from "../../banco-mobile/...";
import { ... } from "@workspace/banco-mobile/..."; // no such package — don't create re-exports from mobile

// ❌ NEVER in api-server (except existing seoRoutes — already isolated)
import { ... } from "../../banco-mobile/...";

// ✅ ALLOWED
import { apiCategoryFor } from "@workspace/taxonomy/categories";
import { searchListings, useGetListing } from "@workspace/api-client-react";
```

**ESLint boundary rule (موصى به W0):**  
`eslint-plugin-boundaries` أو `no-restricted-imports` في `eslint.config.mjs`:

```javascript
// artifacts/banco-web — block ../banco-mobile/**
// artifacts/banco-mobile — block ../banco-web/**
```

### B.7 Optional package pattern (pnpm)

```json
// artifacts/banco-web/package.json — optional dep pattern not needed; use workspace:*
{
  "dependencies": {
    "@workspace/api-client-react": "workspace:*",
    "@workspace/taxonomy": "workspace:*"
  }
}
```

**CI optional build:**

```yaml
# if: env.WEBSITE_ENABLED == 'true'
```

Root `package.json` scripts **لا تضيف** website إلى `pnpm run build` الافتراضي حتى W1 — mobile-first CI unchanged.

---

## C. Compatibility matrix — مصفوفة التوافق

### C.1 Feature parity (consumer browse)

| Feature | Mobile | Web (target) | API endpoint | Shared lib |
|---------|--------|--------------|--------------|------------|
| Home feed sections | `(tabs)/index.tsx` `useGetFeed` | W2 `/` curated + links | `GET /v1/feed` | api-client |
| Category tabs | `CategoryTabs` + taxonomy | W2 chips | `category` param on search/feed | `@workspace/taxonomy/categories` |
| Full search | `(tabs)/search.tsx`, `useSearchMiniApp` | W2 `/search` | `GET /v1/search` | search-contract (future) |
| Map clusters | `SearchResultsMap.tsx` | W3 `/search?view=map` | `GET /v1/search/map` | api-client |
| Facet counts | `lib/facets.ts` | W3 filter sidebar | `GET /v1/search/facets` | api-client |
| Listing detail | `listing/[id].tsx` | W2 `/listing/[id]` or link `/l/[id]` | `GET /v1/listings/{id}` | api-client |
| Public SEO page | share → `/l/[id]` on API host | W1 canonical SEO | api-server `seoRoutes.ts` | N/A (HTML) |
| Similar listings | listing detail | W2 sidebar | `GET /v1/listings/{id}/similar` | api-client |
| Trending | `SearchDiscover` | W2 discover | `GET /v1/search/trending` | api-client |
| Autocomplete | search input | W2 | `GET /v1/search/autocomplete` | api-client |
| RE: sale/rent engines | `constants/engines.ts` | W2 engine chips | `offer_type`, `property_type`, … | engines → migrate to taxonomy or search-contract |
| RE: rental terms | `searchTaxonomy.ts` + FilterSheet | W2 market country UI-only | `rental_term` query only | taxonomy (future) |
| Industrial subtypes | industrial chips | W2 | `industrial_type` | taxonomy |
| Near me | `lib/nearMe.ts`, FilterSheet | W3 (browser geolocation) | `near_lat`, `near_lng`, `radius_km` | search-contract |
| Saved / toggle save | `(tabs)/saved.tsx` | W4 optional | `POST /v1/saves/toggle`, `GET /v1/saves` | Clerk auth |
| Messages | `(tabs)/messages.tsx` | W4 optional | `/v1/conversations/*` | Clerk auth |
| Create listing | `listings/create.tsx` | **Out of scope v1** — deep link to app | `POST /v1/listings` | mobile only |
| Wallet / billing | `wallet.tsx`, `billing.tsx` | **Out of scope v1** | `/v1/wallet/*`, `/v1/billing/*` | mobile/dealer |
| B2B RFQ / investments | business/* routes | **dealer-os** not consumer web | dealer endpoints | dealer-os |
| Rental daily booking | `bookings.tsx`, availability | W4+ product decision | `/v1/bookings`, availability | mobile first |

### C.2 Search/listings/map parity rules

1. **Single param builder:** `buildSearchParams(criteria)` must produce identical query strings on mobile and web (after extraction to `lib/search-contract`).
2. **Industrial groups:** `facilities` / `materials` → `category=industrial` + comma-separated `industrial_type` (see `artifacts/banco-mobile/lib/searchParams.ts` lines 180–187).
3. **Engine chips:** `constants/engines.ts` merges `payment_plan`, `offer_type`, `property_type`, etc. — web must use same engine map (migrate to shared lib).
4. **Map/list sync:** Wave 5 guarantees `mapClusters` respects same geo filters as list — web map **must** call both with same params (mirror `SearchResultsMap.tsx`).
5. **Pagination:** cursor-based `cursor` + `limit` from OpenAPI — no offset inventing.
6. **Sort enum:** `recommended | newest | price_asc | price_desc | popular` — omit `recommended` on wire (mobile pattern).
7. **Public visibility:** only active, non-flagged listings — server enforced; web displays API errors as 404.

### C.3 Auth — Clerk web vs mobile

| Aspect | Mobile (`@clerk/expo`) | Web consumer (target) | dealer-os / admin-os (reference) |
|--------|------------------------|----------------------|----------------------------------|
| SDK | `@clerk/expo` | `@clerk/nextjs` or `@clerk/react` | `@clerk/react` |
| Session | Secure store + bearer | **HTTP-only cookies** via same origin `/api` proxy | `@clerk/react` |
| API auth | `setAuthTokenGetter(() => getToken())` in `_layout.tsx` | **Do not use bearer getter** — `custom-fetch.ts` documents cookies for browser | bearer or cookies via proxy |
| Publishable key | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `VITE_*` | `VITE_CLERK_PUBLISHABLE_KEY` |
| Proxy | `EXPO_PUBLIC_CLERK_PROXY_URL` | Same pattern if multi-domain | `publishableKeyFromHost` in dealer `App.tsx` |
| Public browse | unauthenticated OK | unauthenticated OK for W2–W3 | N/A |

**Base URL wiring (mobile reference):**

```typescript
// artifacts/banco-mobile/app/_layout.tsx
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}
```

**Web recommended:**

```typescript
// banco-web: same-origin — setBaseUrl('') or unset; fetch /api/v1/...
// OR explicit: setBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL)
```

Orval client uses `baseUrl: "/api"` in `lib/api-spec/orval.config.ts` — nginx proxies `/api/` → api-server.

### C.4 SEO routes vs deep links / expo-router

| Route type | URL pattern | Owner | Purpose |
|------------|-------------|-------|---------|
| SEO HTML (existing) | `https://{PUBLIC_APP_URL}/l/{id}` | **api-server** `seoRoutes.ts` | OG, Twitter, JSON-LD, sitemap |
| Sitemap | `/sitemap.xml`, `/robots.txt` | api-server | Crawlers |
| App deep link | `banco-mobile://listing/{id}` | Expo (`app.json` scheme) | In-app navigation |
| Universal link (future) | `https://banco.com/listing/{id}` | banco-web SSR | After `expo-router.origin` update (`release/DEPLOYMENT.md` §3) |
| Legacy redirect | `/search-results` | mobile `search-results.tsx` | Redirect to `/(tabs)/search` |

**Share flow today** (`artifacts/banco-mobile/lib/share.ts`):

- Prefers `EXPO_PUBLIC_PUBLIC_APP_URL` or `EXPO_PUBLIC_DOMAIN` + `/l/{id}`
- Web site must **not break** this URL — either keep serving `/l/` on API host or 301 from web to API until unified domain.

**SEO route mapping (target banco-web):**

| SEO page | Suggested path | Data source |
|----------|----------------|-------------|
| Home | `/` | static + feed teaser |
| Cars hub | `/cars` or `/cars/for-sale` | search preset |
| Real estate hub | `/real-estate`, `/rent`, `/sale` | engines + taxonomy |
| Industrial | `/industrial` | category preset |
| Listing | `/listing/[uuid]` SSR + **canonical** to `/l/[uuid]` OR replace seoRoutes gradually | `GET /v1/listings/{id}` |
| Search | `/search?q=&category=` | SSR shell + client hydrate |

---

## D. Separation guarantees — ضمانات الفصل التقني

### D.1 No shared runtime state

- لا Redis/session مشترك بين web و mobile.
- React Query caches **per app instance** — no shared service worker between Expo and web unless explicitly designed (not v1).
- Clerk sessions independent (different SDK storage).

### D.2 No website code in api-server (except existing public routes)

**مسموح today (keep):**

- `artifacts/api-server/src/seoRoutes.ts` — crawler HTML
- Public rate-limited JSON: `GET /v1/listings/:id`, search, feed (see `publicRateLimiter` in routes)

**ممنوع:**

- React SSR inside api-server
- Web-specific business logic forks (use same `SearchService`, `ListingService`)

Any new **read** endpoint for web must be justified in OpenAPI and usable by mobile too (additive).

### D.3 Feature flags / CI isolation

| Flag | Where | Effect |
|------|-------|--------|
| `WEBSITE_CI_ENABLED` | GitHub Actions | Gates `build-website` job |
| `WEBSITE_DEPLOY_ENABLED` | deploy pipeline | Skip CDN upload |
| `NEXT_PUBLIC_SITE_URL` | banco-web | canonical URLs |

**Mobile CI unchanged:** `.github/workflows/ci.yml` jobs `test`, `mobile-regression` — **no website dependency**.

Current `build` job builds landing with admin/dealer — **split in W0:**

```yaml
# Proposed: remove @workspace/landing from default build job;
# add website job with path filter: artifacts/landing/** artifacts/banco-web/**
```

### D.4 Database

- **Read-only** public queries via existing services — **no web-only tables** in v1.
- If analytics/redirect logs needed later → isolated table + migration in `lib/db` with **no mobile code dependency**.
- Migrations run via api-server boot (`ensureSchemaPatches`) — website deploy **never** runs `drizzle push`.

### D.5 CDN / domain topology

| Host | Serves | Notes |
|------|--------|-------|
| `banco.com` | banco-web + landing hub | Consumer |
| `api.banco.com` OR `banco.com/api/` | JSON + optional `/l/` | Single origin cheaper (`nginx.conf`) |
| `market.banco.com` OR `/market/` | dealer-os | B2B |
| `admin.banco.com` OR `/admin/` | admin-os | Internal |
| Expo app | `EXPO_PUBLIC_DOMAIN` | API same host on Replit today |

**Replit / preview:** landing `vite.config.ts` uses `BASE_PATH`, Replit cartographer — **do not coupling** to mobile `REPL_ID`.

---

## E. Phased implementation roadmap — خارطة الموجات

### Wave W0 — Scaffolding + CI isolation + health (1–2 weeks)

**Goal:** Website artifact builds and deploys independently; zero mobile changes.

| Task | Detail |
|------|--------|
| W0.1 | Add `audit/website/` docs (this file) |
| W0.2 | Split CI: `build-core` (api, admin, dealer, mobile typecheck) vs `build-website` (landing) |
| W0.3 | `GET /` landing health: static build artifact + `nginx-health` already in `deploy/aws/nginx.conf` |
| W0.4 | ESLint `no-restricted-imports` boundary mobile ↔ web |
| W0.5 | Document env matrix in `artifacts/landing/.env.example` |

**Acceptance criteria:**

- [ ] PR touching only `artifacts/banco-mobile/**` does **not** trigger website job (path filters)
- [ ] `pnpm --filter @workspace/banco-mobile run typecheck` passes with zero website changes
- [ ] Landing build passes on Linux CI (rollup binary present)

**Rollback:** Revert CI yaml only — no runtime impact.

**Mobile unaffected checklist:**

- [ ] No changes to `app.json`, EAS, or `_layout.tsx`
- [ ] No OpenAPI diff
- [ ] mobile-regression job identical

---

### Wave W1 — SSR/SSG landing + market SEO pages (2–4 weeks)

**Goal:** Indexable category/market pages; coexist with api-server `/l/:id`.

| Task | Detail |
|------|--------|
| W1.1 | Scaffold `artifacts/banco-web` (Next.js 15 App Router recommended) |
| W1.2 | Pages: `/`, `/cars`, `/real-estate`, `/industrial` with AR/EN metadata |
| W1.3 | `sitemap.xml` — **either** extend api-server sitemap links to web hubs **or** web sitemap index referencing `/l/` |
| W1.4 | Structured data `WebSite`, `Organization`, hub `CollectionPage` |
| W1.5 | Keep `artifacts/landing` OR redirect `/` → banco-web (nginx) |

**Acceptance criteria:**

- [ ] Lighthouse SEO ≥ 90 on hub pages (static)
- [ ] Valid hreflang or single locale documented
- [ ] Canonical URLs use production domain env
- [ ] `/l/{id}` still works (api-server) — share links from mobile unchanged

**Rollback:** Disable banco-web deploy; landing hub remains.

**Mobile unaffected:**

- [ ] `lib/share.ts` URLs still valid
- [ ] No new required env vars on Expo

---

### Wave W2 — Public listing browse + search read-only (3–5 weeks)

**Goal:** Parity with mobile search tab (list mode, no auth).

| Task | Detail |
|------|--------|
| W2.1 | Create `lib/search-contract` — extract from `searchParams.ts` (pure TS) |
| W2.2 | Mobile re-exports from lib (thin wrapper — **no behavior change**) |
| W2.3 | banco-web `/search` — React Query + `searchListings` |
| W2.4 | Listing card component (web-native UI, same fields as `SmartAssetCard`) |
| W2.5 | `/listing/[id]` client page + JSON-LD from API payload |
| W2.6 | Migrate `engines.ts` map to shared lib or taxonomy |

**Acceptance criteria:**

- [ ] Same `buildSearchParams` golden tests for mobile + web (shared test file in `lib/search-contract`)
- [ ] Filter set: category, q, price, location, engines — matches mobile tab
- [ ] Public access without Clerk
- [ ] Rate limits respected (publicRateLimiter — client-side debounce)

**Rollback:** Feature flag `NEXT_PUBLIC_SEARCH_ENABLED=false` → hub only.

**Mobile unaffected:**

- [ ] search-contract extraction is re-export only — mobile tests pass
- [ ] API load: optional CDN cache headers on GET search (server-side future, not required v1)

---

### Wave W3 — Map + filters parity (2–3 weeks)

**Goal:** Map/list shared criteria; FilterSheet depth optional on web.

| Task | Detail |
|------|--------|
| W3.1 | Map view `@vis.gl/react-google-maps` |
| W3.2 | `getMapClusters` with viewport caching (mirror mobile debounce 450ms) |
| W3.3 | Facets sidebar `useGetFacets` |
| W3.4 | Near me via browser Geolocation API |
| W3.5 | Full FilterSheet parity OR phased subset documented |

**Acceptance criteria:**

- [ ] Toggle map/list — identical result counts for same criteria (± clustering granularity)
- [ ] Near me: same default radius as `DEFAULT_NEAR_RADIUS_KM` in mobile `lib/nearMe.ts`
- [ ] Industrial group filters match Wave 2 tests

**Rollback:** Hide map toggle in UI.

---

### Wave W4 — Auth-gated actions optional (2+ weeks)

**Goal:** Save, contact seller, messages — **without** forcing login for browse.

| Task | Detail |
|------|--------|
| W4.1 | Clerk sign-in modal (web) |
| W4.2 | Saves toggle + saved list page |
| W4.3 | Lead contact (`POST /v1/leads/contact`) with auth |
| W4.4 | Optional: messenger web (large scope — may defer) |

**Acceptance criteria:**

- [ ] Unauthenticated users can still search/view
- [ ] Auth uses cookie session on same origin
- [ ] No bearer token in localStorage

**Rollback:** Disable auth routes — browse remains.

---

## F. CI/CD & operations

### F.1 GitHub Actions (proposed)

```yaml
# .github/workflows/ci.yml additions (conceptual)

jobs:
  build-core:
    # existing: typecheck all, build api-server, admin-os, dealer-os
    # REMOVE landing from default if WEBSITE_CI_ENABLED split done

  build-website:
    if: |
      github.event_name == 'workflow_dispatch' ||
      contains(github.event.pull_request.changed_files, 'artifacts/landing') ||
      contains(..., 'artifacts/banco-web')
    steps:
      - run: pnpm --filter @workspace/landing run build
      - run: pnpm --filter @workspace/banco-web run build  # when exists

  deploy-website-preview:
    # on PR: upload dist to GCS/Firebase preview channel
    # comment PR with preview URL — ONLY web artifact
```

**Path filters:** use `dorny/paths-filter` or equivalent.

### F.2 Preview URLs

| PR change | Preview |
|-----------|---------|
| `artifacts/banco-web/**` | `https://pr-{n}.preview.banco.com` |
| mobile only | No web preview (EAS preview separate workflow if exists) |

### F.3 Monitoring split

| Service | Health | Logs |
|---------|--------|------|
| API | `/api/healthz`, `/api/readyz` | CloudWatch / GCP logging |
| Web CDN | `200 /` + synthetic check | CDN analytics |
| Mobile | Sentry/crash (existing mobile) | Separate dashboard |

**Alerting:** website 5xx **does not** page mobile on-call.

### F.4 Release alignment

- `release/DEPLOYMENT.md` §2 — add banco-web build command when scaffolded
- `deploy/aws/Dockerfile.web` — optional fourth dist copy for banco-web at `/app/` or subdomain
- `scripts/rc1-validation.ps1` — website build optional flag

---

## G. Risks & anti-patterns — مخاطر وأنماط ممنوعة

| Risk | Impact | Mitigation |
|------|--------|------------|
| Import from `banco-mobile` | Coupling, RN in web bundle, CI hell | ESLint boundaries + code review |
| Duplicate taxonomy in web | Filter drift vs mobile | **Only** `@workspace/taxonomy` + search-contract |
| Coupling website deploy to api deploy | Website rollback breaks API | Separate Cloud Build triggers / docker images |
| CSR-only Vite for SEO pages | Poor indexing | Next.js SSR/SSG for hubs + listing pages |
| Web-only API hacks | Mobile misses features / contract drift | OpenAPI first |
| Merging dealer-os into consumer web | Wrong UX/auth model | Keep `/market/` separate |
| Removing api-server `seoRoutes` too early | Broken share links | Keep until web canonical proven |
| `pnpm run build` builds everything | Website blocks mobile releases | Split CI jobs |
| Windows rollup prune (RC-1) | landing build fails locally | CI on Linux is source of truth (`audit/rc1/BANCO-STORE-RELEASE-CANDIDATE-REPORT.md`) |

**Anti-patterns (explicit NO):**

1. ❌ `import FilterSheet from '../../banco-mobile/...'`
2. ❌ Copy-paste `MARKET_COUNTRIES` into web constants
3. ❌ New `web_listings` DB table for v1
4. ❌ Server Actions in api-server for web forms (use existing REST)
5. ❌ Single SPA for SEO + search without SSR (current landing is OK **only** as hub)

---

## H. Immediate next steps — خطوات فورية (ordered)

| # | Task | Owner hint | Est. |
|---|------|------------|------|
| 1 | Review + approve this plan | Tech lead | 0.5d |
| 2 | Split CI: extract landing/build-website job with path filters | DevOps | 1d |
| 3 | Add ESLint `no-restricted-imports` for `artifacts/banco-mobile` ↔ future `banco-web` | Platform | 0.5d |
| 4 | Create `artifacts/landing/.env.example` documenting `VITE_*` from `App.tsx` | Web | 0.5d |
| 5 | ADR: Next.js vs Astro for `banco-web` (SSR + Arabic RTL) | Arch | 1d |
| 6 | Scaffold empty `artifacts/banco-web` with health page + typecheck in CI only | Web | 2d |
| 7 | Spike: extract `buildSearchParams` tests into proposed `lib/search-contract` (read-only refactor PR) | Mobile+Web | 2d |
| 8 | Document domain plan: `PUBLIC_APP_URL`, `expo-router.origin`, `/l/` ownership | Product+Infra | 1d |
| 9 | Update `deploy/aws/Dockerfile.web` design doc for optional banco-web (no deploy yet) | Infra | 0.5d |
| 10 | Add website row to RC checklist (`release/FINAL_RELEASE_CHECKLIST.md`) — optional gate | QA | 0.5d |

---

## Appendix A — Current landing artifact detail

| Item | Value |
|------|-------|
| Entry | `artifacts/landing/src/main.tsx` → `App.tsx` |
| Router | None (single page); `pages/not-found.tsx` exists but unused in main flow |
| Styling | Inline `React.CSSProperties` (no route-level SEO) |
| Build out | `artifacts/landing/dist/public` |
| Config | `artifacts/landing/vite.config.ts` — `BASE_PATH`, Replit plugins when `REPL_ID` set |
| API client dep | Declared but **not wired** in UI — safe to use in W2 |

---

## Appendix B — Mobile API environment reference

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_DOMAIN` | API host → `setBaseUrl(https://...)` |
| `EXPO_PUBLIC_PUBLIC_APP_URL` | Public web base for share `/l/{id}` |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | Multi-domain Clerk |
| `CLERK_SECRET_KEY` | Server only (api-server) |

---

## Appendix C — Related audit / release docs

| Doc | Relevance |
|-----|-----------|
| `audit/maintenance/WAVE-4-SEARCH-TAXONOMY.md` | market country + rental_term alignment |
| `audit/maintenance/WAVE-5-SEARCH-GEO-MAPS.md` | map/list geo parity |
| `audit/rc1/BANCO-STORE-RELEASE-CANDIDATE-REPORT.md` | landing build flake on Windows |
| `release/DEPLOYMENT.md` | build order, EAS origin |
| `deploy/gcp/README.md` | Cloud Run + static web |
| `deploy/aws/Dockerfile.web` | combined static host |

---

*End of plan — implementation waves start only after W0 CI split approval.*
