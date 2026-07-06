# 05 — Security Review

## ✅ RESOLVED (was the only blocker) — S1

### S1. Object storage on AWS → S3 adapter **IMPLEMENTED**
`src/lib/objectStorage.ts` (Replit/GCS sidecar) no longer blocks AWS. An **S3
backend** now ships behind a provider switch:
- `src/lib/objectStorageProvider.ts` — `getObjectStorageService()` factory +
  `ObjectStorage` interface. Default = Replit (unchanged); `OBJECT_STORAGE_PROVIDER=s3` = S3.
- `src/lib/objectStorage.s3.ts` — `S3ObjectStorageService` on AWS SDK v3. Single
  bucket (`S3_BUCKET`); `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` become
  key prefixes. ACL stored as `x-amz-meta-acl-policy` JSON, updated via self-
  CopyObject (REPLACE, content-type preserved). Presigned PUT uploads; access rule
  mirrors `canAccessObject` (public-read | owner). Credentials from the default
  chain → **EC2/ECS IAM role, no static keys**.
- The 4 callers were wired through the factory; behaviour is identical when the
  var is unset.
- **Verified:** api typecheck 0; `objectStorage.s3.test.ts` (7 cases); full backend
  suite **272 pass / 3 skip / 0 fail**.
- **Set at deploy time:** `OBJECT_STORAGE_PROVIDER=s3`, `AWS_REGION`, `S3_BUCKET`,
  `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` + an IAM role scoped to the
  bucket. Integration against the real bucket is validated on first deploy.

## 🟠 Must verify at deploy time

| ID | Item | Status / action |
|---|---|---|
| S2 | **Secrets in git** | ✅ none found. Keep secrets in SSM SecureString; the compose env-file is rendered at deploy (chmod 600) and git-ignored. |
| S3 | **HTTPS everywhere** | Terminate TLS at ALB/CloudFront (ACM) or Nginx (certbot). Redirect 80→443. Never serve the API over plain HTTP in prod. |
| S4 | **Clerk keys** | Use `sk_live`/`pk_live` in production (the copy currently uses test keys for trials). Verify webhook/JWKS reachability. |
| S5 | **Paymob webhook** | `PAYMOB_HMAC_SECRET` set; the API verifies HMAC. Expose only the webhook path; keep `PAYMOB_MODE=live` only in prod. |
| S6 | **Payment config encryption** | `PAYMENT_CONFIG_ENCRYPTION_KEY` (32 bytes) — distinct per environment; rotating it invalidates stored provider config. |
| S7 | **IAM least privilege** | Instance role: S3 scoped to the one bucket, SSM read on `/banco/prod/*`, CloudWatch Logs put only. No `*` policies. |
| S8 | **Security groups** | DB reachable ONLY from the app SG; app port ONLY from the web/Nginx SG; 80/443 public. No 5432/8080 open to the world. |
| S9 | **CORS** | Set `CORS_ALLOWED_ORIGINS` to the exact prod origins. Do NOT rely on the Replit-domain fallback on AWS. |

## 🟢 Already good (verified in source)

- **Helmet** security headers on the API; Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- **Rate limiting** middleware applied per route (public vs write limiters).
- **CORS** is an allowlist (credentialed), not `*`.
- **Readiness** returns 503 when the DB is down (LB stops routing) — no traffic to a broken instance.
- **Global crash capture**: unhandled rejection logged (non-fatal), uncaught exception reported then clean exit for orchestrator restart.
- **No secrets logged**; payment provider config encrypted at rest.
- **Container** runs as a non-root user (uid 10001), `tini` for signal handling.
- **Body size** capped (Nginx 60m + API media guard) to bound upload abuse.
