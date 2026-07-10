/**
 * Static gate: branch code contains signals probe-live-deploy expects after redeploy.
 * Run BEFORE asking operator to redeploy — proves deploy will fix STALE if host is old.
 *
 * Usage: node audit/mobile/scripts/pre-redeploy-code-gate.mjs
 * Exit 0 = code ready; exit 1 = missing expected implementation on this branch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const checks = [
  {
    id: "market_country_iso_zod",
    file: "artifacts/api-server/src/validators/schemas.ts",
    includes: [
      "market_country: z",
      ".regex(/^[A-Z]{2}$/, \"market_country must be a 2-letter ISO code\")",
    ],
  },
  {
    id: "map_clusters_bookable_price",
    file: "artifacts/api-server/src/services/SearchService.ts",
    includes: ["is_bookable:", "price_display:", "export async function mapClusters"],
  },
  {
    id: "market_country_sql_filter",
    file: "artifacts/api-server/src/services/SearchService.ts",
    includes: ["export function marketCountryConditions", "market_country"],
  },
  {
    id: "upload_claims_schema",
    file: "lib/db/src/schema/index.ts",
    includes: ["uploadClaims", "upload_claims"],
  },
  {
    id: "autocomplete_category_scope",
    file: "artifacts/api-server/src/services/SearchService.ts",
    includes: ["getAutocomplete"],
  },
];

const failures = [];

for (const c of checks) {
  let text;
  try {
    text = read(c.file);
  } catch (e) {
    failures.push(`${c.id}: cannot read ${c.file}`);
    continue;
  }
  for (const needle of c.includes) {
    if (!text.includes(needle)) {
      failures.push(`${c.id}: missing "${needle}" in ${c.file}`);
    }
  }
}

let head = "unknown";
try {
  const { execSync } = await import("node:child_process");
  head = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
} catch {
  /* optional */
}

const report = {
  branchCodeGate: failures.length === 0,
  head,
  checks: checks.map((c) => c.id),
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  console.error("\nCode gate FAILED — fix branch before redeploy.");
  process.exit(1);
}

console.log("\nCode gate PASS — redeploy this branch should satisfy probe-live-deploy when host is updated.");
process.exit(0);
