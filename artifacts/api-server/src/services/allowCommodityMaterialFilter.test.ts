import { describe, it, expect } from "vitest";
import { allowCommodityMaterialFilter } from "./allowCommodityMaterialFilter";

describe("allowCommodityMaterialFilter", () => {
  it("allows material on industrial / materials browse", () => {
    expect(
      allowCommodityMaterialFilter({
        category: "industrial",
        industrial_type: ["raw_material"],
        material: "steel",
      }),
    ).toBe(true);
    expect(
      allowCommodityMaterialFilter({
        category: "industrial",
        industrial_type: ["production_line", "raw_material", "machine"],
        material: "steel",
      }),
    ).toBe(true);
    expect(allowCommodityMaterialFilter({ material: "steel" })).toBe(true);
  });

  it("rejects material on car / real_estate", () => {
    expect(
      allowCommodityMaterialFilter({ category: "car", material: "steel" }),
    ).toBe(false);
    expect(
      allowCommodityMaterialFilter({
        category: "real_estate",
        material: "steel",
      }),
    ).toBe(false);
  });

  it("rejects material when industrial_type is facilities-only", () => {
    expect(
      allowCommodityMaterialFilter({
        category: "industrial",
        industrial_type: ["factory", "warehouse"],
        material: "steel",
      }),
    ).toBe(false);
    expect(
      allowCommodityMaterialFilter({
        category: "industrial",
        industrial_type: ["land"],
        material: "steel",
      }),
    ).toBe(false);
  });

  it("rejects when material missing", () => {
    expect(
      allowCommodityMaterialFilter({ category: "industrial" }),
    ).toBe(false);
  });
});
