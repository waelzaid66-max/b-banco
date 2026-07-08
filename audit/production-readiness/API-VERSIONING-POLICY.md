# API Versioning Policy — BANCO Store

**Status:** ✅ Ready — `/v1` prefix, OpenAPI SSOT, Orval codegen, additive-only discipline documented.

---

## Version surface

| Layer | Convention | Source of truth |
|-------|------------|-----------------|
| URL prefix | `/api/v1/*` | `artifacts/api-server/src/routes/index.ts` mounts `v1Router` at `/v1` |
| OpenAPI document | `info.version: 1.0.0`, `servers[0].url: /api` | `lib/api-spec/openapi.yaml` |
| Generated client | Paths include `/api/v1/…` | `lib/api-client-react` via Orval |
| Validation | Zod schemas from same spec | `lib/api-zod` |
| Health (unversioned) | `/api/healthz`, `/api/readyz` | Outside v1 — intentional for probes |

**Rule:** Breaking changes **must not** ship under `/v1/*`. New major behavior → future `/v2` router + parallel spec.

---

## Client usage verification

### Mobile (`artifacts/banco-mobile`)

```typescript
// app/_layout.tsx
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
// Generated calls: /api/v1/feed, /api/v1/listings, …
```

All listing, upload, search, feed calls go through `@workspace/api-client-react` — **no hand-written `/api/v2`**.

### Web (admin-os, dealer-os, landing)

Same generated client; Vite apps set base URL at bootstrap.

### Codegen workflow

```bash
# 1. Edit lib/api-spec/openapi.yaml (additive preferred)
# 2. Regenerate
pnpm --filter @workspace/api-spec run codegen
# 3. Typecheck all consumers
pnpm run typecheck
```

Post-process: `lib/api-spec/postprocess.mjs` restores raw `Blob` bodies for CSV/PDF endpoints.

---

## Breaking vs non-breaking changes

### ✅ Allowed in `/v1` (non-breaking)

- New optional query parameters (e.g. Wave 5: `near_lat`, `near_lng`, `radius_km`)
- New optional JSON fields on responses
- New endpoints
- New enum values **if clients treat unknown values gracefully**
- New `notification_type` enum values (DB + API)

### ❌ Forbidden without `/v2`

- Removing or renaming fields
- Changing field types (string → number)
- Making optional fields required on **create** payloads (especially listings/uploads)
- Changing auth requirements on existing public endpoints
- Removing endpoints

---

## Listing / publish contract (frozen semantics)

These endpoints are **production-proven** — treat as stable:

| Endpoint | Role |
|----------|------|
| `POST /v1/uploads/request-url` | Presigned upload |
| `POST /v1/uploads/verify` | Verify object |
| `POST /v1/uploads/promote` | Public serving URL |
| `POST /v1/listings` | Create / publish |
| `PATCH /v1/listings/{id}` | Edit / archive / republish |
| `GET /v1/feed` | Visibility in feed |
| `GET /v1/search` | Visibility in search |

Changes here require: E2E test update + explicit RC sign-off.

---

## Release checklist (API contract)

- [ ] OpenAPI diff reviewed — **0 deletions** on required fields for mobile-used operations
- [ ] Orval regen committed with typecheck green
- [ ] `pnpm --filter @workspace/api-server test` green (295+ tests)
- [ ] Staging smoke includes upload + listing if upload/listing spec touched
- [ ] If breaking change unavoidable: plan `/v2` + deprecation window (not needed for current launch)

---

## Version bump policy

| Change | `info.version` in OpenAPI | URL |
|--------|---------------------------|-----|
| Additive endpoints/fields | Patch `1.0.x` | Stay on `/v1` |
| New major API generation | `2.0.0` | Introduce `/v2` router |

Document release notes in `STATUS_REPORT.md` and tag git `v1.x.y`.

---

## References

- Website compatibility plan § OpenAPI: `audit/website/WEBSITE-SEPARATION-AND-COMPATIBILITY-PLAN.md`
- Codegen memory: `.agents/memory/banco-codegen-contract.md`
- Deploy verification curls: `release/DEPLOY_VERIFICATION.md`
