# Test Report (RC)

**Runner:** vitest on real PostgreSQL (pinned `TZ=UTC` to match production/CI).

## Latest full run
```
Test Files  50 passed | 1 skipped (51)
Tests       255 passed | 3 skipped | 0 failed
```
- 3 skipped are intentional (environment‑gated).
- 0 failures.

## Coverage highlights (integration, on real DB)
- Listing lifecycle E2E: publish → feed/search → open → message → favorite → edit → promote → archive → republish → delete.
- Search: trigram‑accelerated title/description, filters, keyset pagination (newest tie‑boundary), map clustering.
- Deal‑Rating engine: segment‑key determinism, quartile ratings, `insufficient_data` guard, monthly history.
- Reference dataset seed (isolated DB): idempotency, fuzzy typo (`madinty`→Madinaty), Arabic substring, developer joins, ancestry.
- Bootstrap: trigram index creation is idempotent + non‑fatal.
- Payments, plans/quotas, abuse/rate limiting, admin RBAC.

## Determinism note
`timestamp without time zone` + node‑postgres compares asymmetrically off‑UTC. Tests pin `TZ=UTC` (vitest config) so results are identical on any machine and match CI/production. This fixed a **local‑only** pagination flake; production (UTC) was always correct.

## Not covered by automated tests (needs device / staging)
- Mobile UI runtime (Expo) · real upload bytes · OTP/OAuth delivery · push notifications.
