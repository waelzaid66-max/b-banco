# Phase 19–20 — App Store & Observability Readiness

**Status:** `pass_with_reservations`  
**Date:** 2026-07-08

---

## App Store / EAS (from EXPO checklist 18/22)

| Done in repo | Still OPS / SECRET |
|--------------|-------------------|
| SDK 54, eas.json preview+production, Metro monorepo, identifiers, Android 35, privacy strings | Play/Apple signing, EAS login, bake `EXPO_PUBLIC_*`, Apple Services ID, push certs |
| `release/EAS_BUILD.md`, `STORE_PUBLISHING_GUIDE.md`, staging device runbook | Actual `eas build` + submit |

## Observability
| Done | OPS |
|------|-----|
| Pino + healthz/readyz + `ERROR_ALERT_WEBHOOK` code path + tests | Set webhook URL; optional Sentry later (not required for soft launch) |
| Mobile crash seam (console) | Device confirmation |

## Code changes this phase
None.
