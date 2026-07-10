import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchParams } from "../src/buildSearchParams.ts";
import {
  buildSearchUrlParams,
  parseSearchCriteriaFromUrl,
} from "../src/url.ts";
import { DEFAULT_CRITERIA } from "../src/types.ts";

test("buildSearchParams omits recommended sort and empty filters", () => {
  const params = buildSearchParams(DEFAULT_CRITERIA);
  assert.equal(params.sort, undefined);
  assert.equal(params.q, undefined);
  assert.equal(params.category, undefined);
  assert.equal(params.market_country, "EG");
});

test("buildSearchParams sends non-default market_country", () => {
  const params = buildSearchParams({
    ...DEFAULT_CRITERIA,
    marketCountry: "SA",
  });
  assert.equal(params.market_country, "SA");
});

test("buildSearchParams maps car category + engine chip", () => {
  const params = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "car",
    engineKey: "new",
    sort: "price_asc",
    q: "corolla",
    location: "cairo",
    minPrice: "100000",
    maxPrice: "500000",
  });
  assert.equal(params.category, "car");
  assert.equal(params.condition, "new");
  assert.equal(params.sort, "price_asc");
  assert.equal(params.q, "corolla");
  assert.equal(params.location, "cairo");
  assert.equal(params.min_price, 100000);
  assert.equal(params.max_price, 500000);
});

test("car engines are journey-only; fuel/transmission stay criteria fields", async () => {
  const { enginesForCategory } = await import("../src/engines.ts");
  const car = enginesForCategory("car");
  assert.ok(car);
  const keys = car.map((e) => e.key);
  assert.deepEqual(keys, ["all", "new", "used", "import", "bank", "islamic"]);
  assert.ok(!keys.includes("petrol"));
  assert.ok(!keys.includes("automatic"));

  const importParams = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "car",
    engineKey: "import",
  });
  assert.equal(importParams.origin_type, "imported");

  const fuelOnly = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "car",
    engineKey: "all",
    fuelType: "diesel",
    transmission: "automatic",
  });
  assert.equal(fuelOnly.fuel_type, "diesel");
  assert.equal(fuelOnly.transmission, "automatic");
  assert.equal(fuelOnly.origin_type, undefined);
});

test("buildSearchParams wires near-me geo", () => {
  const params = buildSearchParams({
    ...DEFAULT_CRITERIA,
    nearMeEnabled: true,
    nearLat: 30.04,
    nearLng: 31.24,
    nearRadiusKm: 25,
  });
  assert.equal(params.near_lat, 30.04);
  assert.equal(params.near_lng, 31.24);
  assert.equal(params.radius_km, 25);
});

test("buildSearchParams expands industrial group", () => {
  const params = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "facilities",
    industrialType: "all",
  });
  assert.equal(params.category, "industrial");
  assert.equal(params.industrial_type, "factory,warehouse,land");
});

test("buildSearchParams maps rental and installment filters", () => {
  const params = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "real_estate",
    engineKey: "rent",
    paymentType: "installment",
    rentalTerm: "yearly",
  });
  assert.equal(params.category, "real_estate");
  assert.equal(params.offer_type, "rent");
  assert.equal(params.has_installment, true);
  assert.equal(params.rental_term, "yearly");
});

test("section gates drop cross-company stale criteria", () => {
  // Car brand/fuel must not ride on a real-estate browse (deep link leak).
  const re = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "real_estate",
    engineKey: "villa",
    rentalTerm: "old_law",
    brand: "toyota",
    fuelType: "diesel",
    industry: "food",
  });
  assert.equal(re.rental_term, undefined, "rental only with rent engine");
  assert.equal(re.brand, undefined);
  assert.equal(re.fuel_type, undefined);
  assert.equal(re.industry, undefined);

  // Materials + raw_material: no factory industry; material allowed.
  const mat = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "materials",
    industrialType: "raw_material",
    industry: "food",
    originType: "imported",
    material: "steel",
  });
  assert.equal(mat.industry, undefined);
  assert.equal(mat.origin_type, "imported");
  assert.equal(mat.material, "steel");

  // Facilities never send origin or material.
  const fac = buildSearchParams({
    ...DEFAULT_CRITERIA,
    category: "facilities",
    industrialType: "factory",
    originType: "imported",
    industry: "food",
    material: "steel",
  });
  assert.equal(fac.origin_type, undefined);
  assert.equal(fac.industry, "food");
  assert.equal(fac.material, undefined);
});

test("CLEAR_SECTION_ATTRS wipes cross-company fields", async () => {
  const { CLEAR_SECTION_ATTRS } = await import("../src/types.ts");
  assert.equal(CLEAR_SECTION_ATTRS.engineKey, "all");
  assert.equal(CLEAR_SECTION_ATTRS.material, null);
  assert.equal(CLEAR_SECTION_ATTRS.fuelType, null);
  assert.equal(CLEAR_SECTION_ATTRS.rentalTerm, null);
  assert.equal(CLEAR_SECTION_ATTRS.originType, null);
  assert.equal(CLEAR_SECTION_ATTRS.industry, null);
});

test("buildSearchParams passes cursor pagination", () => {
  const params = buildSearchParams(DEFAULT_CRITERIA, "cursor-abc", 15);
  assert.equal(params.cursor, "cursor-abc");
  assert.equal(params.limit, 15);
});

test("URL round-trip preserves committed criteria fields", () => {
  // rental_term only serializes for real_estate + rent browse (section gate).
  // Dead stub "monthly" is not a product term — use new_law (M31).
  const criteria = {
    ...DEFAULT_CRITERIA,
    q: "apartment",
    category: "real_estate",
    engineKey: "rent",
    sort: "newest",
    minPrice: "50000",
    location: "alex",
    paymentType: "installment",
    rentalTerm: "new_law",
    nearMeEnabled: true,
    nearLat: 31.2,
    nearLng: 29.9,
    nearRadiusKm: 10,
  };

  const urlParams = buildSearchUrlParams(criteria, { view: "map", limit: 20 });
  const parsed = parseSearchCriteriaFromUrl(Object.fromEntries(urlParams.entries()));

  assert.equal(parsed.q, criteria.q);
  assert.equal(parsed.category, criteria.category);
  assert.equal(parsed.engineKey, criteria.engineKey);
  assert.equal(parsed.sort, criteria.sort);
  assert.equal(parsed.minPrice, criteria.minPrice);
  assert.equal(parsed.location, criteria.location);
  assert.equal(parsed.paymentType, criteria.paymentType);
  assert.equal(parsed.rentalTerm, criteria.rentalTerm);
  assert.equal(parsed.nearMeEnabled, true);
  assert.equal(parsed.nearLat, criteria.nearLat);
  assert.equal(parsed.nearLng, criteria.nearLng);
  assert.equal(parsed.nearRadiusKm, criteria.nearRadiusKm);
});

test("URL round-trip drops rentalTerm outside real_estate rent", () => {
  const criteria = {
    ...DEFAULT_CRITERIA,
    category: "facilities",
    engineKey: "all",
    rentalTerm: "new_law",
  };
  const urlParams = buildSearchUrlParams(criteria);
  const parsed = parseSearchCriteriaFromUrl(Object.fromEntries(urlParams.entries()));
  assert.equal(urlParams.get("rental_term"), null);
  assert.equal(parsed.rentalTerm, null);
});

test("URL round-trip preserves market_country", () => {
  const criteria = {
    ...DEFAULT_CRITERIA,
    marketCountry: "SA",
  };
  const urlParams = buildSearchUrlParams(criteria);
  const parsed = parseSearchCriteriaFromUrl(Object.fromEntries(urlParams.entries()));
  assert.equal(urlParams.get("market_country"), "SA");
  assert.equal(parsed.marketCountry, "SA");
});
