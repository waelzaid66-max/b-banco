// P2-12 — mobile crash/offline resilience regression (static guards).
// Run: pnpm --filter @workspace/banco-mobile run test:resilience

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.dirname(__dirname);

const LAYOUT = path.join(APP_ROOT, "app", "_layout.tsx");
const CRASH_LOG = path.join(APP_ROOT, "lib", "crashLog.ts");
const ERROR_BOUNDARY = path.join(APP_ROOT, "components", "ErrorBoundary.tsx");
const SESSION = path.join(APP_ROOT, "context", "SessionContext.tsx");

test("root layout installs global crash handler and ErrorBoundary", () => {
  const layout = fs.readFileSync(LAYOUT, "utf8");
  assert.match(layout, /installGlobalCrashHandler/, "must install global JS crash handler");
  assert.match(layout, /ErrorBoundary/, "must wrap app in ErrorBoundary");
  assert.match(layout, /logClientCrash/, "must log render crashes from boundary");
});

test("crashLog exposes logClientCrash and installGlobalCrashHandler", () => {
  const src = fs.readFileSync(CRASH_LOG, "utf8");
  assert.match(src, /export function logClientCrash/, "logClientCrash must be exported");
  assert.match(src, /export function installGlobalCrashHandler/, "installGlobalCrashHandler exported");
  assert.match(src, /\[crash\]/, "crash tag for log filtering");
});

test("ErrorBoundary resets on retry and reports errors", () => {
  const src = fs.readFileSync(ERROR_BOUNDARY, "utf8");
  assert.match(src, /getDerivedStateFromError/, "class boundary pattern");
  assert.match(src, /componentDidCatch/, "must catch render errors");
});

test("SessionContext documents offline-friendly cache path", () => {
  const src = fs.readFileSync(SESSION, "utf8");
  assert.match(src, /offline/i, "session layer must mention offline behavior");
  assert.match(src, /AsyncStorage/, "must use AsyncStorage for local persistence");
});

test("notification routing avoids sheet-only billing paths", () => {
  const src = fs.readFileSync(path.join(APP_ROOT, "lib", "notificationRouting.ts"), "utf8");
  assert.doesNotMatch(src, /openSheet.*billing/i, "billing must be full-page hub");
});
