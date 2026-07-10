/**
 * After Replit redeploy: prove FRESH, then health smoke on the same host.
 * Usage:
 *   node audit/mobile/scripts/post-redeploy-verify.mjs [baseUrl]
 *
 * Does not require Clerk JWT (health-only). For full upload smoke set
 * BANCO_API_URL + CLERK_BEARER_TOKEN and run scripts/staging-p0-smoke.mjs.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const base = (process.argv[2] || "https://banco-ca-oom.replit.app").replace(/\/$/, "");
const probe = path.join(root, "audit/mobile/scripts/probe-live-deploy.mjs");

console.log("=== post-redeploy verify ===\n");
console.log(`Host: ${base}\n`);

const probeRun = spawnSync(process.execPath, [probe, base], {
  encoding: "utf8",
  cwd: root,
});
process.stdout.write(probeRun.stdout || "");
process.stderr.write(probeRun.stderr || "");

if (probeRun.status !== 0) {
  console.log(`
STILL STALE.
On Replit Shell paste:

  git fetch origin
  git checkout fix/mobile-master-stabilize
  git pull --ff-only origin fix/mobile-master-stabilize
  pnpm install --frozen-lockfile
  pnpm --filter @workspace/db run push-force
  # Stop → Run api-server workflow

Then re-run:
  node audit/mobile/scripts/post-redeploy-verify.mjs
`);
  process.exit(2);
}

console.log("\nFRESH confirmed. Running health-only smoke on same host…\n");

const smoke = spawnSync(
  process.execPath,
  [path.join(root, "scripts/staging-p0-smoke.mjs")],
  {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      BANCO_API_URL: base,
      // Do not invent tokens — health steps only unless operator already set JWT
    },
  },
);
process.stdout.write(smoke.stdout || "");
process.stderr.write(smoke.stderr || "");

if (smoke.status && smoke.status !== 0) {
  console.log("\nHealth smoke failed — API may be up for search but not ready.");
  process.exit(smoke.status);
}

console.log(`
NEXT:
  1. Set CLERK_BEARER_TOKEN and re-run: node scripts/staging-p0-smoke.mjs
  2. DATABASE_URL → node scripts/verify-upload-claims-schema.mjs
  3. cd artifacts/banco-mobile && eas build --profile preview --platform android
  4. Device QA: audit/mobile/DEVICE-QA-SECTION-COMPANIES.md
`);
process.exit(0);
