# Known Limitations (RC)

Honest list of what is NOT fully certified from the repo, and why. None are code defects that block a build; all are environment/device items.

| # | Limitation | Why | Owner action |
|---|---|---|---|
| 1 | AI assistant needs a key | code correct; default model auto‑selects for the active backend | set `OPENAI_API_KEY` in Replit Secrets |
| 2 | OTP email delivery | Clerk sends the code; needs the method enabled in Clerk | enable Email code in Clerk dashboard |
| 3 | Google / Apple sign‑in | providers must be enabled + credentialed | Clerk dashboard OAuth setup |
| 4 | Transactional email (welcome/leads) | falls back to log‑only without a key | set `RESEND_API_KEY` + verified sender |
| 5 | Payments live | sandbox by default | `PAYMOB_MODE=live` + real secret/HMAC/integration IDs |
| 6 | Image upload / GPS / push | require a physical device + prod Object Storage | on‑device QA |
| 7 | Local Windows web build | missing `lightningcss.win32-x64-msvc.node` native binary | build on Linux/CI/Replit (already green there) |
| 8 | Reference/insights data | tables ship empty until seeded | run `push-force` + `seed:reference` + `backfill:observations` on deploy |
| 9 | Enterprise account type | exists in enum; not self‑serve onboarding | admin‑assigned by design |

## Deliberate scope boundaries (RC)
- No new features added; the comprehensive website (#21) and reference world‑expansion data remain planned, additive, and out of RC scope.
- No redesign; UI audited for correctness only.
