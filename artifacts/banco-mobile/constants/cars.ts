/**
 * Car taxonomy — now sourced from the shared @workspace/taxonomy package so the
 * mobile app, dealer-os and the api-server seed all share ONE definition and can
 * never drift. Kept as a thin re-export so every existing `@/constants/cars`
 * import (and constants/listingCreateTaxonomy.ts) keeps working unchanged.
 *
 * Edit the data in `lib/taxonomy/src/cars.ts`, not here.
 */
export * from "@workspace/taxonomy/cars";
