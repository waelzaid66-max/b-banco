# Changelog

## [Unreleased] — Release Candidate (2026‑07‑04)

### Added (additive, isolated — pre‑RC)
- Global geographic / real‑estate **reference dataset** (standalone tables
  `reference_places`, `reference_developers`, `pending_locations`) + Egypt seed
  (15 developers, 169 places). Powers search/autocomplete/ranking; no live table
  touched.
- **Deal‑Rating engine**: `price_observations` ledger + `MarketInsightsService`
  (price history, market insights, deal rating). Records real price points
  best‑effort/post‑commit on publish & sale — never blocks a trade; never
  fabricates (returns `insufficient_data` below a real‑sample threshold).
- `backfill:observations` and `seed:reference` scripts.

### Fixed
- **AI assistant** defaulted to a Replit‑only model (`gpt-5.4`) that 404s on a
  direct OpenAI key → now backend‑aware (`gpt-4o-mini` for direct keys); works
  with only `OPENAI_API_KEY`.
- **Test determinism:** pinned vitest to `TZ=UTC` — fixed a local‑only newest‑sort
  pagination flake (`timestamp without time zone` off‑UTC). Production (UTC) was
  always correct.

### Docs
- Added `/release` audit set: FINAL_AUDIT, BUILD_REPORT, TEST_REPORT,
  SECURITY_REPORT, UPLOAD_AUDIT, USER_JOURNEY_REPORT, PERFORMANCE_REPORT,
  KNOWN_LIMITATIONS, RELEASE_CHECKLIST, DEPLOYMENT, CHANGELOG.
- Earlier: `RELEASE_AUDIT.md` (root) from the first release audit pass.

### Completed earlier (context)
Admin Control i18n 100% (17/17, AR/EN + RTL) · map + Booking‑style rent search ·
B‑OOM reaction · Profiles 2.0 · supply section · messenger (reactions/replies/
images) · deploy boot resilience · shared taxonomy · dealer‑os fixes.

### Not in RC scope (planned, additive)
- Deal‑Rating **read endpoint + listing‑card chip** (UI surface).
- Reference dataset **Middle‑East / world** data + suggestion endpoint.
- Comprehensive **website** (#21).
