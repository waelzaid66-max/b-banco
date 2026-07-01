---
name: Object storage signing identity
description: Why the Replit object-storage sidecar returns 401 for signing from ad-hoc shells, and how web uploads actually work.
---

# Object storage signing can only be exercised by the running server

The Replit object-storage sidecar (`http://127.0.0.1:1106/object-storage/signed-object-url`)
grants a signing identity **only to the workflow-managed app process**. Any process
you spawn yourself — plain `bash`, `pnpm exec tsx`, ad-hoc `vitest` — hits the sidecar
with the SAME `REPL_IDENTITY` env yet gets **HTTP 401**, even with the real bucket from
`PRIVATE_OBJECT_DIR`.

**Why:** identity is tied to the process tree the workflow launches, not to env vars your
shell inherits.

**How to apply:**
- You CANNOT write a standalone script/test that presigns an upload URL to prove the
  storage path works. A 401 from such a script is NOT evidence uploads are broken.
- To validate the real signing path, go through the running workflow server (which needs
  Clerk auth on the request-url route — there is no dev auth bypass in `authGuard.ts`).
- Trust these signals instead when a direct test is impossible: clean server logs (no
  signing errors), code following the standard Replit blueprint, and the fact that the
  same code works in the deployed server.

# Browser → GCS signed PUT works on Replit

Web uploads do a raw cross-origin `PUT` from the browser to a `storage.googleapis.com`
signed URL. This works on Replit: the standard Replit object-storage blueprint (Uppy
`@uppy/aws-s3`) does exactly browser→signed-URL PUT, so bucket CORS already permits it.
Do NOT build a server-side byte-proxy to "avoid CORS" — the direct client PUT is the
supported pattern, identical to the mobile flow.

**Web auth model:** web artifacts (dealer-os/admin-os) authenticate API calls via
same-origin session cookies through `customFetch`; `setAuthTokenGetter` (bearer) is
mobile-only. So the generated `requestUploadUrl`/`verifyUpload` functions just work from
web with no token wiring.
