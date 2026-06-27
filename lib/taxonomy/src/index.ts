/**
 * @workspace/taxonomy — single source of truth for BANCO's shared, pure-data
 * taxonomy (categories, locations, brands, spec fields, enums). Consumed by the
 * mobile app, dealer-os (Banco Market) and the api-server seed/normalization so
 * the surfaces can never drift. Pure data + pure helpers only — NO React/RN/Node
 * runtime deps — so every surface can import it directly via the "workspace"
 * resolution condition.
 *
 * Migration is incremental: modules are moved here one at a time and the old
 * locations re-export from this package to keep existing import paths working.
 */
export * from "./locations";
export * from "./cars";
