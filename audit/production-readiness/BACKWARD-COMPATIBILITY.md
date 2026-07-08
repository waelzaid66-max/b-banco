# Backward Compatibility — BANCO Store

**Status:** ✅ Ready — additive waves 4/5; AsyncStorage versioned keys; legacy routes preserved.

---

## Mobile — AsyncStorage keys

**Policy:** Keys include version suffix (`_v1`) or namespace. **Never rename** without migration read of old key.

| Key | Owner | Payload | Migration notes |
|-----|-------|---------|-----------------|
| `banco_saved_v1` | `SessionContext` | Saved listings JSON | Bump to `_v2` only with read-old → write-new |
| `banco_saved_searches_v1` | `SessionContext` | Saved search criteria | Same |
| `banco_recently_viewed_v1` | `SessionContext` | Recent listing ids | Same |
| `banco_recent_queries_v1` | `SessionContext` | Recent search strings | Same |
| `banco:listing-draft:v1` | `listingDraft.ts` / create flow | Resumable create draft | Critical for publish UX — do not invalidate lightly |
| `banco.theme` | `ThemeContext` | Theme mode | Unversioned; stable |
| `banco.lang` | `LanguageContext` | `en` / `ar` | Unversioned |
| `banco.sound_enabled` | `SoundContext` | `"0"` / `"1"` | Unversioned |
| `banco.notifications_enabled` | `SoundContext` | `"0"` / `"1"` | Unversioned |
| `banco.biometric.enabled` | `BiometricContext` | `"0"` / `"1"` | Unversioned |

Session writes are **debounced (400ms)** — compatible with older builds that wrote eagerly (read path unchanged).

---

## Mobile — deep links & routes

| Legacy | Current behavior | Wave |
|--------|------------------|------|
| `/search-results` | Redirect / unified into `/(tabs)/search` | Wave 3 |
| `engine` query param on search links | Accepted in search tab | Wave 3 |
| Profile → wallet only | Profile → `/billing` hub; wallet still reachable | PH-1 |
| `expo-router` origin `https://replit.com/` | **Still default in app.json** — change only with production domain | Pending ops |

**Risk if origin not updated:** Universal links may open Replit, not production domain — **env/ops**, not API break.

---

## API — optional fields & enums

**Policy:** Clients must ignore unknown JSON fields. Server adds optional fields only (OpenAPI additive diffs).

### Wave 4 — Search taxonomy (2026-07-07)

| Change | Client impact |
|--------|---------------|
| `marketCountry` in mobile state only | **Not sent to API** — old clients unaffected |
| `rental_term` filter values per market | Additive — invalid combo cleared client-side |
| FilterSheet market chips | New UI — old app versions without update still send `rental_term` they know |

### Wave 5 — Geo / near-me (2026-07-07)

| Change | Client impact |
|--------|---------------|
| `near_lat`, `near_lng`, `radius_km` on search/map | **Optional query params** — old clients omit them → same results as before |
| Map cluster cache / debounce | Client-only — no API change |
| OpenAPI codegen regen | Additive types in client |

**No publish/create/upload API changes** in waves 4/5.

---

## API — response compatibility

| Area | Rule |
|------|------|
| `FeedItem` | New badge fields nullable |
| Listing detail | Extra spec keys ignored by old mobile |
| Facet maps | Missing keys = empty chip set |
| Errors | Stable `{ code, message }` envelope |

---

## Web admin / dealer

- Admin plan `features` JSON — opaque to mobile.
- Payment config in DB — mobile uses same public payment endpoints.

---

## Store build skew (old app + new API)

Supported model: **new API + old mobile** for at least one store review cycle.

| Scenario | Expected |
|----------|----------|
| Old app, new optional search params | Works — params omitted |
| Old app, new notification enum in payload | Ignore unknown type |
| New app, old API missing near-me | Near-me toggle no-ops or error handled |
| Old app, stricter upload validation | **Avoid** — never tighten create schema without version bump |

---

## Verification commands

```bash
pnpm --filter @workspace/banco-mobile run test:lib
pnpm --filter @workspace/banco-mobile run test:resilience
pnpm --filter @workspace/api-server test -- MarketplaceLifecycle.e2e.test.ts
pnpm run typecheck
```

---

## Flags for reviewers

| Item | Severity | Action |
|------|----------|--------|
| Changing `LISTING_DRAFT_KEY` without migration | High | Blocks old in-progress creates |
| Required new field on `POST /v1/listings` | Critical | Requires `/v2` or app force-update |
| Removing `/search-results` redirect | Medium | Breaks bookmarked links |
| `expo-router` origin change | Medium | Coordinate with domain go-live |

**Publish lifecycle:** Waves 4/5 explicitly documented as **additive only** — no change to publish defaults.
