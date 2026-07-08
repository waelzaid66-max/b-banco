# Feature Flags — BANCO Store

**Status:** ⚠️ Partial — env-gated and admin-DB toggles exist; no unified `FEATURE_*` registry yet.  
**Publish safety:** All flags below default to **current production behavior when unset or OFF**. None gate listing create/upload/promote/visibility.

---

## Existing toggles (no deploy required)

These change behavior when env vars or admin config change, then **process restart** (API) or **next app session** (mobile env baked at build).

### API — environment (`[feature]` in `deploy/aws/env/.env.production.example`)

| Variable | When set | When unset / OFF | Affects publish? |
|----------|----------|------------------|------------------|
| `OPENAI_API_KEY` | AI assistant enabled | Assistant returns graceful off-state | No |
| `OPENAI_MODEL` | Model override | Default `gpt-4o-mini` | No |
| `RESEND_API_KEY` + `EMAIL_FROM` | Transactional email sent | Log-only / skipped (non-blocking) | No |
| `PAYMOB_*` keys | Payments + webhooks active | Billing UI read-only; no charge | No |
| `ERROR_ALERT_WEBHOOK` | Slack/Discord alert on 5xx path | Structured logs only | No |
| `LOG_LEVEL` | Verbosity | `info` | No |
| `LOG_DIR` | Rotating files on disk | stdout only | No |
| `PUBLIC_API_BASE_URL` / `PUBLIC_APP_URL` | Absolute links in SEO/email | Relative / derived | No |
| `ADMIN_EMAILS` | Bootstrap admin staff role | Manual admin seed only | No |
| `OBJECT_STORAGE_PROVIDER` | `s3` / `gcs` / `replit` | Defaults `replit` | **Upload path only** — same API contract; provider swap is infra |
| `CRON_TIMEZONE` | Job schedule TZ | `Africa/Cairo` | No |

**Replit-only vars** (`REPLIT_DEPLOYMENT`, `REPLIT_DOMAINS`, …): documented as **do not set on AWS/GCP** — presence changes CORS/dev behavior, not publish logic.

### API — admin database (runtime, no redeploy for value change)

| Surface | Table / service | Toggle mechanism | Publish impact |
|---------|-----------------|------------------|----------------|
| Payment provider | `payment_provider_config` via `PaymentConfigService` | Admin saves encrypted Paymob keys; env fallback | No — billing only |
| Email delivery | `EmailConfigService` + admin routes | Resend keys in DB or env | No |
| Subscription plans | `plans` via `AdminPlanService` | `active`, quotas, ranking weights, `features` JSON | No — ranking/ads only |
| Paymob live mode | `PAYMOB_MODE=test\|live` | Env + admin config | No |

Plan `features` (e.g. `analytics`, `bulk_import`) are **dealer subscription entitlements**, not global kill switches.

### Mobile — build-time (`EXPO_PUBLIC_*`)

| Variable | Purpose | Publish impact |
|----------|---------|----------------|
| `EXPO_PUBLIC_DOMAIN` | API base → `setBaseUrl(https://…)` | No — endpoint host only |
| `EXPO_PUBLIC_CLERK_*` | Auth | No |
| `EXPO_PUBLIC_PUBLIC_APP_URL` | Share links / OG | No |

Mobile has **no runtime remote flag SDK** today. Feature exposure is ship-by-build (EAS profile + env).

---

## What cannot toggle without deploy

| Item | Why |
|------|-----|
| New API routes or breaking response shapes | Requires api-server deploy + OpenAPI codegen |
| Mobile UI routes / native modules | Requires EAS build |
| Search/feed algorithm code paths | Code change + deploy |
| Drizzle schema columns | `drizzle-kit push` or boot patches |

---

## Proposed minimal pattern (additive, not implemented)

For future kill switches **without touching publish defaults**:

```typescript
// artifacts/api-server/src/lib/featureFlags.ts (PROPOSED — not wired yet)
function envBool(name: string, defaultValue = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return defaultValue;
  return v === "1" || v === "true" || v === "yes";
}

export const featureFlags = {
  /** Example: off = current behavior (near-me available) */
  NEAR_ME_ENABLED: envBool("FEATURE_NEAR_ME", true),
  /** Example: off = AI assistant hidden; on = requires OPENAI_API_KEY anyway */
  AI_ASSISTANT_UI: envBool("FEATURE_AI_ASSISTANT", true),
} as const;
```

**Rules for any new flag:**

1. Default must match **today's production behavior** (`true` = feature stays on).
2. Never use a flag to **require** a field for publish that was optional before.
3. Read env at request time or module init — no caching that survives hot reload incorrectly.
4. Document in this file and in `deploy/*/env/.env.production.example`.

---

## Verification

```bash
# Confirm optional features degrade safely with keys unset (local/staging)
unset OPENAI_API_KEY RESEND_API_KEY ERROR_ALERT_WEBHOOK
pnpm --filter @workspace/api-server test -- health.test.ts
# Listing lifecycle must still pass:
pnpm --filter @workspace/api-server test -- MarketplaceLifecycle.e2e.test.ts
```

---

## Gaps (non-blocking for launch)

- [ ] Central `featureFlags.ts` module (proposal above)
- [ ] Admin UI read-only “effective flags” panel (env + DB summary)
- [ ] Remote mobile flags (Firebase/Expo Updates) — deferred; store builds are versioned
