# Observability Runbook — BANCO Store

**Status:** ⚠️ Partial — structured logging + health probes + optional webhook alerts are wired; **no Sentry/metrics dashboard** yet.

---

## What exists today

### API server — structured logging (Pino)

| Channel | File / transport | Purpose |
|---------|------------------|---------|
| Application | `artifacts/api-server/src/lib/logger.ts` → stdout + `logs/error-*.log` | General errors, bootstrap |
| Access / audit | `accessLogger` → `logs/access-*.log` | One line per HTTP request (`requestLogger`) |
| Lead events | `leadLogger` → `logs/lead-*.log` | WhatsApp/call/chat/finance leads |
| Abuse audit | `auditLogger` → `logs/audit-*.log` | Rate limits, blocked leads, shadow bans |

**Env:**

| Variable | Default | Notes |
|----------|---------|-------|
| `LOG_LEVEL` | `info` | `trace` … `error` |
| `LOG_DIR` | `./logs` | Empty → stdout only (recommended on Cloud Run / EB) |
| `NODE_ENV` | — | `production` → JSON stdout; dev → pretty |

Redaction: `authorization`, `cookie`, `set-cookie` headers stripped.

### API — error alerting

| Component | File | Behavior |
|-----------|------|----------|
| `reportError` / `reportErrorAsync` | `artifacts/api-server/src/lib/errorReporter.ts` | Always logs; optional POST to webhook |
| Express error handler | `middlewares/errorHandler.ts` | Calls `reportErrorAsync` on unhandled route errors |
| Process handlers | `artifacts/api-server/src/index.ts` | `unhandledRejection` / `uncaughtException` → log + alert |

**Env:**

```bash
ERROR_ALERT_WEBHOOK=https://hooks.slack.com/services/…   # optional
```

- 3s timeout, fire-and-forget, **never blocks requests**.
- Payload: `{ text, error, stack (capped), context, env, ts }`.

### API — health probes

| Path | Type | DB? | Expected |
|------|------|-----|----------|
| `GET /api/healthz` | Liveness | No | `200 { "status": "ok" }` |
| `GET /api/livez` | Liveness alias | No | `200 { "status": "ok" }` |
| `GET /api/readyz` | Readiness | Yes (2s cap) | `200` ok / `503` degraded |
| `GET /api/` | Platform probe | No | `200 { "status": "ok" }` |
| `GET /api/v1/health` | Versioned health | — | Routed via v1 router if present |

**Tests:** `artifacts/api-server/src/health.test.ts`  
**Staging script:** `scripts/staging-p0-smoke.mjs` steps 1–2

**Probe guidance:** LB/ALB → `/api/readyz`; container restart → `/api/healthz`.

### Mobile — client crashes

| Component | File | Behavior |
|-----------|------|----------|
| `logClientCrash` | `artifacts/banco-mobile/lib/crashLog.ts` | `console.error("[crash]", …)` |
| `installGlobalCrashHandler` | same | Wraps RN `ErrorUtils` — preserves redbox |
| Root `ErrorBoundary` | `app/_layout.tsx` | Calls `logClientCrash` on render errors |

**Gap:** No Sentry/Crashlytics SDK; crashes visible in EAS/device logs only.

### CI / staging smoke

| Script | Purpose |
|--------|---------|
| `scripts/staging-p0-smoke.mjs` | healthz + readyz + upload byte path |
| `scripts/verify-upload-claims-schema.mjs` | DB table exists |

---

## Gaps (documented, non-blocking)

| Gap | Severity | Additive fix |
|-----|----------|--------------|
| No Sentry / Datadog APM | Medium | Plug into `reportError` seam + mobile `logClientCrash` |
| No Prometheus `/metrics` | Low | Sidecar or middleware later |
| No centralized dashboard | Medium | CloudWatch (AWS) / Cloud Logging (GCP) from stdout |
| Mobile off-device crash upload | Medium | `POST /v1/client-errors` (future, optional) |
| Synthetic uptime checks | Low | External ping on `/api/readyz` |

---

## Operator setup (production)

### 1. Log shipping (pick one)

**AWS:** stdout → Docker `awslogs` driver → CloudWatch `/banco/api` (see `deploy/aws/reports/06-READINESS-CHECKLIST_GONOGO.md`).

**GCP Cloud Run:** stdout → Cloud Logging automatically.

**Optional file logs:** set `LOG_DIR=/var/log/banco` + ship with CloudWatch agent.

### 2. Alert webhook

```bash
# Slack incoming webhook example
ERROR_ALERT_WEBHOOK=https://hooks.slack.com/services/T…/B…/…
```

**Test (staging):** trigger a controlled 500 on a test route or run unit test that calls `reportError` in a one-off script — confirm message in channel.

### 3. Alarms (recommended)

| Signal | Threshold | Action |
|--------|-----------|--------|
| `/api/readyz` non-200 | 2 consecutive failures | Page on-call |
| 5xx rate | > 1% for 5 min | Webhook + investigate logs |
| RDS connections | > 80% max | Scale / pool tune |
| Disk (if `LOG_DIR` set) | > 85% | Rotate / expand |

### 4. Mobile release monitoring

- EAS build logs + TestFlight/Play internal track crash reports.
- Until Sentry: reproduce with `adb logcat` / Xcode console filtering `[crash]`.

---

## Log query hints

```bash
# Access tail (on host)
tail -f logs/access-$(date +%Y-%m-%d).log

# Error tail
tail -f logs/error-$(date +%Y-%m-%d).log

# Lead funnel
grep '"channel":"lead"' logs/lead-*.log
```

CloudWatch Logs Insights (example):

```
fields @timestamp, msg, err.message, path
| filter msg like /reportError/
| sort @timestamp desc
| limit 50
```

---

## Publish path observability

Listing create/upload/publish uses the same access + error pipeline. **No separate metrics.** To debug publish failures:

1. Filter access log for `POST /api/v1/listings`, `/api/v1/uploads/*`.
2. Check `upload_claims` via verify script if promote returns 403.
3. Run `MarketplaceLifecycle.e2e.test.ts` on staging DB clone.

**Policy:** Do not add synchronous logging or metrics in upload hot path without profiling — current design is async/best-effort for alerts only.
