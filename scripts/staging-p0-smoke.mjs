#!/usr/bin/env node
/**
 * P0-4 staging smoke — upload byte-path + health probes.
 *
 * Usage (PowerShell):
 *   $env:BANCO_API_URL="https://staging.example.com"
 *   $env:CLERK_BEARER_TOKEN="eyJ..."
 *   $env:CLERK_BEARER_TOKEN_OTHER="eyJ..."   # optional — step 7 IDOR
 *   node scripts/staging-p0-smoke.mjs
 *
 * Usage (bash):
 *   BANCO_API_URL=https://staging.example.com \
 *   CLERK_BEARER_TOKEN=eyJ... \
 *   node scripts/staging-p0-smoke.mjs
 *
 * Environment variables:
 *   BANCO_API_URL (required)     Staging API origin, no trailing slash
 *   API_URL                      Alias for BANCO_API_URL
 *   CLERK_BEARER_TOKEN           Clerk session JWT for upload steps 3–8
 *   BEARER_TOKEN                 Alias for CLERK_BEARER_TOKEN
 *   CLERK_BEARER_TOKEN_OTHER     Second user JWT for IDOR step 7 (optional)
 *
 * Exit codes:
 *   0 — all executed steps passed (health-only OK when token missing)
 *   1 — one or more steps failed
 *   2 — BANCO_API_URL / API_URL not set
 */

const API = (process.env.BANCO_API_URL || process.env.API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.CLERK_BEARER_TOKEN || process.env.BEARER_TOKEN || "";
const TOKEN_OTHER = process.env.CLERK_BEARER_TOKEN_OTHER || "";

/** Minimal 1×1 PNG */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const results = [];
let skippedAuth = false;

function fail(step, detail) {
  results.push({ step, ok: false, detail });
  console.error(`[FAIL] ${step}: ${detail}`);
}

function pass(step, detail = "ok") {
  results.push({ step, ok: true, detail });
  console.log(`[PASS] ${step}: ${detail}`);
}

async function fetchJson(path, init = {}) {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function printEnvHelp() {
  console.log(`
Required:
  BANCO_API_URL   staging API origin (e.g. https://api-staging.example.com)

Optional (upload path steps 3–8):
  CLERK_BEARER_TOKEN        primary user JWT
  CLERK_BEARER_TOKEN_OTHER  second user JWT (IDOR check)

After smoke, verify DB schema:
  DATABASE_URL=postgresql://... node scripts/verify-upload-claims-schema.mjs
`);
}

async function main() {
  if (!API) {
    console.error("Set BANCO_API_URL (or API_URL) to the staging API origin.\n");
    printEnvHelp();
    process.exit(2);
  }

  console.log(`Staging smoke → ${API}\n`);

  // Step 1 — healthz (no auth)
  {
    const { status, body } = await fetchJson("/api/healthz");
    if (status === 200 && body?.status === "ok") pass("1 healthz");
    else fail("1 healthz", `status=${status} body=${JSON.stringify(body)}`);
  }

  // Step 2 — readyz
  {
    const { status, body } = await fetchJson("/api/readyz");
    if (status === 200 && body?.status === "ok" && body?.checks?.database === "ok") {
      pass("2 readyz");
    } else {
      fail("2 readyz", `status=${status} body=${JSON.stringify(body)}`);
    }
  }

  if (!TOKEN) {
    skippedAuth = true;
    console.warn("\n[WARN] CLERK_BEARER_TOKEN not set — skipping upload steps 3–8.");
    printEnvHelp();
    summarize();
    return;
  }

  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  // Step 3 — request-url
  let servingUrl;
  let uploadUrl;
  {
    const { status, body } = await fetchJson("/api/v1/uploads/request-url", {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    const data = body?.data ?? body;
    servingUrl = data?.url;
    uploadUrl = data?.upload_url;
    if (status === 200 && servingUrl && uploadUrl) {
      pass("3 request-url", servingUrl);
    } else {
      fail("3 request-url", `status=${status} body=${JSON.stringify(body)}`);
      summarize();
      return;
    }
  }

  // Step 4 — PUT bytes
  {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: PNG_BYTES,
    });
    if (put.status === 200 || put.status === 204) pass("4 put bytes");
    else fail("4 put bytes", `status=${put.status}`);
  }

  // Step 5 — verify
  {
    const { status, body } = await fetchJson("/api/v1/uploads/verify", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ url: servingUrl }),
    });
    const ok = body?.data?.ok ?? body?.ok;
    if (status === 200 && ok) pass("5 verify");
    else fail("5 verify", `status=${status} body=${JSON.stringify(body)}`);
  }

  // Step 6 — promote (owner)
  {
    const { status, body } = await fetchJson("/api/v1/uploads/promote", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ url: servingUrl }),
    });
    const promoted = body?.data?.promoted ?? body?.promoted;
    if (status === 200 && promoted) pass("6 promote (owner)");
    else fail("6 promote (owner)", `status=${status} body=${JSON.stringify(body)}`);
  }

  // Step 7 — IDOR (other user)
  if (TOKEN_OTHER) {
    const { status } = await fetchJson("/api/v1/uploads/promote", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN_OTHER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: servingUrl }),
    });
    if (status === 403) pass("7 promote IDOR blocked");
    else fail("7 promote IDOR blocked", `expected 403 got ${status}`);
  } else {
    console.warn("[WARN] CLERK_BEARER_TOKEN_OTHER not set — skipping step 7 IDOR check.");
  }

  // Step 8 — serve object (public HEAD/GET)
  {
    const path = new URL(servingUrl).pathname;
    const { status } = await fetchJson(path);
    if (status === 200) pass("8 serve promoted object");
    else fail("8 serve promoted object", `status=${status}`);
  }

  summarize();
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  console.log(`\n--- ${passed}/${results.length} passed ---`);
  if (skippedAuth) {
    console.log("(Upload steps skipped — set CLERK_BEARER_TOKEN for full smoke.)");
  }
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
