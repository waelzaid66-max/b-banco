import { useGetFacets, type FacetCounts } from "@workspace/api-client-react";

import {
  type Category,
  type IndustrialSubtype,
  apiCategoryFor,
  industrialGroupForCategory,
} from "@/components/CategoryTabs";
import { type EngineDef, enginesForCategory } from "@/constants/engines";

/** Facet counts, or undefined while loading / on error. */
export type Facets = FacetCounts | undefined;

/**
 * Live inventory facet counts used to gate browse chips so we never surface a
 * permanently-empty section ("honest by design").
 *
 * - `globalFacets` is UNSCOPED — gates the top-level category tabs. The
 *   `category` facet stays unscoped even when a category param is sent.
 * - `scopedFacets` is scoped to the active category — gates that category's
 *   engine + industrial-subtype chips, whose attribute counts are only
 *   meaningful within a single category.
 *
 * React Query dedupes the two requests when the category is unscoped ("all"),
 * so this is a single network call in the common case.
 */
export function useInventoryFacets(category: Category): {
  globalFacets: Facets;
  scopedFacets: Facets;
  loading: boolean;
} {
  const apiCat = apiCategoryFor(category);
  const globalQuery = useGetFacets();
  const scopedQuery = useGetFacets(apiCat ? { category: apiCat } : undefined);

  const globalFacets = globalQuery.data?.data;
  const scopedFacets = apiCat ? scopedQuery.data?.data : globalFacets;

  return {
    globalFacets,
    scopedFacets,
    loading: globalQuery.isLoading || scopedQuery.isLoading,
  };
}

/**
 * Categories that have live inventory. "all" always shows. car / real_estate
 * gate on the unscoped category counts. The two industrial GROUP categories
 * (facilities / materials) share the API `industrial` category, so they gate on
 * the sum of their backing `industrial_type` counts — the scoped
 * `category.industrial` count would falsely keep BOTH groups when only one has
 * data.
 *
 * Fails OPEN (returns the input unchanged) until facets load, so a transient
 * facet error never hides real inventory.
 */
export function visibleCategories(
  categories: Category[],
  globalFacets: Facets
): Category[] {
  if (!globalFacets) return categories;
  return categories.filter((cat) => {
    if (cat === "all") return true;
    const group = industrialGroupForCategory(cat);
    if (group) {
      return group.some((ty) => (globalFacets.industrial_type[ty] ?? 0) > 0);
    }
    const apiCat = apiCategoryFor(cat);
    return apiCat ? (globalFacets.category[apiCat] ?? 0) > 0 : true;
  });
}

/**
 * Industrial sub-types with live inventory within the active group. Fails OPEN
 * until scoped facets load.
 */
export function visibleIndustrialTypes(
  types: IndustrialSubtype[],
  scopedFacets: Facets
): IndustrialSubtype[] {
  if (!scopedFacets) return types;
  return types.filter((ty) => (scopedFacets.industrial_type[ty] ?? 0) > 0);
}

/**
 * Live count for an engine's single meaningful param. Engines carry exactly one
 * param (see constants/engines.ts) because facet maps are marginal per-value
 * counts, not intersections; a multi-param chip could not be honestly gated.
 * Returns 1 ("keep") for an unrecognised param so we never hide a chip we
 * cannot reason about.
 */
function engineFacetCount(params: EngineDef["params"], f: FacetCounts): number {
  if (params.condition) return f.condition[params.condition] ?? 0;
  if (params.payment_plan) return f.payment_plan[params.payment_plan] ?? 0;
  if (params.property_type) return f.property_type[params.property_type] ?? 0;
  if (params.finishing_type) {
    return f.finishing_type[params.finishing_type] ?? 0;
  }
  if (params.compound) return f.compound;
  if (params.furnished) return f.furnished;
  if (params.fuel_type) return f.fuel_type[params.fuel_type] ?? 0;
  if (params.transmission) return f.transmission[params.transmission] ?? 0;
  if (params.industry) return f.industry[params.industry] ?? 0;
  if (params.origin_type) return f.origin_type[params.origin_type] ?? 0;
  if (params.offer_type) return f.offer_type[params.offer_type] ?? 0;
  return 1;
}

/**
 * Whether an engine chip should render given the scoped facets.
 * - The "all" engine (no params) always passes.
 * - Core chips fail OPEN when facets are unavailable (a transient error must not
 *   hide long-standing inventory).
 * - `requiresFacet` chips (new taxonomy: fuel / transmission) fail CLOSED — they
 *   only appear once facets confirm real backing inventory.
 */
export function engineMatchesFacets(engine: EngineDef, facets: Facets): boolean {
  if (Object.keys(engine.params).length === 0) return true;
  if (!facets) return !engine.requiresFacet;
  return engineFacetCount(engine.params, facets) > 0;
}

/**
 * Engine chips for a category filtered to those with live inventory. Returns []
 * for categories without an engine bar. Callers should hide the row when the
 * result has <= 1 entry (only "all" left).
 */
export function visibleEngines(
  category: Category,
  scopedFacets: Facets
): EngineDef[] {
  const engines = enginesForCategory(category);
  if (!engines) return [];
  return engines.filter((engine) => engineMatchesFacets(engine, scopedFacets));
}
