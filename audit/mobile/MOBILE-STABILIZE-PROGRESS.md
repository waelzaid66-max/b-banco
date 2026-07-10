# Mobile Master Stabilize — Progress Log

Branch: `main` (was `fix/mobile-master-stabilize` — merged)

### Wave 10 — media pipeline + home boot + assistant/notifications (2026-07-10)
| Fix | Detail |
|-----|--------|
| API | `listingMediaPreview.ts` — safe thumbnails in feed/search/detail/links |
| Mobile media | `pickListingPreviewUrl` · cover verify · shared `verifyUploadWithRetry` |
| Home | `bootReady` · sessionId persist · stale fetch gen · header/tabs pointerEvents |
| Search | market sync hydrate · `readPreferredMarketCountrySync` seed |
| Assistant | industrial→facilities · wallet/billing/rentals/supply screens on server+client |
| Push | invalidate notifications query on foreground receive + tap |
| Version | app `1.0.1` (iOS build 2 · Android versionCode 2) |
| Tests | lib-hardening **54/54** · listingMediaPreview **4/4** · ops:full-verify **PASS** |
| Report | `audit/mobile/WAVE-10-MASTER-REPORT-AR.md` |

### Wave 9 — UX/product pass (2026-07-10, `eb41fd9`)
| Fix | Detail |
|-----|--------|
| Search | Chips: الكل / بيع / شراء·مطلوب via `listing_mode` → `is_request` |
| Search contract | `@workspace/search-contract` `listingMode` in URL + API params |
| Map | Web bookable pin chrome gated to `real_estate` (parity native) |
| B button | Tap = **Potential** (`onPotential`); long-press = save + angry |
| Profile | ⋮ menu: saved + notifications; single edit entry (menu + bio) |
| Messenger | RTL send icon mirror; viewer close flips side in RTL |
| Create | GPS capture → `reverseGeocodeAsync` fills location label when empty |
| Tests | lib-hardening **47/47** (wave 9 guards), search-contract listingMode test |

### Wave 8 — contact completeness + public seller links (2026-07-10)
| Fix | Detail |
|-----|--------|
| API | `seller.social_links` on listing detail (from `user_social_links`) |
| Listing detail | `SellerSocialLinks` chips for buyers |
| Edit listing | `contact_phones` + `whatsapp_enabled` patch via specs |
| Shared | `lib/socialLinks.ts` URL + icon helpers |

### Wave 7 — contact + wizard fixes (2026-07-10)
| Fix | Detail |
|-----|--------|
| Listing detail | Guest contact CTAs → `requireAuth`; refetch on sign-in for `contact_token` |
| Listing detail | Owner footer = edit only; buyer bar hidden for `isOwner` |
| Listing detail | Chat failure shows alert (no silent WhatsApp fallback) |
| Profile | Help menu → `/assistant` (not duplicate Settings) |
| Create | Submit validates steps **0–3** (category included) |
| Rentals hub | Unit buttons disabled when listing id missing |
| Draft | Phones count toward `listingDraftHasContent` |
| Cars | Custom brand slug → title-case on draft restore |
| Tests | lib-hardening **39/39**, production-confidence **19/19** |

### Wave 6 — product truth (`1aecea5`, 2026-07-10)
| Fix | Detail |
|-----|--------|
| Profile UX | Social link chips under bio — **not** account phone on card |
| Profile edit | Phone removed from edit modal; optional at signup only |
| Completion | Nudge `social` links, not account phone |
| Cars | `carBrandFromDraftValue` restores custom brand from draft |
| Rental copy | Furnished units (Airbnb) — explicitly not hotels |
| Tests | lib-hardening **36/36** — profile social contract enforced |

## Done

### Phase 0
- Branch created
- Acceptance matrix: `audit/mobile/MOBILE-STABILIZE-ACCEPTANCE.md`

### Phase 1 (P0)
| ID | Fix |
|----|-----|
| M01 | Profile edit modal: phone + CountryCodePicker + `updateMe({ phone })` |
| M02 | Create listing: library permission Alert + Settings |
| M03/M04 | Home: no full skeleton wipe on category change (`isFirstPaint`) |
| M12 | Messenger: RTL bubble alignment + tail radii |

### Phase 2 (Search)
| ID | Fix |
|----|-----|
| M05 | Compact secondary chrome (engines + country button) |
| M06 | `MarketCountryPicker` searchable sheet (markets + world dial list) |
| M07 | Removed endless country chip ScrollViews from search + FilterSheet |
| M09 | Rent browse: rental-term chips; host hub on Profile only (M27) |
| M10 | Discover CTA → `/business/supply-hub` |
| M11 | Car `import` engine + Discover marketplace CTA (not under B2B) |
| M13 | `mapMode` resets on criteria change |
| M08 | Map initial center follows `marketCountry` |

### Phase 3
| ID | Fix |
|----|-----|
| M14 | Like/save also sends `interested` behavior signal (feed learning) |
| M15 | Assistant: richer error surfaces + more navigate screen keys |
| M16 | Notification routing: verification/business/lead fallbacks |
| M17 | Profile menu: Business & Supply + Industry hub |

### Phase 4
| ID | Fix |
|----|-----|
| M18 | Discover grid: fixed 47% cards (no flexGrow stretch) |

### Extended wave (M19–M25)
| ID | Fix |
|----|-----|
| M19 | CarPicker always-visible Other brand + custom learn path |
| M20 | Icon registry aliases + icons test |
| M21 | Discover: marketplace first; Business hub last |
| M22 | Web map clusters + near-me map key + explore keeps category |
| M23 | `market_country` filters list+map; create writes specs |
| M24 | Map clusters `is_bookable` + `price_display` |
| M25 | QUICK_BRANDS = all popular |

### Isolation + honesty (M26–M27)
| ID | Fix |
|----|-----|
| M26 | Discover engines facet-gated; car brands hide when no car inventory |
| M27 | One button = one app: host hub off Search; import under cars; fuel/tx FilterSheet-only; `browseSection` syncs `originType` |

### Section companies + material (M28–M31)
| ID | Fix |
|----|-----|
| M28 | Commodity `material` filter: API + OpenAPI + search-contract + FilterSheet chips (materials all/raw_material); rent/origin gates hardened; section accents |
| M29 | Web SearchControls parity: `CLEAR_SECTION_ATTRS` on category change; industry/origin/material chips; rent requires `offer_type=rent`; API `allowCommodityMaterialFilter` drops material on car/RE/facilities-only |
| M30 | Web `marketCountry` + adaptive rental-term catalog (`search-markets.ts`); stale agent memory on industrial_type corrected |
| M31 | Hub rent deep-link `new_law` (not dead `monthly`); feed wires `market_country`; facet category CLEAR; home/web teaser send market; dead rentalDaily/Monthly/Yearly copy removed |
| — | Docs: `SEARCH-SECTION-COMPANIES-2026-07-10.md`, `DEVICE-QA-SECTION-COMPANIES.md` |

Docs: `SEARCH-BUTTON-ISOLATION.md`, `SECTION-ISOLATION-STRICT-2026-07-10.md`, `ARCHITECTURE-FILE-INDEX.md`

### Wave 5 (user-truth pass — 2026-07-10)
| Fix | Notes |
|-----|-------|
| Search map chrome | Toggle + map surface in **results** even when page items lack coordinates (cluster API) |
| LanguageProvider | No tree render until lang hydrated; web sync read from localStorage |
| Profile rental hub | Menu item always visible (was gated on bookable listings) |
| **Profile overflow menu** | Touch-safe modal (backdrop sibling); fixes dead menu rows on device |
| PromoteButton sheet | Same touch pattern (profile listing grid) |
| Stack routes | `settings`, `business/verification`, `assistant` registered |
| AuthGate modal | Touch-safe backdrop (guest sign-up CTA no longer nested Pressable) |
| Listing modals | Report / RFQ / Apply — touch-safe (no stopPropagation) |
| FilterSheet sort | Section accent chips (not generic primary) |
| Doc | `MASTER-TRUTH-INVENTORY-AR.md`, `PROFILE-BUTTON-INVENTORY-AR.md` |

## Still open (honest)

| ID | Why |
|----|-----|
| Device QA | Checklist ready (`DEVICE-QA-SECTION-COMPANIES.md`) — **not run on device** |
| Live Replit | **FRESH** (probe 2026-07-10) — `market_country` + map `is_bookable`/`price_display` على الإنتاج |
| O16 OPS | Staging secrets / EAS / smoke — not a stabilize code reopen |
| API DB vitest | Needs `DATABASE_URL` locally — pure gate test: `allowCommodityMaterialFilter.test.ts` |
| search-contract bare `node --test` | Prefer `pnpm --filter @workspace/search-contract run test` (`tsx`) |

**Canonical next steps for store success:** `MOBILE-PUBLISH-SUCCESS-GATE.md` → **`NEXT-OPS-REPLIT-REDEPLOY.md`** (redeploy → smoke → EAS → device QA). Do not invent new code blockers.

Quick status:
```bash
node audit/mobile/scripts/ops-next-step.mjs
```

## Latest verification (automated) — 2026-07-10 (waves 6–9)

- Full report: `COMPREHENSIVE-AUDIT-2026-07-10.md`
- lib-hardening: **47/47**
- search-contract: **37/37** (incl. `listing_mode` URL round-trip)
- `pnpm run confidence -- --skip-typecheck`: **17/17**
- Live: wave 6 **FRESH**, wave 8 **STALE** — `probe-full-deploy.mjs`
- Device QA: **OPEN**

## Reference folders
Not modified.
