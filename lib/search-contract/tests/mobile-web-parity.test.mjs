import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchParams } from "../src/buildSearchParams.ts";
import { DEFAULT_CRITERIA } from "../src/types.ts";

/**
 * Mobile re-exports DEFAULT_CRITERIA with marketCountry from listing taxonomy.
 * Same ISO must produce identical API params (including market_country).
 */
test("mobile-style DEFAULT_CRITERIA matches web API params", () => {
  const mobileDefault = {
    ...DEFAULT_CRITERIA,
    marketCountry: "EG",
  };
  const webDefault = { ...DEFAULT_CRITERIA };

  assert.deepEqual(
    buildSearchParams(mobileDefault),
    buildSearchParams(webDefault),
  );
  assert.equal(buildSearchParams(mobileDefault).market_country, "EG");
});

test("shared golden criteria produce identical API params (mobile vs web)", () => {
  const golden = {
    ...DEFAULT_CRITERIA,
    category: "car",
    engineKey: "used",
    sort: "newest",
    q: "corolla",
    location: "cairo",
    paymentType: "installment",
    // rentalTerm ignored for cars (section gate) — leave null
    rentalTerm: null,
  };

  const mobileCriteria = { ...golden, marketCountry: "EG" };
  const webCriteria = { ...golden, marketCountry: "EG" };

  assert.deepEqual(
    buildSearchParams(mobileCriteria),
    buildSearchParams(webCriteria),
  );
});

test("different marketCountry changes API params", () => {
  const eg = buildSearchParams({ ...DEFAULT_CRITERIA, marketCountry: "EG" });
  const sa = buildSearchParams({ ...DEFAULT_CRITERIA, marketCountry: "SA" });
  assert.equal(eg.market_country, "EG");
  assert.equal(sa.market_country, "SA");
  assert.notDeepEqual(eg, sa);
});
