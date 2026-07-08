#!/usr/bin/env node
/**
 * Local production-confidence gate — runs checks that do NOT need staging secrets.
 *
 * Usage (from repo root):
 *   node scripts/production-confidence-check.mjs
 *   node scripts/production-confidence-check.mjs --skip-typecheck
 *
 * Exit codes:
 *   0 — all executed checks passed
 *   1 — one or more checks failed
 *   2 — invalid invocation / missing repo layout
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MOBILE = path.join(ROOT, "artifacts", "banco-mobile");
const OPENAPI = path.join(ROOT, "lib", "api-spec", "openapi.yaml");

const skipTypecheck = process.argv.includes("--skip-typecheck");
const results = [];

function pass(name, detail = "ok") {
  results.push({ name, ok: true, detail });
  console.log(`[PASS] ${name}${detail !== "ok" ? `: ${detail}` : ""}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`[FAIL] ${name}: ${detail}`);
}

function run(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function checkRepoLayout() {
  for (const p of ["pnpm-workspace.yaml", "artifacts/banco-mobile/package.json", "artifacts/banco-mobile/eas.json"]) {
    if (!fs.existsSync(path.join(ROOT, p))) {
      fail("repo layout", `missing ${p}`);
      return false;
    }
  }
  pass("repo layout");
  return true;
}

function checkEasConfig() {
  try {
    const eas = readJson("artifacts/banco-mobile/eas.json");
    if (!eas.build?.preview || !eas.build?.production) {
      fail("eas.json profiles", "preview and production profiles required");
      return;
    }
    if (!eas.cli?.appVersionSource) {
      fail("eas.json cli", "appVersionSource should be set");
      return;
    }
    pass("eas.json profiles", `preview + production (${eas.cli.appVersionSource})`);
  } catch (e) {
    fail("eas.json parse", e instanceof Error ? e.message : String(e));
  }
}

function checkExpoConfig() {
  const appJson = path.join(MOBILE, "app.json");
  const appConfig = path.join(MOBILE, "app.config.ts");
  const metro = path.join(MOBILE, "metro.config.js");
  try {
    const json = JSON.parse(fs.readFileSync(appJson, "utf8"));
    if (!json.expo?.extra?.eas?.projectId) {
      fail("app.json eas projectId", "extra.eas.projectId missing");
    } else {
      pass("app.json eas projectId");
    }
    if (!json.expo?.android?.package || !json.expo?.ios?.bundleIdentifier) {
      fail("app identifiers", "android.package / ios.bundleIdentifier required");
    } else {
      pass("app identifiers");
    }
    if (!fs.existsSync(appConfig)) {
      fail("app.config.ts", "missing — expo-router origin should be dynamic");
    } else {
      pass("app.config.ts present");
    }
    if (!fs.existsSync(metro)) {
      fail("metro.config.js", "missing");
    } else {
      const metroSrc = fs.readFileSync(metro, "utf8");
      if (!metroSrc.includes("watchFolders")) {
        fail("metro monorepo", "watchFolders not configured");
      } else {
        pass("metro monorepo");
      }
    }
  } catch (e) {
    fail("expo config", e instanceof Error ? e.message : String(e));
  }
}

function checkExpoSdkAlignment() {
  try {
    const mobile = readJson("artifacts/banco-mobile/package.json");
    const expoMobile =
      mobile.devDependencies?.expo ?? mobile.dependencies?.expo ?? "";
    const root = readJson("package.json");
    const expoRoot = root.dependencies?.expo ?? root.devDependencies?.expo ?? "";
    const mobileMajor = String(expoMobile).match(/~?(\d+)/)?.[1];
    const rootMajor = String(expoRoot).match(/~?(\d+)/)?.[1];
    if (mobileMajor && rootMajor && mobileMajor !== rootMajor) {
      fail("expo SDK alignment", `mobile SDK ${mobileMajor} vs root ${rootMajor}`);
      return;
    }
    pass("expo SDK alignment", mobileMajor ? `SDK ${mobileMajor}` : "mobile expo pinned");
  } catch (e) {
    fail("expo SDK alignment", e instanceof Error ? e.message : String(e));
  }
}

function checkWorkspaceRefs() {
  try {
    const mobile = readJson("artifacts/banco-mobile/package.json");
    const deps = { ...mobile.dependencies, ...mobile.devDependencies };
    for (const [name, ver] of Object.entries(deps)) {
      if (String(ver).startsWith("workspace:")) {
        const pkgPath = path.join(ROOT, "lib", name.replace("@workspace/", ""), "package.json");
        const alt = path.join(ROOT, "artifacts", name.replace("@workspace/", ""), "package.json");
        if (!fs.existsSync(pkgPath) && !fs.existsSync(alt)) {
          fail("workspace ref", `${name} → ${ver} (package not found)`);
          return;
        }
      }
    }
    pass("workspace refs");
  } catch (e) {
    fail("workspace refs", e instanceof Error ? e.message : String(e));
  }
}

function checkOpenApi() {
  if (!fs.existsSync(OPENAPI)) {
    fail("openapi.yaml", "missing");
    return;
  }
  const text = fs.readFileSync(OPENAPI, "utf8");
  if (!text.includes("openapi:")) {
    fail("openapi.yaml", "missing openapi: header");
    return;
  }
  if (!text.includes("/v1/")) {
    fail("openapi.yaml", "no /v1/ paths found");
    return;
  }
  pass("openapi.yaml structure");
}

function checkMobileTests() {
  const r = run("node", ["--test", "tests/icons.test.mjs", "tests/lib-hardening.test.mjs", "tests/mobile-resilience.test.mjs"], MOBILE);
  if (r.ok) pass("mobile regression tests", "23 tests");
  else fail("mobile regression tests", r.stderr || r.stdout || `exit ${r.status}`);
}

function checkMobileTypecheck() {
  const buildClient = run("npx", ["tsc", "-b", "../../lib/api-client-react", "--force"], MOBILE);
  if (!buildClient.ok) {
    fail("mobile typecheck (api-client-react)", (buildClient.stderr || buildClient.stdout).split("\n").slice(-5).join(" "));
    return;
  }
  const r = run("npx", ["tsc", "-p", "tsconfig.json", "--noEmit"], MOBILE);
  if (r.ok) pass("mobile typecheck");
  else fail("mobile typecheck", (r.stderr || r.stdout).split("\n").slice(-5).join(" "));
}

function checkLibsTypecheck() {
  const r = run("npx", ["tsc", "--build"], ROOT);
  if (r.ok) pass("libs typecheck");
  else fail("libs typecheck", (r.stderr || r.stdout).split("\n").slice(-5).join(" "));
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} passed ---`);
  if (failed.length) {
    console.error("\nFailed:");
    for (const f of failed) console.error(`  • ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

function main() {
  console.log("BANCO production-confidence (local, no secrets)\n");

  if (!checkRepoLayout()) {
    process.exit(2);
  }

  checkEasConfig();
  checkExpoConfig();
  checkExpoSdkAlignment();
  checkWorkspaceRefs();
  checkOpenApi();

  if (!skipTypecheck) {
    checkLibsTypecheck();
    checkMobileTypecheck();
  } else {
    console.log("[SKIP] typecheck (--skip-typecheck)");
  }

  checkMobileTests();
  summarize();
}

main();
