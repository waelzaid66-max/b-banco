# User Journey Report (RC)

Journeys reviewed end‑to‑end (not screen‑by‑screen). ✅ = wired & complete in code · 🔧 = needs env config · 📱 = needs on‑device QA.

## Core journey
Guest → Sign up (email+password) → **OTP (email_code)** → Home → Search → Filters → Listing → Profile → Publish → Edit → Mark sold/Delete → Chat → Notifications → Settings → Logout.

| Step | State | Notes |
|---|---|---|
| Sign up / sign in | ✅ | `app/(tabs)/profile.tsx` — Clerk `useSignUp`/`useSignIn`; field errors surface reactively |
| OTP verify | ✅ code / 🔧 delivery | `verifyEmailCode`; error shown via `signUpErrors.fields.code`. Delivery is Clerk‑configured (not Resend) |
| Google / Apple | ✅ code / 🔧 config | `useSSO` `oauth_google`/`oauth_apple`; providers enabled in Clerk dashboard |
| Home / Search / Filters | ✅ | feed + search share one filter pipeline; keyset pagination |
| Listing detail | ✅ | route `/listing/[id]` present |
| Publish listing | ✅ 📱 | 2‑page create; image byte‑path needs device QA (Object Storage) |
| Edit / mark sold / delete | ✅ | `updateListing`; sale now also records a market price point (best‑effort) |
| Chat | ✅ | reactions, replies, image attach, emoji strip |
| Notifications | ✅ | badge + Arabic |
| Settings | ✅ | fully i18n; password/email change, sessions, biometric, delete‑account (re‑auth required) |
| Logout | ✅ | confirm dialog |

## Account types (`user_role`)
- **individual · dealer · company** — self‑selected post‑signup (`chooseAccountType`); dealer/company route into `/business/onboarding`.
- **enterprise** — exists in the enum; assigned server‑side/admin, not self‑select (by design). *If a self‑serve enterprise path is wanted later, it is additive.*
- **staff roles** (owner/admin/moderator/support) — separate axis, drive Admin Control Center RBAC.

## Business journeys
Onboarding → Verification (KYC) → Supply Hub → RFQ (create/inbox) → Suppliers → Global Supply → Investments → Company profile. All routes present and wired.

## Known per‑journey gaps
- OTP/OAuth **delivery** depends on Clerk dashboard config (env, not code).
- Image upload / GPS / push need a real device to fully certify (📱).
