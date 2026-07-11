/**
 * Mobile search param layer — thin re-export from the shared contract package.
 * Behavior is defined in @workspace/search-contract; this file preserves the
 * existing `@/lib/searchParams` import path for the app and regression tests.
 */
import { DEFAULT_CRITERIA as SHARED_DEFAULT_CRITERIA } from "@workspace/search-contract";
import { DEFAULT_MARKET_COUNTRY } from "@/constants/listingCreateTaxonomy";

export {
  type SearchSort,
  type PaymentType,
  type SearchCriteria,
  hasActiveCriteria,
  criteriaKey,
  mapAnchorKey,
  buildSearchParams,
  buildMapClusterParams,
  buildSearchUrlParams,
  parseSearchCriteriaFromUrl,
  type MapViewport,
  DEFAULT_NEAR_RADIUS_KM,
  CLEAR_SECTION_ATTRS,
} from "@workspace/search-contract";

/** Mobile keeps market country aligned with listing-create taxonomy. */
export const DEFAULT_CRITERIA = {
  ...SHARED_DEFAULT_CRITERIA,
  marketCountry: DEFAULT_MARKET_COUNTRY,
};
