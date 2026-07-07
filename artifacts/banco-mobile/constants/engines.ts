import type {
  SearchListingsFuelType,
  SearchListingsTransmission,
  SearchListingsIndustry,
  SearchListingsOriginType,
} from "@workspace/api-client-react";

import type { Category } from "@/components/CategoryTabs";

/**
 * Filter params a single engine chip applies to the feed/search APIs. Every
 * field maps 1:1 to a real, backend-supported query param (see api-server
 * SearchService.buildAttributeConditions); an empty object is the "all" engine.
 *
 * We intentionally model ONLY filters backed by real data. There are no
 * Import / Rent / Ownership / Exclusive engines here because that data does not
 * exist yet — surfacing them would create permanently-empty sections, which we
 * never do.
 *
 * Each engine chip carries EXACTLY ONE meaningful param (besides "all"): facet
 * counts are marginal (per-value), not intersections, so a multi-param chip
 * could still resolve to zero inventory and a "data-presence" gate could not
 * honestly hide it. Keep one param per chip.
 */
export interface EngineParams {
  condition?: "new" | "used";
  payment_plan?: "installment" | "bank" | "direct" | "islamic";
  // Real-estate offer type — sale (تمليك / ownership) vs rent (إيجار).
  offer_type?: "sale" | "rent";
  property_type?: string;
  finishing_type?: string;
  compound?: boolean;
  furnished?: boolean;
  fuel_type?: SearchListingsFuelType;
  transmission?: SearchListingsTransmission;
  industry?: SearchListingsIndustry;
  origin_type?: SearchListingsOriginType;
  min_year?: number;
  max_year?: number;
}

export interface EngineDef {
  /** Stable id, used for selection state and testIDs. */
  key: string;
  /** i18n key for the chip label. */
  i18nKey: string;
  /** Real backend filter params; {} for the leading "all" engine. */
  params: EngineParams;
  /**
   * When true the chip only renders after /facets confirms it has live
   * inventory (fail-CLOSED). Core chips leave this falsy so they fail OPEN —
   * a transient facet error must never hide real, long-standing inventory.
   * New taxonomy chips (fuel / transmission) set this so they only appear when
   * the data genuinely backs them.
   */
  requiresFacet?: boolean;
}

const ALL_ENGINE: EngineDef = {
  key: "all",
  i18nKey: "home.engines.all",
  params: {},
};

// Cars: condition (new/used) + the two financing modes that actually exist in
// the data (bank_finance, sharia-compliant) + facet-gated transmission and fuel
// quick chips. "Import" is omitted (no data). Transmission/fuel chips are
// requiresFacet so they only surface when inventory backs them.
const CAR_ENGINES: EngineDef[] = [
  ALL_ENGINE,
  { key: "new", i18nKey: "home.engines.new", params: { condition: "new" } },
  { key: "used", i18nKey: "home.engines.used", params: { condition: "used" } },
  { key: "bank", i18nKey: "home.engines.bank", params: { payment_plan: "bank" } },
  {
    key: "islamic",
    i18nKey: "home.engines.islamic",
    params: { payment_plan: "islamic" },
  },
  {
    key: "automatic",
    i18nKey: "home.engines.automatic",
    params: { transmission: "automatic" },
    requiresFacet: true,
  },
  {
    key: "manual",
    i18nKey: "home.engines.manual",
    params: { transmission: "manual" },
    requiresFacet: true,
  },
  {
    key: "petrol",
    i18nKey: "home.engines.petrol",
    params: { fuel_type: "petrol" },
    requiresFacet: true,
  },
  {
    key: "diesel",
    i18nKey: "home.engines.diesel",
    params: { fuel_type: "diesel" },
    requiresFacet: true,
  },
  {
    key: "hybrid",
    i18nKey: "home.engines.hybrid",
    params: { fuel_type: "hybrid" },
    requiresFacet: true,
  },
  {
    key: "electric",
    i18nKey: "home.engines.electric",
    params: { fuel_type: "electric" },
    requiresFacet: true,
  },
];

// Real estate: the primary EG/Gulf split is offer type (تمليك sale / إيجار rent)
// — surfaced first, right after "all" (sale before rent). This is the FUNDAMENTAL
// real-estate axis (like Booking's buy/rent), so it is ALWAYS visible — not
// fail-closed — even before inventory exists: a buyer must always see that rent
// and ownership are supported, and an empty "no rentals yet" page is expected +
// honest at launch (and nudges supply). The FINE facets below (furnished, laws,
// payment plans) stay data-gated so they never offer an empty refinement.
const REAL_ESTATE_ENGINES: EngineDef[] = [
  ALL_ENGINE,
  {
    key: "sale",
    i18nKey: "home.engines.sale",
    params: { offer_type: "sale" },
  },
  {
    key: "rent",
    i18nKey: "home.engines.rent",
    params: { offer_type: "rent" },
  },
  {
    key: "villa",
    i18nKey: "home.engines.villa",
    params: { property_type: "villa" },
  },
  {
    key: "apartment",
    i18nKey: "home.engines.apartment",
    params: { property_type: "apartment" },
  },
  {
    key: "land",
    i18nKey: "home.engines.land",
    params: { property_type: "land" },
    requiresFacet: true,
  },
  {
    key: "hotel",
    i18nKey: "home.engines.hotel",
    params: { property_type: "hotel" },
    requiresFacet: true,
  },
  {
    key: "compound",
    i18nKey: "home.engines.compound",
    params: { compound: true },
  },
  {
    key: "direct",
    i18nKey: "home.engines.direct",
    params: { payment_plan: "direct" },
  },
  {
    key: "islamic",
    i18nKey: "home.engines.islamic",
    params: { payment_plan: "islamic" },
  },
  {
    key: "furnished",
    i18nKey: "home.engines.furnished",
    params: { furnished: true },
  },
];

/** Engine list for a browse category, or null when it has no engine bar. */
export function enginesForCategory(cat: Category): EngineDef[] | null {
  if (cat === "car") return CAR_ENGINES;
  if (cat === "real_estate") return REAL_ESTATE_ENGINES;
  return null;
}

/** Resolves a selected engine by key within a category (undefined if none). */
export function engineByKey(cat: Category, key: string): EngineDef | undefined {
  return enginesForCategory(cat)?.find((e) => e.key === key);
}
