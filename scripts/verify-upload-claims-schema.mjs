#!/usr/bin/env node
/**
 * P0-3 — verify upload_claims exists on staging/prod Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/verify-upload-claims-schema.mjs
 */

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to the target Postgres instance.");
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });

const REQUIRED_COLUMNS = ["object_path", "clerk_id", "expires_at", "created_at"];
const REQUIRED_INDEXES = ["upload_claims_clerk_id_idx", "upload_claims_expires_at_idx"];

try {
  await client.connect();

  const table = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'upload_claims'`,
  );
  if (table.rowCount === 0) {
    console.error("[FAIL] upload_claims table missing");
    process.exit(1);
  }

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'upload_claims'
     ORDER BY 1`,
  );
  const names = cols.rows.map((r) => r.column_name);
  for (const col of REQUIRED_COLUMNS) {
    if (!names.includes(col)) {
      console.error(`[FAIL] missing column: ${col}`);
      process.exit(1);
    }
  }

  const idx = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'upload_claims'`,
  );
  const indexNames = idx.rows.map((r) => r.indexname);
  for (const name of REQUIRED_INDEXES) {
    if (!indexNames.includes(name)) {
      console.error(`[FAIL] missing index: ${name}`);
      process.exit(1);
    }
  }

  console.log("[PASS] upload_claims table + columns + indexes verified");
} finally {
  await client.end().catch(() => {});
}
