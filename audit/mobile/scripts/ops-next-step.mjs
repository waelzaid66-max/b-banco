/**
 * Prints the next honest step on the mobile publish path.
 * Usage: node audit/mobile/scripts/ops-next-step.mjs [baseUrl]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const base = process.argv[2] || "https://banco-ca-oom.replit.app";
const probe = path.join(root, "audit/mobile/scripts/probe-live-deploy.mjs");

const hasSmokeSecrets = Boolean(
  process.env.BANCO_API_URL || process.env.API_URL,
) && Boolean(process.env.CLERK_BEARER_TOKEN);
const hasDb = Boolean(process.env.DATABASE_URL);

console.log("=== BANCO mobile publish — next step ===\n");
console.log(`Repo root: ${root}`);
console.log(`Probe host: ${base}`);
console.log(`Smoke secrets: ${hasSmokeSecrets ? "present" : "missing"}`);
console.log(`DATABASE_URL: ${hasDb ? "present" : "missing"}`);
console.log("");

if (!existsSync(probe)) {
  console.error("Missing probe script:", probe);
  process.exit(1);
}

const result = spawnSync(process.execPath, [probe, base], {
  encoding: "utf8",
  cwd: root,
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");

const fresh = result.status === 0;

if (!fresh) {
  console.log(`
NEXT (blocking):
  1. Open audit/mobile/NEXT-OPS-REPLIT-REDEPLOY.md
  2. On Replit: checkout fix/mobile-master-stabilize (or merge) + restart API
  3. Re-run: node audit/mobile/scripts/ops-next-step.mjs
`);
  process.exit(2);
}

if (!hasSmokeSecrets) {
  console.log(`
LIVE is FRESH.
NEXT: set BANCO_API_URL + CLERK_BEARER_TOKEN, then:
  node scripts/staging-p0-smoke.mjs
`);
  process.exit(0);
}

console.log(`
LIVE is FRESH + smoke secrets present.
NEXT:
  node scripts/staging-p0-smoke.mjs
  node scripts/verify-upload-claims-schema.mjs   # needs DATABASE_URL
  cd artifacts/banco-mobile && eas build --profile preview --platform android
  Then Device QA checklists under audit/mobile/
`);
process.exit(0);
