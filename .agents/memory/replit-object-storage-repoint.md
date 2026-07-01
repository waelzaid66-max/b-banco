---
name: Replit object-storage default-bucket repoint
description: How to repoint a stuck account-managed Object Storage default bucket when the DEFAULT_OBJECT_STORAGE_BUCKET_ID secret points at a dead/foreign bucket
---

The Object Storage env trio (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`) are account-managed secrets **derived from `.replit` `[objectStorage] defaultBucketID`**. They are NOT normal env vars.

To change which bucket the app uses, edit `[objectStorage] defaultBucketID` in `.replit` — but ONLY via the sanctioned `verifyAndReplaceDotReplit({ tempFilePath })` callback (the temp file must be an **absolute path inside the workspace root**, e.g. `/home/runner/workspace/.dotreplit.tmp`). After it returns `success: true`, the managed secrets regenerate for BOTH dev and prod. Restart the (artifact-managed) api-server workflow to pick them up.

**Why:** every other path is blocked. `setEnvVars` (shared/development/production) → "already set up as secrets"; `deleteEnvVars` → no-op on the secret; `requestEnvVar` → "populated by Replit from the account, should not be requested"; `setupObjectStorage` → idempotent, ignores bucketId/force and keeps the old default; direct `.replit` edit via the edit tool → prohibited; `configureWorkflow` run-command env-prefix → prohibited ("managed by an artifact"). The GUI only offers "Add an existing bucket" (no set-default control).

**How to apply:** when uploads 500 / the object-storage sidecar returns 401 for the configured bucket but 200 for another bucket in this account, the default bucket is stale (common after importing/migrating a repl from another account). Verify a candidate bucket works at the storage layer (sidecar sign PUT→PUT→sign GET→read back, all 200), then repoint via `verifyAndReplaceDotReplit`. Validate through the real API: mint a Clerk JWT, `POST /api/v1/uploads/request-url`, confirm the returned `upload_url` contains the new bucket id, then PUT bytes (expect 200).
