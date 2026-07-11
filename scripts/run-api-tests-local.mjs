#!/usr/bin/env node
/**
 * Run the full api-server Vitest suite against a local Postgres (same as CI).
 *
 * Usage (repo root):
 *   node scripts/run-api-tests-local.mjs
 *
 * Requires Docker for auto-provision, or set DATABASE_URL yourself.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL =
  "postgresql://postgres:postgres@127.0.0.1:5433/banco_test";

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function dockerAvailable() {
  const r = spawnSync("docker", ["info"], { encoding: "utf8", stdio: "ignore" });
  return r.status === 0;
}

function main() {
  let databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    if (!dockerAvailable()) {
      console.error(
        "DATABASE_URL is unset and Docker is unavailable.\n" +
          "Either install Docker and re-run, or set:\n" +
          `  DATABASE_URL=${DEFAULT_URL}\n` +
          "after starting Postgres (see docker-compose.test.yml).",
      );
      process.exit(2);
    }
    console.log("Starting test Postgres (docker-compose.test.yml)…");
    run("docker", ["compose", "-f", "docker-compose.test.yml", "up", "-d", "--wait"]);
    databaseUrl = DEFAULT_URL;
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl, TZ: "UTC" };

  console.log("\nPushing schema…");
  run("pnpm", ["--filter", "@workspace/db", "run", "push-force"], env);

  console.log("\nSeeding reference data…");
  run("pnpm", ["--filter", "@workspace/api-server", "run", "seed"], env);

  console.log("\nRunning api-server tests…");
  run("pnpm", ["--filter", "@workspace/api-server", "run", "test"], env);

  console.log("\n[PASS] api-server integration suite");
}

main();
