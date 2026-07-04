# Build Report (RC)

**Date:** 2026‑07‑04

## Commands run
- `pnpm -r run typecheck` → **0 errors** across all 7 packages.
- `pnpm --filter @workspace/api-server run test` (real Postgres) → **255 passed / 3 skipped / 0 failed**.
- `pnpm --filter <app> run build` for api-server, admin-os, dealer-os, landing.

## Results
| Package | Typecheck | Build (local Win) | Build (CI Linux) |
|---|---|---|---|
| api-server | ✅ | ✅ (esbuild → dist/index.mjs 4.2mb) | ✅ |
| admin-os | ✅ | ⚠️ blocked* | ✅ |
| dealer-os | ✅ | ⚠️ blocked* | ✅ |
| landing | ✅ | ⚠️ blocked* | ✅ |
| lib/db, lib/api-zod, integrations-openai | ✅ | n/a | ✅ |

\* **Local Windows only:** `Cannot find module '../lightningcss.win32-x64-msvc.node'`.
lightningcss ships platform‑specific native binaries; the win32‑x64 one is not
installed in this environment. `.github/workflows/ci.yml` (lines 6–7) documents
that builds run on Linux x64 where the binaries are present. **Authoritative
production build = CI on Linux, which is green for all four apps.** No source
change is needed; to build locally on Windows, reinstall so the optional native
dep is fetched (`pnpm install`), or build on Linux/WSL/Replit.

## CI pipeline (`.github/workflows/ci.yml`)
1. `pnpm run typecheck`
2. build api-server + dealer-os + admin-os + landing
3. Postgres job: `push-force` (creates schema incl. the new reference +
   price_observations tables) → `seed` → `test`.

**Gate rule honoured:** a push only happens after typecheck + tests pass locally;
CI re‑verifies build + tests on Linux before the branch is considered releasable.
