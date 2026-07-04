# Performance Report (RC)

Only real‑impact items; no speculative rewrites (RC minimal‑change rule).

## Backend / DB — in place
- **GIN trigram indexes** on `listings.title` / `.description` (and now `reference_places.search_blob`, `reference_developers.search_blob`) → `ILIKE '%…%'` uses an index scan, not a seq scan, as the catalog grows. Semantics unchanged.
- **Keyset (cursor) pagination** for the feed/newest sort — constant‑time paging vs OFFSET.
- **Server‑side map clustering** (`/v1/search/map`) — grid aggregation, so a viewport returns clusters not thousands of rows.
- **Indexes** on every new reference/insights table (parent, country, type, status, segment, observed_at).
- Compression middleware; structured Pino logging; presigned uploads offload bytes to storage.
- Market‑insights recording is **post‑commit best‑effort** — zero added latency on the publish transaction.

## Mobile — observed in code
- `t()`‑based i18n with a single dictionary; no per‑render network for labels.
- React Query caching (staleTime) on feed/search.
- Reanimated GPU animations for the reaction/interaction layer.

## Recommendations (optional, post‑launch — NOT blockers)
- Add a materialised segment‑stats table only if `price_observations` grows into the millions and insight queries show latency (today they are indexed + windowed).
- Profile mobile bundle size and image cache on a physical device.

No memory/async leak or infinite‑render pattern was found in the audited paths.
