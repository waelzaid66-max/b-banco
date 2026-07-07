# Wave R1 — Furnished rental host hub (marketplace, isolated)

**Date:** 2026-07-07  
**Scope:** Mobile only — additive, no hotel PMS, no mixing with sale/long-term rent admin.  
**Principle:** نُضيف دون هدم — قسم الإيجار المفروش = سوق + طلبات حجز، منفصل عن باقي الأقسام.

---

## Delivered

| Item | Path | Notes |
|------|------|--------|
| Host hub | `artifacts/banco-mobile/app/rentals/hub.tsx` | Stats, bookable units, links to host/guest bookings |
| Listing edit (core fields) | `artifacts/banco-mobile/app/listings/edit/[id].tsx` | Title, description, location, price; type locked |
| Bookable filter helper | `artifacts/banco-mobile/lib/rentalHost.ts` | `is_bookable` only — no cross-section logic |
| Profile overflow menu | `app/(tabs)/profile.tsx` | My listings, rental hub (conditional), trips, help; AR/EN |
| Routes | `app/_layout.tsx` | `rentals/hub`, `listings/edit/[id]` |
| Edit entry points | `listings/mine.tsx`, `listing/[id].tsx` | Owner edit button |
| Bookings deep link | `bookings.tsx` | `?role=host` from hub + push notifications |
| Notification routing | `lib/notificationRouting.ts` | `booking` → host tab |
| Settings prefs order | `app/settings.tsx` | booking, comment, review, investment, global_supply |
| i18n | `constants/i18n.ts` | `rentals.hub.*`, `editListing.*`, profile menu keys |

---

## Explicitly out of scope (per product philosophy)

- Weekly/monthly **booking modes** as separate API flows (backend remains `furnished_daily` nightly).
- Admin/dealer rental dashboards (no PMS).
- Auto-preset on create from hub (hint text only — avoids touching create wizard).
- Hotel ops: check-in/out, housekeeping, staff.

---

## Verification (local)

```
pnpm run typecheck          → PASS (7 packages)
pnpm --filter @workspace/api-server test → 288 passed, 3 skipped
pnpm --filter banco-mobile exec tsc --noEmit → PASS
```

---

## Remaining (P1 product — next wave, not blockers)

1. Richer edit (photos, amenities, availability calendar) — needs API/UI parity review.
2. Create-flow preset: real_estate + rent + furnished_daily from hub CTA.
3. Optional host card on business profile block (visual only).

---

## Architecture note

Host hub reads `useGetMyListings` + `useListBookings({ role: "host" })`.  
Booking widget on listing detail unchanged (`BookingCard`, `furnished_daily` only).  
Sale and annual rent listings never appear in hub (`filterBookableListings`).

**Copy:** single hero line only — no competitor or hotel disclaimers in UI.
