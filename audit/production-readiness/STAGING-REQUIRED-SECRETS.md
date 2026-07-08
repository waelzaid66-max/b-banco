# Staging / Production — Required Secrets (no placeholder values)

**Purpose:** Exact secret inventory for Wave A (Staging Validation) and store release.  
**Rule:** Do **not** invent or paste fake values. Operator supplies real values when ready.  
**Related scripts:** `scripts/staging-p0-smoke.mjs`, `scripts/verify-upload-claims-schema.mjs`, EAS Build.

---

## A. Staging API smoke (`staging-p0-smoke.mjs`)

| Variable | Required | Used for |
|----------|----------|----------|
| `BANCO_API_URL` or `API_URL` | **Yes** | Staging API origin (HTTPS) |
| `CLERK_BEARER_TOKEN` | **Yes** for authenticated upload path | Primary user JWT |
| `CLERK_BEARER_TOKEN_OTHER` | Optional | Second user JWT (IDOR / claim isolation) |

---

## B. Database schema verify (`verify-upload-claims-schema.mjs`)

| Variable | Required | Used for |
|----------|----------|----------|
| `DATABASE_URL` | **Yes** | Postgres URL with rights to read `upload_claims` |

---

## C. API server runtime (staging / prod host)

| Variable | Required for launch | Notes |
|----------|---------------------|-------|
| `DATABASE_URL` | **Yes** | Same DB family as verify script |
| `CLERK_SECRET_KEY` | **Yes** | Server auth |
| `CLERK_PUBLISHABLE_KEY` | **Yes** | Client-capable surfaces |
| Object storage creds (`OBJECT_STORAGE_*` / S3 / GCS set used by project) | **Yes** for media | Exact names per `deploy/*/env` examples |
| `RESEND_API_KEY` | Soft launch optional / OTP email needs Yes | Email delivery |
| `OPENAI_API_KEY` | Optional | AI assistant only |
| `ERROR_ALERT_WEBHOOK` | Recommended for prod ops | Observability pillar |
| Paymob keys | **No until B5** | Keep unset / admin-disabled |

---

## D. Mobile EAS / Expo (`artifacts/banco-mobile`)

| Variable | Required | Used for |
|----------|----------|----------|
| `EXPO_PUBLIC_DOMAIN` | **Yes** for preview/prod API | API host the app calls |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Yes** | Auth |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | Optional | If using Clerk proxy |
| `EXPO_PUBLIC_ROUTER_ORIGIN` | **Yes** for store builds | Replace Replit default |
| `EXPO_PUBLIC_PUBLIC_APP_URL` | Optional | Share / marketing links |
| EAS account + project credentials | **Yes** | `eas login` / projectId already in app |
| Android keystore / Play Console | **Yes** for Play prod | Operator / EAS credentials store |
| Apple Team / certificates / ASC | **Yes** for iOS prod | Operator |
| FCM / APNs for push | **Yes** if push is in scope | Device QA |

---

## E. GitHub (local verification only)

| Item | Required to verify CI from CLI |
|------|--------------------------------|
| `gh auth login` or `GH_TOKEN` | Optional if using Actions UI in browser |

---

## F. Explicitly deferred (not required for current readiness path)

| Item | Why |
|------|-----|
| Live Paymob credentials | Admin decision B5 |
| Consumer website host secrets | Website W0+ after mobile staging confidence |
| Production destructive DR restore | Ops window only |

---

## Operator checklist (when you provide secrets)

1. Set A + B → run smoke + upload_claims verify.  
2. Set C on staging host → confirm `/api/healthz` + `/api/readyz`.  
3. Set D → `eas build --profile preview`.  
4. Device publish smoke (create → photos → publish → feed/search).  
5. Only then consider production EAS profile + store consoles.
