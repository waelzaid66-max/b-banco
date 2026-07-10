// Production-hardening regression guards for rental host + notification deep-links.
// Zero-dependency (node:test). Run with:
//   pnpm --filter @workspace/banco-mobile run test:lib

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.dirname(__dirname);
const REPO_ROOT = path.join(APP_ROOT, "..", "..");

const RENTAL_HOST = path.join(APP_ROOT, "lib", "rentalHost.ts");
const NOTIF_ROUTING = path.join(APP_ROOT, "lib", "notificationRouting.ts");
const PROFILE = path.join(APP_ROOT, "app", "(tabs)", "profile.tsx");
const LAYOUT = path.join(APP_ROOT, "app", "_layout.tsx");

test("rentalHost treats is_bookable === true as bookable", () => {
  const src = fs.readFileSync(RENTAL_HOST, "utf8");
  assert.match(
    src,
    /is_bookable\s*===\s*true/,
    "rentalHost must gate on is_bookable === true (furnished daily marketplace only)",
  );
  assert.match(
    src,
    /filterBookableListings/,
    "rentalHost must export filterBookableListings for profile hub visibility",
  );
});

test("booking notifications route hosts to /bookings?role=host", () => {
  const src = fs.readFileSync(NOTIF_ROUTING, "utf8");
  assert.match(
    src,
    /type\s*===\s*["']booking["'][\s\S]*pathname:\s*["']\/bookings["'][\s\S]*role:\s*["']host["']/,
    "booking notifications must deep-link to host booking inbox",
  );
});

test("payment and subscription notifications route to billing hub", () => {
  const src = fs.readFileSync(NOTIF_ROUTING, "utf8");
  assert.match(src, /payment_success/, "payment_success type must be handled");
  assert.match(src, /payment_failed/, "payment_failed must route to billing hub");
  assert.match(src, /subscription_expiring/, "subscription_expiring must be handled");
  assert.match(
    src,
    /return\s+["']\/billing["']\s+as\s+Href/,
    "billing-related notifications must open /billing full page",
  );
});

test("rental hub is a registered stack route", () => {
  const layout = fs.readFileSync(LAYOUT, "utf8");
  assert.match(layout, /name="rentals\/hub"/, "rentals/hub must be in root stack");
  const profile = fs.readFileSync(PROFILE, "utf8");
  assert.match(profile, /\/rentals\/hub/, "profile menu must link to rental hub");
});

test("profile Payments menu opens billing hub (wallet remains linked inside)", () => {
  const src = fs.readFileSync(PROFILE, "utf8");
  assert.match(
    src,
    /profile\.menuWallet[\s\S]*router\.push\(\s*["']\/billing["']\s+as\s+Href\s*\)/,
    "profile Payments entry must open /billing without removing /wallet screen",
  );
});

test("billing, wallet, and invoices are registered stack routes", () => {
  const src = fs.readFileSync(LAYOUT, "utf8");
  const routes = ["billing", "wallet", "invoices", "invoices/[id]"];
  for (const route of routes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      src,
      new RegExp(`name="${escaped}"`),
      `_layout.tsx must register Stack.Screen for ${route}`,
    );
  }
});

test("billing hub exposes monthly CSV export", () => {
  const src = fs.readFileSync(path.join(APP_ROOT, "app", "billing.tsx"), "utf8");
  assert.match(
    src,
    /exportBillingReportCsv/,
    "billing hub must call exportBillingReportCsv for statement export",
  );
  assert.match(src, /testID="billing-export-csv"/, "billing export control must be testable");
});

test("invoice detail exposes PDF download", () => {
  const src = fs.readFileSync(path.join(APP_ROOT, "app", "invoices", "[id].tsx"), "utf8");
  assert.match(src, /downloadInvoicePdf/, "invoice detail must support PDF export");
  assert.match(src, /testID="invoice-download-pdf"/, "invoice PDF button must be testable");
});

test("real-estate engines include facet-gated property_type chips", () => {
  const src = fs.readFileSync(
    path.join(APP_ROOT, "..", "..", "lib", "search-contract", "src", "engines.ts"),
    "utf8",
  );
  for (const key of ["duplex", "penthouse", "studio", "office", "commercial_land"]) {
    assert.match(
      src,
      new RegExp(`key:\\s*"${key}"[\\s\\S]*?requiresFacet:\\s*true`),
      `${key} engine must be facet-gated`,
    );
  }
});

test("search params wire near-me geo to API client", () => {
  const typesSrc = fs.readFileSync(
    path.join(APP_ROOT, "..", "..", "lib", "search-contract", "src", "types.ts"),
    "utf8",
  );
  const buildSrc = fs.readFileSync(
    path.join(APP_ROOT, "..", "..", "lib", "search-contract", "src", "buildSearchParams.ts"),
    "utf8",
  );
  assert.match(typesSrc, /nearMeEnabled/, "SearchCriteria must track near-me toggle");
  assert.match(buildSrc, /sp\.near_lat/, "buildSearchParams must send near_lat");
  assert.match(buildSrc, /sp\.radius_km/, "buildSearchParams must send radius_km");
});

test("search tab uses market-scoped rental taxonomy adapter", () => {
  const search = fs.readFileSync(path.join(APP_ROOT, "app", "(tabs)", "search.tsx"), "utf8");
  const sheet = fs.readFileSync(
    path.join(APP_ROOT, "components", "search", "FilterSheet.tsx"),
    "utf8",
  );
  assert.match(search, /rentalTermsForSearch/, "search tab must use searchTaxonomy adapter");
  // Country selection is a searchable sheet (not an endless MARKET_COUNTRIES chip strip).
  assert.match(search, /MarketCountryPicker/, "search tab must use MarketCountryPicker");
  assert.match(sheet, /rentalTermsForSearch/, "FilterSheet must use market-scoped rental terms");
  assert.match(sheet, /MarketCountryPicker/, "FilterSheet must use MarketCountryPicker");
  assert.match(sheet, /filter-near-me/, "FilterSheet must expose near-me control");
});

test("car import engine is wired in search-contract", () => {
  const src = fs.readFileSync(
    path.join(APP_ROOT, "..", "..", "lib", "search-contract", "src", "engines.ts"),
    "utf8",
  );
  assert.match(
    src,
    /key:\s*"import"[\s\S]*?origin_type:\s*"imported"/,
    "car import engine must map to origin_type=imported",
  );
});

test("search buttons stay isolated — no host hub / no dual fuel engines", () => {
  const search = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "search.tsx"),
    "utf8",
  );
  const discover = fs.readFileSync(
    path.join(APP_ROOT, "components", "SearchDiscover.tsx"),
    "utf8",
  );
  const engines = fs.readFileSync(
    path.join(APP_ROOT, "..", "..", "lib", "search-contract", "src", "engines.ts"),
    "utf8",
  );
  const sheet = fs.readFileSync(
    path.join(APP_ROOT, "components", "search", "FilterSheet.tsx"),
    "utf8",
  );

  // Host rental ops belong on Profile — not shopper Search chrome.
  assert.doesNotMatch(
    search,
    /search-rental-hub|\/rentals\/hub/,
    "Search must not open host rentals hub",
  );
  assert.match(
    search,
    /search-rental-/,
    "Search must keep shopper rental-term chips",
  );

  // Fuel/transmission = FilterSheet only; not car engine chips.
  assert.doesNotMatch(
    engines,
    /key:\s*"(petrol|diesel|hybrid|electric|automatic|manual)"/,
    "car engines must not duplicate fuel/transmission",
  );
  assert.match(sheet, /filter-fuel/, "FilterSheet owns fuel");
  assert.match(sheet, /filter-transmission/, "FilterSheet owns transmission");

  // Year Apply must not re-inject car years into other companies.
  assert.match(
    sheet,
    /category === "car"[\s\S]*minYear[\s\S]*maxYear|minYear: ""[\s\S]*maxYear: ""/,
    "FilterSheet Apply must gate years to car",
  );
  // Installment chrome not on facilities/materials.
  assert.match(
    sheet,
    /showPayment[\s\S]*real_estate/,
    "payment chips gated to car/RE/all",
  );

  // Car import journey entry stays on marketplace Discover; supply stays B2B.
  assert.match(discover, /discover-car-import/);
  assert.match(discover, /discover-supply-portal/);
  assert.match(discover, /onBrowseSection\("car",\s*"import"\)/);
  assert.match(discover, /\/business\/supply-hub/);

  // Import browse must latch originType like selectEngine (not engineKey alone).
  assert.match(
    search,
    /browseSection[\s\S]*origin_type[\s\S]*originType|params\.origin_type[\s\S]*originType/,
    "browseSection must sync originType for import engine",
  );

  // Facet normalize must clear dependents (no silent cross-company API filters).
  assert.match(
    search,
    /patch\.engineKey = "all"[\s\S]*originType = null/,
    "facet normalize must clear originType when dropping import engine",
  );
  assert.match(
    search,
    /patch\.engineKey = "all"[\s\S]*rentalTerm = null/,
    "facet normalize must clear rentalTerm when dropping rent engine",
  );

  // Sticky map exits on full criteriaKey (fuel/material/years included).
  assert.match(
    search,
    /criteriaMapKey = criteriaKey\(criteria\)/,
    "map exit must use full criteriaKey",
  );

  // Autocomplete scoped to active company.
  assert.match(
    search,
    /getAutocomplete\(\s*params/,
    "autocomplete must pass section-scoped params",
  );
  assert.match(
    search,
    /industrial_type.*group\.join|group\.join.*,\s*industrial_type/,
    "facilities/materials autocomplete must send industrial_type group",
  );
});

test("map HTML accepts market-country center override", () => {
  const src = fs.readFileSync(
    path.join(APP_ROOT, "components", "search", "mapHtml.ts"),
    "utf8",
  );
  assert.match(
    src,
    /function buildMapHtml\([\s\S]*center\?/,
    "buildMapHtml must accept optional center",
  );
  assert.doesNotMatch(
    src,
    /\.setView\(\[26\.8,\s*30\.8\],\s*6\)/,
    "map must not hardcode Egypt-only initial center",
  );
});

test("create taxonomy includes engine-aligned commercial property types", () => {
  const src = fs.readFileSync(
    path.join(APP_ROOT, "constants", "listingCreateTaxonomy.ts"),
    "utf8",
  );
  assert.match(src, /commercial_land/, "PROPERTY_TYPES must include commercial_land");
  assert.match(src, /warehouse/, "PROPERTY_TYPES must include warehouse");
});

test("create visible fields hide wrong cross-section questions", () => {
  const src = fs.readFileSync(
    path.join(APP_ROOT, "constants", "listingCreateTaxonomy.ts"),
    "utf8",
  );
  // No-rooms types must include warehouse + commercial_land (engine expansion).
  assert.match(
    src,
    /REAL_ESTATE_NO_ROOMS_TYPES[\s\S]*commercial_land[\s\S]*warehouse/,
    "NO_ROOMS must cover warehouse + commercial_land",
  );
  // Ownership is sale-only; rental_term is rent-only.
  assert.match(
    src,
    /offer === "rent"[\s\S]*ownership|ownership[\s\S]*offer === "rent"/,
    "ownership must be hidden when offer_type=rent",
  );
  assert.match(
    src,
    /offer !== "rent"[\s\S]*rental_term/,
    "rental_term must be hidden unless offer_type=rent",
  );
  // Raw materials must not list industry as a form field.
  assert.doesNotMatch(
    src,
    /raw_materials:\s*\[[\s\S]*?key:\s*"industry"/,
    "raw_materials SPEC_FIELDS must not include industry",
  );
});

test("search materials browse hides factory industry filter", () => {
  const filterSrc = fs.readFileSync(
    path.join(APP_ROOT, "components", "search", "FilterSheet.tsx"),
    "utf8",
  );
  const searchSrc = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "search.tsx"),
    "utf8",
  );
  assert.match(
    filterSrc,
    /showIndustry[\s\S]*raw_material/,
    "FilterSheet must gate industry away from raw_material",
  );
  assert.match(
    searchSrc,
    /type === "all" \|\| type === "raw_material"[\s\S]{0,120}industry\s*[:=]\s*null|industry\s*[:=]\s*null[\s\S]{0,120}raw_material/,
    "selectIndustrialType must clear industry on commodity browse",
  );
  assert.match(
    searchSrc,
    /CLEAR_ATTRS = CLEAR_SECTION_ATTRS|CLEAR_SECTION_ATTRS/,
    "mobile must use shared CLEAR_SECTION_ATTRS",
  );
  // Rent regime is rent-engine only (not "anything except sale").
  assert.match(
    searchSrc,
    /offer_type ===\s*"rent"/,
    "rental chrome must require explicit rent engine",
  );
  assert.match(
    filterSrc,
    /offer_type ===\s*"rent"/,
    "FilterSheet rental terms must require rent engine",
  );
  // Facilities must not own origin chrome; materials does.
  assert.match(
    searchSrc,
    /showOriginChrome\s*=\s*criteria\.category === "materials"/,
    "origin chrome is materials-company only",
  );
  assert.match(
    filterSrc,
    /showOrigin\s*=\s*criteria\.category === "materials"/,
    "FilterSheet origin is materials-company only",
  );
  assert.match(
    filterSrc,
    /showMaterial[\s\S]*filter-material|testPrefix="filter-material"/,
    "FilterSheet must expose commodity material chips",
  );
});

test("searchParams is a thin re-export from @workspace/search-contract", () => {
  const src = fs.readFileSync(path.join(APP_ROOT, "lib", "searchParams.ts"), "utf8");
  assert.match(
    src,
    /from\s+["']@workspace\/search-contract["']/,
    "mobile searchParams must delegate to shared search-contract",
  );
  assert.doesNotMatch(
    src,
    /function\s+buildSearchParams/,
    "mobile must not duplicate buildSearchParams implementation",
  );
  assert.doesNotMatch(src, /banco-web/, "mobile searchParams must not import banco-web");
});

test("preferred market is shared between search and create publish", () => {
  const pref = fs.readFileSync(
    path.join(APP_ROOT, "lib", "marketPreference.ts"),
    "utf8",
  );
  assert.match(pref, /savePreferredMarketCountry/);
  assert.match(pref, /loadPreferredMarketCountry/);
  assert.match(pref, /normalizeMarketCountry/);

  const create = fs.readFileSync(
    path.join(APP_ROOT, "app", "listings", "create.tsx"),
    "utf8",
  );
  assert.match(
    create,
    /market_country\s*=\s*normalizeMarketCountry\(publishMarketCountry\)/,
    "create must stamp preferred market onto specs.market_country",
  );

  const search = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "search.tsx"),
    "utf8",
  );
  assert.match(
    search,
    /savePreferredMarketCountry/,
    "search must persist market country when the buyer switches market",
  );
  assert.match(
    search,
    /loadPreferredMarketCountry/,
    "search must hydrate preferred market on mount",
  );

  const home = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "index.tsx"),
    "utf8",
  );
  assert.match(
    home,
    /loadPreferredMarketCountry/,
    "home feed must hydrate preferred market",
  );
  assert.match(
    home,
    /market_country:\s*marketCountry/,
    "home getFeed calls must send market_country",
  );
});

test("map hosts prefer cluster API bookable/price over page-only enrichment", () => {
  for (const rel of [
    path.join("components", "search", "SearchResultsMap.tsx"),
    path.join("components", "search", "SearchResultsMap.web.tsx"),
  ]) {
    const src = fs.readFileSync(path.join(APP_ROOT, rel), "utf8");
    assert.match(
      src,
      /c\.is_bookable/,
      `${rel} must read is_bookable from map cluster API`,
    );
    assert.match(
      src,
      /c\.price_display/,
      `${rel} must read price_display from map cluster API`,
    );
  }
});

test("CarPicker create mode always exposes Other / custom brand", () => {
  const src = fs.readFileSync(
    path.join(APP_ROOT, "components", "CarPicker.tsx"),
    "utf8",
  );
  assert.match(
    src,
    /mode === "create"[\s\S]*customBrand|custom brand ALWAYS reachable/i,
    "create picker must keep custom brand reachable without allowlist-only UX",
  );
});

test("public listing detail loads without sign-in gate", () => {
  const listing = fs.readFileSync(
    path.join(APP_ROOT, "app", "listing", "[id].tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    listing,
    /if\s*\(\s*isLoaded\s*&&\s*!isSignedIn\s*\)/,
    "listing detail must not hard-block guests — API is public optionalAuth",
  );
  assert.match(
    listing,
    /loadListing\(\)/,
    "listing detail must fetch for guests after Clerk loads",
  );
  assert.match(
    listing,
    /\[loadListing,\s*isLoaded,\s*isSignedIn\]/,
    "listing detail must refetch after sign-in so contact_token is available",
  );
});

test("listing detail contact actions require auth and hide buyer CTAs for owners", () => {
  const listing = fs.readFileSync(
    path.join(APP_ROOT, "app", "listing", "[id].tsx"),
    "utf8",
  );
  assert.match(
    listing,
    /handleCTA[\s\S]*requireAuth/,
    "call/whatsapp handoff must gate guests via auth modal",
  );
  assert.match(
    listing,
    /openInAppChat[\s\S]*requireAuth/,
    "in-app chat must gate guests via auth modal",
  );
  assert.match(
    listing,
    /hasSeller\s*&&\s*!isOwner/,
    "buyer contact bar must not show for listing owners",
  );
  assert.doesNotMatch(
    listing,
    /catch[\s\S]*handleCTA\("chat"\)/,
    "chat failure must not silently fall back to WhatsApp via handleCTA",
  );
});

test("profile help menu opens assistant not settings duplicate", () => {
  const profile = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "profile.tsx"),
    "utf8",
  );
  assert.match(
    profile,
    /key:\s*"help"[\s\S]*router\.push\("\/assistant"\)/,
    "help & support must route to assistant",
  );
});

test("create listing submit validates steps 0-3", () => {
  const create = fs.readFileSync(
    path.join(APP_ROOT, "app", "listings", "create.tsx"),
    "utf8",
  );
  assert.match(
    create,
    /for\s*\(const s of \[0,\s*1,\s*2,\s*3\]\)/,
    "submit must validate all wizard steps including category (0)",
  );
});

test("edit listing patches contact_phones and whatsapp in specs", () => {
  const edit = fs.readFileSync(
    path.join(APP_ROOT, "app", "listings", "edit", "[id].tsx"),
    "utf8",
  );
  assert.match(
    edit,
    /contact_phones:\s*cleanPhones/,
    "edit listing must persist listing contact phones",
  );
  assert.match(
    edit,
    /whatsapp_enabled:\s*whatsappEnabled/,
    "edit listing must persist whatsapp opt-in",
  );
});

test("listing detail surfaces seller social links for buyers", () => {
  const listing = fs.readFileSync(
    path.join(APP_ROOT, "app", "listing", "[id].tsx"),
    "utf8",
  );
  const api = fs.readFileSync(
    path.join(REPO_ROOT, "artifacts", "api-server", "src", "services", "ListingService.ts"),
    "utf8",
  );
  assert.match(listing, /SellerSocialLinks/, "listing detail must render seller social chips");
  assert.match(
    api,
    /social_links:\s*sellerSocialLinks/,
    "API listing detail must attach seller social_links",
  );
});

test("browse cards open listing without requireAuth on home and search", () => {
  const home = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "index.tsx"),
    "utf8",
  );
  const search = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "search.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    home,
    /handleCardPress[\s\S]*requireAuth/,
    "home feed cards must open listing for guests",
  );
  assert.doesNotMatch(
    search,
    /handleCardPress[\s\S]*requireAuth/,
    "search result cards must open listing for guests",
  );
});

test("share URL /l/:id forwards to listing screen", () => {
  const short = path.join(APP_ROOT, "app", "l", "[id].tsx");
  assert.ok(fs.existsSync(short), "app/l/[id].tsx must exist for shared links");
  const src = fs.readFileSync(short, "utf8");
  assert.match(src, /\/listing\/\$\{id\}/, "short link must redirect to listing/[id]");
});

test("search tab uses shared parseSearchCriteriaFromUrl for nav params", () => {
  const nav = fs.readFileSync(
    path.join(APP_ROOT, "lib", "searchNavParams.ts"),
    "utf8",
  );
  const search = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "search.tsx"),
    "utf8",
  );
  assert.match(nav, /parseSearchCriteriaFromUrl/, "searchNavParams must delegate to contract parser");
  assert.match(search, /parseMobileSearchNavParams/, "search tab must use mobile nav parser");
});

test("home feed refetches when preferred market hydrates", () => {
  const home = fs.readFileSync(
    path.join(APP_ROOT, "app", "(tabs)", "index.tsx"),
    "utf8",
  );
  assert.match(
    home,
    /\[category,\s*industrialType,\s*engineKey,\s*marketCountry,\s*bootReady\]/,
    "home feed effect must wait for bootReady then depend on marketCountry",
  );
  assert.match(home, /bootReady/, "home must gate boot on language + market + session");
  assert.match(
    home,
    /loadRails,\s*bootReady\]/,
    "discovery rails must wait for bootReady (same market as main feed)",
  );
  assert.match(
    home,
    /feedRequestGenRef|railsRequestGenRef/,
    "home must invalidate stale in-flight feed/rail responses",
  );
  assert.match(
    home,
    /clerkUserLoaded/,
    "logo menu must wait for Clerk user before role-specific rows",
  );
});

test("behavior session id persists across reloads", () => {
  const session = fs.readFileSync(
    path.join(APP_ROOT, "context", "SessionContext.tsx"),
    "utf8",
  );
  assert.match(session, /loadOrCreateBehaviorSessionId/);
  assert.match(session, /sessionReady/);
  const behavior = fs.readFileSync(
    path.join(APP_ROOT, "lib", "behaviorSession.ts"),
    "utf8",
  );
  assert.match(behavior, /readBehaviorSessionIdSync/);
});

test("search seeds market from sync read on first paint", () => {
  const hook = fs.readFileSync(
    path.join(APP_ROOT, "hooks", "useSearchMiniApp.ts"),
    "utf8",
  );
  assert.match(hook, /readPreferredMarketCountrySync/);
});

test("message thread gates guests before fetching or composing", () => {
  const thread = fs.readFileSync(path.join(APP_ROOT, "app", "messages", "[id].tsx"), "utf8");
  assert.match(thread, /useAuth/, "thread must read auth state");
  assert.match(
    thread,
    /enabled:\s*!!isSignedIn\s*&&\s*!!conversationId/,
    "thread messages query must not run for guests",
  );
  assert.match(thread, /testID="thread-signin"/, "thread must offer sign-in CTA for guests");
});

test("push tap handler redirects unsigned users away from private routes", () => {
  const push = fs.readFileSync(path.join(APP_ROOT, "hooks", "usePushNotifications.tsx"), "utf8");
  const routing = fs.readFileSync(NOTIF_ROUTING, "utf8");
  assert.match(routing, /notificationRequiresAuth/, "routing must expose auth gate helper");
  assert.match(
    push,
    /notificationRequiresAuth\(dest\)/,
    "push handler must gate private destinations",
  );
  assert.match(
    push,
    /handleResponse\(r,\s*isSignedIn\s*===\s*true\)/,
    "push listener must pass signed-in state",
  );
});

test("edit listing skips price validation for buyer requests", () => {
  const edit = fs.readFileSync(
    path.join(APP_ROOT, "app", "listings", "edit", "[id].tsx"),
    "utf8",
  );
  assert.match(edit, /is_request/, "edit screen must read is_request from listing");
  assert.match(
    edit,
    /!isRequest\s*&&\s*base_price_cash\s*<=\s*0/,
    "price validation must be skipped for buyer requests",
  );
  assert.match(
    edit,
    /isRequest\s*\?\s*\{\}\s*:\s*\{\s*base_price_cash\s*\}/,
    "buyer requests must not send base_price_cash on update",
  );
});

test("explore-on-map surfaces when results have no coordinates", () => {
  const search = fs.readFileSync(path.join(APP_ROOT, "app", "(tabs)", "search.tsx"), "utf8");
  assert.match(
    search,
    /wantMap[\s\S]*search\.mapNoPins/,
    "search must alert when map intent cannot be satisfied",
  );
});

test("saved searches v1 entries upgrade to criteria v2 on load", () => {
  const session = fs.readFileSync(path.join(APP_ROOT, "context", "SessionContext.tsx"), "utf8");
  assert.match(session, /upgradeSavedSearches/, "SessionContext must upgrade legacy saved searches");
  assert.match(session, /legacyCriteriaFromSaved/, "upgrade must map v1 fields into SearchCriteria");
});

test("profile overflow menu must not steal touches from menu rows", () => {
  const profile = fs.readFileSync(PROFILE, "utf8");
  assert.doesNotMatch(
    profile,
    /showMenu[\s\S]*onStartShouldSetResponder/,
    "profile menu sheet must not use onStartShouldSetResponder (blocks Pressable rows)",
  );
  assert.match(
    profile,
    /showMenu[\s\S]*StyleSheet\.absoluteFillObject[\s\S]*menuSheet/,
    "profile menu must use sibling backdrop + sheet (touch-safe pattern)",
  );
});

test("profile card prioritizes social links over account phone", () => {
  const profile = fs.readFileSync(PROFILE, "utf8");
  assert.doesNotMatch(
    profile,
    /testID="profile-phone"/,
    "account phone must not display on the profile card — links are the public contact surface",
  );
  assert.match(profile, /testID="social-edit"/, "social link editor must stay on profile");
  assert.match(
    profile,
    /key:\s*"social"/,
    "profile completion nudge must target social links, not account phone",
  );
  assert.doesNotMatch(
    profile,
    /complete_phone|key:\s*"phone"/,
    "profile completion must not nag for account phone",
  );
});

test("profile menu routes are registered in root stack", () => {
  const layout = fs.readFileSync(LAYOUT, "utf8");
  const profile = fs.readFileSync(PROFILE, "utf8");
  const required = [
    "settings",
    "business/verification",
    "business/supply-hub",
    "rentals/hub",
    "bookings",
    "billing",
    "plans",
  ];
  for (const route of required) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      layout,
      new RegExp(`name="${escaped}"`),
      `_layout.tsx must register ${route} for profile navigation`,
    );
  }
  assert.match(profile, /menuItems/, "profile must define overflow menu items");
  assert.match(profile, /profileTabs/, "profile must define quick-link tabs");
});

test("home and promote modals use touch-safe backdrop pattern", () => {
  const index = fs.readFileSync(path.join(APP_ROOT, "app", "(tabs)", "index.tsx"), "utf8");
  const promote = fs.readFileSync(path.join(APP_ROOT, "components", "PromoteButton.tsx"), "utf8");
  const authGate = fs.readFileSync(path.join(APP_ROOT, "hooks", "useAuthGate.tsx"), "utf8");

  for (const [name, src, marker] of [
    ["logo menu", index, "showLogoMenu"],
    ["sort menu", index, "showSortMenu"],
    ["promote sheet", promote, "visible"],
    ["auth gate", authGate, "AuthGateModal"],
  ]) {
    assert.doesNotMatch(
      src,
      new RegExp(`${marker}[\\s\\S]*onStartShouldSetResponder`),
      `${name} must not use onStartShouldSetResponder`,
    );
    assert.match(
      src,
      /StyleSheet\.absoluteFillObject/,
      `${name} must use sibling absoluteFill backdrop`,
    );
  }

  assert.doesNotMatch(
    authGate,
    /onPress=\{\(e\) => e\.stopPropagation\(\)\}/,
    "auth gate must not rely on stopPropagation on nested Pressables",
  );
});

test("listing detail modals use touch-safe backdrop pattern", () => {
  const listing = fs.readFileSync(
    path.join(APP_ROOT, "app", "listing", "[id].tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    listing,
    /stopPropagation/,
    "listing detail modals must not use stopPropagation on nested Pressables",
  );
  assert.match(
    listing,
    /reportOpen[\s\S]*StyleSheet\.absoluteFillObject[\s\S]*reportSheet/,
    "report modal must use sibling backdrop + sheet",
  );
});

test("wave 9 — search exposes sale vs buy listing mode chips", () => {
  const search = fs.readFileSync(path.join(APP_ROOT, "app", "(tabs)", "search.tsx"), "utf8");
  const nav = fs.readFileSync(path.join(APP_ROOT, "lib", "searchNavParams.ts"), "utf8");
  assert.match(search, /listingMode:\s*mode/, "search must update listingMode in criteria");
  assert.match(search, /listingModeSale|listingModeBuy/, "search must render sale/buy chips");
  assert.match(nav, /listing_mode/, "mobile nav must serialize listing_mode");
});

test("wave 9 — B reaction is Potential not heart save", () => {
  const bBtn = fs.readFileSync(
    path.join(APP_ROOT, "components", "BReactionButton.tsx"),
    "utf8",
  );
  const card = fs.readFileSync(path.join(APP_ROOT, "components", "SmartAssetCard.tsx"), "utf8");
  const listing = fs.readFileSync(path.join(APP_ROOT, "app", "listing", "[id].tsx"), "utf8");
  assert.match(bBtn, /onPotential/, "BReactionButton must expose onPotential");
  assert.match(bBtn, /Banco Potential/, "B glyph must document Potential semantics");
  assert.match(card, /BReactionButton[\s\S]*onPotential/, "cards must wire Potential handler");
  assert.match(listing, /BReactionButton[\s\S]*onPotential/, "listing detail must wire Potential");
});

test("wave 9 — profile menu exposes saved and notifications without duplicate edit CTA", () => {
  const profile = fs.readFileSync(PROFILE, "utf8");
  assert.match(profile, /key:\s*"saved"/, "overflow menu must include saved searches");
  assert.match(profile, /key:\s*"activity"/, "overflow menu must include notifications");
  assert.match(profile, /key:\s*"edit"/, "edit profile must live in overflow menu");
  assert.doesNotMatch(
    profile,
    /testID="profile-edit"/,
    "duplicate avatar edit button must stay removed",
  );
});

test("wave 9 — messenger RTL send icon and viewer close placement", () => {
  const thread = fs.readFileSync(path.join(APP_ROOT, "app", "messages", "[id].tsx"), "utf8");
  assert.match(thread, /scaleX:\s*-1/, "send icon must mirror in RTL");
  assert.match(
    thread,
    /isRTL\s*\?\s*\{\s*left:\s*16\s*\}\s*:\s*\{\s*right:\s*16\s*\}/,
    "image viewer close must flip horizontal side in RTL",
  );
});

test("wave 9 — create listing reverse-geocodes GPS when label empty", () => {
  const create = fs.readFileSync(path.join(APP_ROOT, "app", "listings", "create.tsx"), "utf8");
  assert.match(create, /reverseGeocodeAsync/, "create must reverse-geocode captured coordinates");
});

test("wave 9 — web map bookable chrome gated to real_estate only", () => {
  const webMap = fs.readFileSync(
    path.join(APP_ROOT, "components", "search", "SearchResultsMap.web.tsx"),
    "utf8",
  );
  assert.match(
    webMap,
    /criteria\.category\s*===\s*"real_estate"/,
    "web map must gate bookable pin chrome to real_estate",
  );
});

test("media — profile cover uses rationale + verify before promote", () => {
  const profile = fs.readFileSync(PROFILE, "utf8");
  assert.match(profile, /showCoverRationale/, "cover picker must show disclosure modal");
  assert.match(profile, /verifyUploadWithRetry/, "cover upload must verify storage before promote");
  assert.match(profile, /uploadErrorMessageKey/, "cover failures must map to upload i18n keys");
});

test("media — client preview URL never uses raw media[0]", () => {
  const session = fs.readFileSync(
    path.join(APP_ROOT, "context", "SessionContext.tsx"),
    "utf8",
  );
  const detail = fs.readFileSync(path.join(APP_ROOT, "app", "listing", "[id].tsx"), "utf8");
  assert.match(session, /pickListingPreviewUrl/, "SessionContext must pick image-safe preview");
  assert.match(detail, /pickListingPreviewUrl/, "listing detail save must pick image-safe preview");
  assert.doesNotMatch(session, /media\?\.\[0\]\?\.url/, "SessionContext must not use media[0] URL");
});

test("media — server feed thumbnail helper is wired in SearchService", () => {
  const search = fs.readFileSync(
    path.join(REPO_ROOT, "artifacts", "api-server", "src", "services", "SearchService.ts"),
    "utf8",
  );
  assert.match(search, /pickListingThumbnailUrl/, "enrichListings must use shared thumbnail picker");
  assert.match(search, /sortListingMedia/, "enrichListings must sort media before thumbnail pick");
});

test("assistant — industrial search maps to facilities + wallet/billing routes", () => {
  const assistant = fs.readFileSync(
    path.join(APP_ROOT, "app", "assistant.tsx"),
    "utf8",
  );
  assert.match(assistant, /assistantSearchCategory/);
  assert.match(assistant, /raw === "industrial"/);
  assert.match(assistant, /wallet:/);
  assert.match(assistant, /billing:/);
  const aiService = fs.readFileSync(
    path.join(REPO_ROOT, "artifacts", "api-server", "src", "services", "AiAssistantService.ts"),
    "utf8",
  );
  assert.match(aiService, /"billing"/);
  assert.match(aiService, /"rentals"/);
  assert.match(aiService, /"supply_hub"/);
});

test("notifications — foreground push refreshes in-app feed query", () => {
  const push = fs.readFileSync(
    path.join(APP_ROOT, "hooks", "usePushNotifications.tsx"),
    "utf8",
  );
  assert.match(push, /addNotificationReceivedListener/);
  assert.match(push, /getListNotificationsQueryKey/);
  assert.match(push, /invalidateQueries/);
});
