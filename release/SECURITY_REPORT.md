# Security Report (RC)

## Confirmed controls (in code)
- **Auth:** Clerk (`@clerk/expo` mobile, `@clerk/express` API). No home‑grown session crypto.
- **Authorization:** staff RBAC (owner/admin/moderator/support) enforced server‑side for the Admin Control Center; seller routes gated.
- **Payments:** Paymob **HMAC webhook verification**; payment provider config **encrypted at rest (AES‑256‑GCM)** in `payment_provider_config`.
- **Input validation:** Zod schemas (generated from the OpenAPI spec) on the API boundary.
- **SQL injection:** Drizzle ORM parameterised queries throughout; no string‑built SQL with user input.
- **Transport / headers:** Helmet + CORS configured; rate‑limiting middleware present.
- **Object Storage:** presigned upload URLs; media promoted to public ACL only after write.
- **Account deletion:** requires real re‑authentication (password / device auth) — not a typed keyword.

## Secret hygiene
- **No `.env` tracked;** secret scan of tracked files is clean (`sk-…`, `re_…` patterns absent).
- Production secrets live in Replit Secrets / store dashboards. A live OpenAI key was once pasted in chat and was **advised to be rotated**; it was never written to the repo.

## To verify at deploy (owner)
- Clerk secret‑key rotation policy · Object Storage bucket permissions · DB SSL on the production connection · production rate‑limit thresholds · Paymob switched to live with real HMAC secret.

## Not found (good)
- No mass‑assignment sink (inserts use explicit column maps, not raw body spread).
- No sensitive data logged (structured Pino logs; errors log `err` objects, not secrets).
