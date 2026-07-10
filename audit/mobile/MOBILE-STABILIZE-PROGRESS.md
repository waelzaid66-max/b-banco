# Mobile Master Stabilize — Progress Log

Branch: `fix/mobile-master-stabilize`

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

## Latest verification (automated) — deep re-run 2026-07-10
- Full report: `FULL-DEEP-VERIFICATION-2026-07-10.md`
- Mobile `node --test`: **34/34**
- `proof-isolation` / `proof-create-fields`: **ok**
- search-contract: **33/33** (fixed stale `monthly`/facilities URL round-trip)
- `allowCommodityMaterialFilter`: **4/4**
- Live probe: **FRESH** (exit 0) — ISO reject + map bookable/price
- Staging smoke default host: **404 dead**; schema verify: **ENOTFOUND**
- CI `mobile-regression`: icons + lib + resilience + **universal-links**
- Architecture maintenance closure: `ARCHITECTURE-FILE-INDEX.md`, `pnpm run confidence` (proofs + contract)

## Reference folders
Not modified.
