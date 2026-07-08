# Monorepo Package Guide — BANCO Store

**Last updated:** 2026-07-08  
**Package manager:** pnpm 11.9.0 (`packageManager` in root `package.json`)

---

## Layout

```
BANCO-CA-OOM/
├── package.json              # workspace root scripts (typecheck, lint)
├── pnpm-workspace.yaml       # artifacts/*, lib/*, scripts
├── artifacts/
│   ├── banco-mobile/         # @workspace/banco-mobile (Expo)
│   ├── api-server/           # @workspace/api-server
│   ├── admin-os/             # @workspace/admin-os
│   ├── dealer-os/            # @workspace/dealer-os
│   └── landing/              # @workspace/landing
├── lib/
│   ├── api-client-react/     # @workspace/api-client-react ← mobile + web
│   ├── api-zod/
│   ├── api-spec/             # openapi.yaml (contract source)
│   ├── db/
│   └── taxonomy/             # @workspace/taxonomy ← mobile search
└── scripts/                  # @workspace/scripts (smoke, confidence)
```

There is **no** `turbo.json` — orchestration is via pnpm filters and GitHub Actions CI.

---

## Dependency boundaries

| Package | May import | Must NOT import |
|---------|------------|-----------------|
| `banco-mobile` | `@workspace/api-client-react`, `@workspace/taxonomy` | `api-server`, `db`, server-only libs |
| `api-server` | `@workspace/db`, `@workspace/api-zod`, integrations | React, Expo |
| `admin-os` / `dealer-os` / `landing` | `@workspace/api-client-react` | Expo native modules |
| `lib/*` | Other `lib/*` only | `artifacts/*` apps |

Mobile resolves workspace packages at **Metro bundling** time via `metro.config.js` (`watchFolders` → monorepo root).

---

## Mobile workspace resolution

```javascript
// artifacts/banco-mobile/metro.config.js
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;
```

Typecheck path (no Metro):

```bash
pnpm --filter @workspace/banco-mobile run typecheck
# → tsc -b ../../lib/api-client-react && tsc -p tsconfig.json
```

---

## pnpm catalog & overrides

Shared versions live in `pnpm-workspace.yaml` → `catalog:` (React 19.1.0, TanStack Query, Zod, etc.).

Critical overrides:

- `@expo/vector-icons: 15.0.3` (exact) — prevents Android tofu icons
- Platform-specific native binaries pruned (`esbuild>`, `@tailwindcss/oxide>`, etc.) for smaller installs on Windows

---

## Install commands

### Linux / macOS / Git Bash (recommended)

```bash
corepack enable
pnpm install --frozen-lockfile
```

### Windows PowerShell — preinstall `sh` issue

Root `preinstall` runs `sh -c '…'` to reject npm/yarn and delete stray lockfiles. **Native PowerShell has no `sh`** unless Git Bash or WSL is on PATH.

**Workarounds (pick one):**

1. **Git Bash** (preferred on Windows):
   ```bash
   cd /c/Users/you/BANCO-CA-OOM
   pnpm install --frozen-lockfile
   ```

2. **WSL:**
   ```bash
   cd ~/BANCO-CA-OOM
   pnpm install --frozen-lockfile
   ```

3. **CI is source of truth:** GitHub Actions runs on Ubuntu — if local Windows install fails, rely on CI green + `node scripts/production-confidence-check.mjs` for mobile gates.

Do **not** permanently disable `preinstall` — it prevents accidental `npm install` lockfile drift.

---

## Common scripts

| Command | Purpose |
|---------|---------|
| `pnpm run typecheck` | All libs + artifacts + scripts |
| `pnpm --filter @workspace/banco-mobile run test` | 23 mobile regression tests |
| `pnpm --filter @workspace/banco-mobile run typecheck` | Mobile + api-client-react |
| `node scripts/production-confidence-check.mjs` | Local production gate (no secrets) |
| `node scripts/staging-p0-smoke.mjs` | Staging API smoke (needs URL + Clerk JWT) |

---

## EAS build from monorepo

EAS uploads the mobile app directory; workspace deps must resolve via Metro + pnpm hoisting:

```powershell
cd artifacts/banco-mobile
npx eas build --platform android --profile preview
```

Ensure `pnpm install` ran at **repo root** so `lib/api-client-react` exists and is linked.

---

## Duplicate React guard

Mobile uses `react: catalog:` → `19.1.0`. Root does not declare React as a runtime dep (removed to avoid hoisting confusion). If EAS reports duplicate React:

```bash
pnpm why react
pnpm why react-native
```

Fix by aligning all packages to `catalog:` — never add a second React version in mobile-only deps.

---

## Related docs

- [EXPO-EAS-PRODUCTION-CHECKLIST.md](./EXPO-EAS-PRODUCTION-CHECKLIST.md)
- [STAGING-EAS-DEVICE-RUNBOOK.md](./STAGING-EAS-DEVICE-RUNBOOK.md)
- [STATUS_REPORT.md](../../STATUS_REPORT.md)
