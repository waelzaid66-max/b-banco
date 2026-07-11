import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => {
  const p = path.join(root, rel);
  // Some files only exist in certain monorepo variants; return empty string if missing.
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
};

const engines = read("lib/search-contract/src/engines.ts");
const carBlock = engines.match(/const CAR_ENGINES[\s\S]*?];/)?.[0] ?? "";
const carKeys = [...carBlock.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);

const search = read("artifacts/banco-mobile/app/(tabs)/search.tsx");
const discover = read("artifacts/banco-mobile/components/SearchDiscover.tsx");
const sheet = read("artifacts/banco-mobile/components/search/FilterSheet.tsx");
const profile = read("artifacts/banco-mobile/app/(tabs)/profile.tsx");
const apiSearch = read("artifacts/api-server/src/services/SearchService.ts");
const apiSchema = read("artifacts/api-server/src/validators/schemas.ts");
const buildSp = read("lib/search-contract/src/buildSearchParams.ts");
const contractTypes = read("lib/search-contract/src/types.ts");
const sectionTheme = read("artifacts/banco-mobile/lib/sectionTheme.ts");
const webControls = read("artifacts/banco-web/components/SearchControls.tsx");

const importIdx = discover.indexOf('testID="discover-car-import"');
const supplyIdx = discover.indexOf('testID="discover-supply-portal"');
const bizHeaderIdx = discover.indexOf("search.discover.businessHub");

const proof = {
  carEngineKeys: carKeys,
  fuelTxNotInCarEngines: !carKeys.some((k) =>
    ["petrol", "diesel", "hybrid", "electric", "automatic", "manual"].includes(k),
  ),
  searchHasHostHub: /search-rental-hub|\/rentals\/hub/.test(search),
  profileHasHostHub: /\/rentals\/hub/.test(profile),
  browseSectionSyncsOrigin: /browseSection[\s\S]{0,500}originType/.test(search),
  selectEngineNoFuelWrite:
    /Fuel\/transmission are FilterSheet-only/.test(search) &&
    !/selectEngine[\s\S]{0,350}fuelType/.test(search),
  sheetOwnsFuel: /filter-fuel/.test(sheet),
  sheetOwnsTransmission: /filter-transmission/.test(sheet),
  discoverImportBeforeBizHeader: importIdx > 0 && bizHeaderIdx > importIdx,
  discoverSupplyInBizBlock: supplyIdx > bizHeaderIdx,
  discoverHasFacetGate: /visibleEngines/.test(discover) && /showCarBrands/.test(discover),
  apiHasMarketCountryFilter: /marketCountryConditions/.test(apiSearch),
  apiMapHasBookable: /is_bookable/.test(apiSearch) && /price_display/.test(apiSearch),
  apiSchemaMarketIso2: /market_country must be a 2-letter ISO code/.test(apiSchema),
  apiSchemaMapBookable: /is_bookable: z\.boolean\(\)\.nullable\(\)/.test(apiSchema),
  // Section-company isolation (M28+)
  rentChromeRequiresRentEngine: /offer_type ===\s*"rent"/.test(search),
  sheetRentRequiresRentEngine: /offer_type ===\s*"rent"/.test(sheet),
  originChromeMaterialsOnly:
    /showOriginChrome\s*=\s*criteria\.category === "materials"/.test(search),
  sheetOriginMaterialsOnly:
    /showOrigin\s*=\s*criteria\.category === "materials"/.test(sheet),
  sheetMaterialFilter: /filter-material/.test(sheet),
  contractGatesRental: /isRentBrowse/.test(buildSp),
  contractGatesIndustry: /allowIndustry/.test(buildSp),
  contractMaterialsMaterial: /category === "materials" && c\.material/.test(buildSp),
  contractClearSectionAttrs: /CLEAR_SECTION_ATTRS/.test(contractTypes),
  mobileUsesSharedClear: /CLEAR_SECTION_ATTRS/.test(search),
  apiMaterialFilter: /specs\}->>'material'/.test(apiSearch),
  apiMaterialCategoryGate: /allowCommodityMaterialFilter/.test(apiSearch),
  apiSchemaMaterial: /material: z\.string\(\)\.trim\(\)\.max\(40\)/.test(apiSchema),
  sectionThemeTokens: /SECTION_ACCENT/.test(sectionTheme),
  // Web parity (M29) — skipped when banco-web artifact is absent from this monorepo variant
  webClearsOnCategory: !webControls || /CLEAR_SECTION_ATTRS/.test(webControls),
  webShowMaterial: !webControls || /showMaterial/.test(webControls),
  webShowOrigin: !webControls || /showOrigin/.test(webControls),
  webRentRequiresOfferType: !webControls || /offer_type ===\s*"rent"/.test(webControls),
  webMarketCountry: !webControls || /marketCountry|market_country/.test(webControls),
  webAdaptiveRentalTerms: !webControls || /rentalTermsForWebMarket/.test(webControls),
  // M31 — hub rent deep-link + feed market + facet CLEAR
  hubNewLawRent: (() => { const h = read("artifacts/banco-web/lib/hub-config.ts"); return !h || /rental_term=new_law/.test(h); })(),
  hubNoMonthlyStub: (() => { const h = read("artifacts/banco-web/lib/hub-config.ts"); return !h || !/rental_term=monthly/.test(h); })(),
  feedPassesMarket: /marketCountry:\s*query\.market_country/.test(
    read("artifacts/api-server/src/controllers/feedController.ts"),
  ),
  feedUsesMarketConditions: /marketCountryConditions/.test(
    read("artifacts/api-server/src/services/FeedService.ts"),
  ),
  facetClearsSection: /CLEAR_SECTION_ATTRS/.test(
    read("lib/search-contract/src/facets.ts"),
  ),
  homeFeedSendsMarket: /market_country:\s*marketCountry/.test(
    read("artifacts/banco-mobile/app/(tabs)/index.tsx"),
  ),
  // Strict section isolation (field/button/map)
  facetNormalizeClearsOrigin: /patch\.engineKey = "all"[\s\S]*originType = null/.test(
    search,
  ),
  facetNormalizeClearsRental: /patch\.engineKey = "all"[\s\S]*rentalTerm = null/.test(
    search,
  ),
  mapExitUsesMapAnchorKey: /mapSectionKey = mapAnchorKey\(criteria\)/.test(search),
  sheetYearsGatedToCar:
    /category === "car"[\s\S]*minYear|minYear: ""[\s\S]*maxYear: ""/.test(sheet),
  sheetPaymentGated: /showPayment[\s\S]*real_estate/.test(sheet),
  contractGatesInstallment:
    /paymentType === "installment"[\s\S]*real_estate/.test(buildSp),
  autocompleteSectionScoped: /industrial_type/.test(
    read("artifacts/api-server/src/controllers/searchController.ts"),
  ),
  mapBookableReOnly: /allowBookableChrome|category === "real_estate"/.test(
    read("artifacts/banco-mobile/components/search/SearchResultsMap.tsx"),
  ),
  discoverMapCtaSectionAware: /openSection === "car"/.test(discover),
  discoverMapPassesOpenSection: /onExploreMap\(openSection/.test(discover),
  exploreOnMapAcceptsSection: /exploreOnMap = \(section: Category\)/.test(search),
  apiSanitizesParsed: /sanitizeParsedSearchQuery/.test(
    read("artifacts/api-server/src/controllers/searchController.ts"),
  ),
  mobileAutocompleteSubtype: /criteria\.industrialType !== "all"/.test(search),
  activeFilterCountSectionGated: /rentEngineActive/.test(search),
};

const failures = Object.entries(proof)
  .filter(([k, v]) => {
    if (k === "carEngineKeys") return false;
    if (k === "searchHasHostHub") return v === true; // must be false
    return v !== true;
  })
  .map(([k]) => k);

console.log(JSON.stringify({ proof, failures, ok: failures.length === 0 }, null, 2));
if (failures.length) process.exit(1);
