import {
  BODY_TYPES,
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSIONS,
} from "@/constants/cars";

/**
 * Seller create-listing taxonomy (Task #37).
 *
 * The backend listing `category` enum is ONLY car | real_estate | industrial.
 * "Raw Materials" is a seller-facing 4th category that maps down to
 * category=industrial with specs.industrial_type="raw_material" — see
 * `apiCategoryForUi` / the create screen's submit builder. This file is PURE
 * data + tiny pure helpers — no React/RN runtime deps — so it can be reused and
 * reasoned about (and unit-tested) in isolation. Icon names are a local string
 * union of Feather glyphs; the create screen owns the actual <Feather> render.
 *
 * Spec keys here are the CANONICAL keys the BFF/normalization layer scores on
 * (see REQUIRED_SPEC_KEYS): real_estate -> area, rooms, property_type,
 * finishing; industrial -> capacity, industry, industrial_type; car -> mileage,
 * year, condition, fuel_type. Enum slugs match the values coerceEnum resolves.
 */

/** Feather glyph names referenced by UI_CATEGORIES. Kept as a local literal
 * union so this module stays free of @expo/vector-icons (an RN import); the
 * create screen passes these straight to <Feather name=… />. */
export type FeatherIconName = "truck" | "home" | "settings" | "box";

export type UiListingCategory =
  | "car"
  | "real_estate"
  | "industrial"
  | "raw_materials";

export type ApiListingCategory = "car" | "real_estate" | "industrial";

export type SpecOption = {
  value: string;
  labelKey?: string;
  label?: { en: string; ar: string };
};

export type SpecField = {
  key: string;
  labelKey: string;
  placeholderKey?: string;
  type: "text" | "number" | "select";
  required?: boolean;
  options?: SpecOption[];
};

export const enumOptions = (
  items: { value: string; en: string; ar: string }[],
): SpecOption[] =>
  items.map((i) => ({ value: i.value, label: { en: i.en, ar: i.ar } }));

/** Seller-facing categories. raw_materials is mapped down at submit/preview. */
export const UI_CATEGORIES: {
  value: UiListingCategory;
  icon: FeatherIconName;
  labelKey: string;
}[] = [
  { value: "car", icon: "truck", labelKey: "home.categories.car" },
  { value: "real_estate", icon: "home", labelKey: "home.categories.real_estate" },
  { value: "industrial", icon: "settings", labelKey: "home.categories.industrial" },
  { value: "raw_materials", icon: "box", labelKey: "home.categories.raw_material" },
];

export function apiCategoryForUi(ui: UiListingCategory): ApiListingCategory {
  return ui === "raw_materials" ? "industrial" : ui;
}

/** Industrial sub-types offered in the picker. raw_material is intentionally
 * excluded — it is its own seller-facing category. */
export const INDUSTRIAL_TYPES: { value: string; labelKey: string }[] = [
  { value: "factory", labelKey: "home.industrialTypes.factory" },
  { value: "warehouse", labelKey: "home.industrialTypes.warehouse" },
  { value: "machine", labelKey: "home.industrialTypes.machine" },
  { value: "production_line", labelKey: "home.industrialTypes.production_line" },
  { value: "land", labelKey: "home.industrialTypes.land" },
];

/* ── Canonical enum slugs (picker values; coerceEnum is lenient) ─────────── */

export const PROPERTY_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "apartment", en: "Apartment", ar: "شقة" },
  { value: "villa", en: "Villa", ar: "فيلا" },
  { value: "townhouse", en: "Townhouse", ar: "تاون هاوس" },
  { value: "twinhouse", en: "Twinhouse", ar: "توين هاوس" },
  { value: "penthouse", en: "Penthouse", ar: "بنتهاوس" },
  { value: "duplex", en: "Duplex", ar: "دوبلكس" },
  { value: "studio", en: "Studio", ar: "استوديو" },
  { value: "chalet", en: "Chalet", ar: "شاليه" },
  { value: "office", en: "Office", ar: "مكتب" },
  { value: "clinic", en: "Clinic", ar: "عيادة" },
  { value: "shop", en: "Shop", ar: "محل" },
  { value: "land", en: "Land", ar: "أرض" },
];

export const FINISHING_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "finished", en: "Finished", ar: "تشطيب كامل" },
  { value: "semi_finished", en: "Semi-finished", ar: "نص تشطيب" },
  { value: "core_shell", en: "Core & shell", ar: "على المحارة" },
  { value: "super_lux", en: "Super lux", ar: "سوبر لوكس" },
];

export const OWNERSHIP_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "resale", en: "Resale", ar: "إعادة بيع" },
  { value: "primary", en: "Primary (developer)", ar: "من المطوّر" },
  { value: "installment_ready", en: "Installment-ready", ar: "جاهز للتقسيط" },
];

export const INDUSTRY_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "food", en: "Food", ar: "أغذية" },
  { value: "beverage", en: "Beverage", ar: "مشروبات" },
  { value: "plastic", en: "Plastic", ar: "بلاستيك" },
  { value: "textile", en: "Textile", ar: "نسيج" },
  { value: "pharmaceutical", en: "Pharmaceutical", ar: "أدوية" },
  { value: "chemical", en: "Chemical", ar: "كيماويات" },
  { value: "engineering", en: "Engineering", ar: "هندسي" },
];

export const MATERIAL_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "steel", en: "Steel", ar: "حديد" },
  { value: "aluminum", en: "Aluminum", ar: "ألومنيوم" },
  { value: "copper", en: "Copper", ar: "نحاس" },
  { value: "plastic_resin", en: "Plastic / resin", ar: "بلاستيك خام" },
  { value: "paper", en: "Paper", ar: "ورق" },
  { value: "chemical", en: "Chemical", ar: "كيماويات" },
  { value: "textile_fiber", en: "Textile fiber", ar: "ألياف نسيجية" },
  { value: "rubber", en: "Rubber", ar: "مطاط" },
  { value: "glass", en: "Glass", ar: "زجاج" },
  { value: "wood", en: "Wood", ar: "خشب" },
  { value: "cement", en: "Cement", ar: "أسمنت" },
  { value: "other", en: "Other", ar: "أخرى" },
];

export const ORIGIN_COUNTRIES: { value: string; en: string; ar: string }[] = [
  { value: "egypt", en: "Egypt", ar: "مصر" },
  { value: "china", en: "China", ar: "الصين" },
  { value: "germany", en: "Germany", ar: "ألمانيا" },
  { value: "turkey", en: "Turkey", ar: "تركيا" },
  { value: "italy", en: "Italy", ar: "إيطاليا" },
  { value: "india", en: "India", ar: "الهند" },
  { value: "usa", en: "USA", ar: "أمريكا" },
  { value: "uae", en: "UAE", ar: "الإمارات" },
  { value: "saudi", en: "Saudi Arabia", ar: "السعودية" },
  { value: "other", en: "Other", ar: "أخرى" },
];

/**
 * Category-specific structured fields. Free-text is reserved for genuinely
 * open values (color, capacity output, brand text); every taxonomy/core field
 * is a controlled select. Cars also use the dedicated CarPicker (brand/model)
 * and industrial uses the INDUSTRIAL_TYPES picker — both rendered separately by
 * the screen, so they are not duplicated here.
 */
export const SPEC_FIELDS_BY_UI: Record<UiListingCategory, SpecField[]> = {
  car: [
    { key: "year", labelKey: "create.fields.year", placeholderKey: "create.fields.yearPh", type: "number", required: true },
    { key: "mileage", labelKey: "create.fields.mileage", placeholderKey: "create.fields.mileagePh", type: "number", required: true },
    { key: "condition", labelKey: "create.fields.condition", type: "select", required: true, options: enumOptions(CONDITIONS) },
    { key: "fuel_type", labelKey: "create.fields.fuel", type: "select", required: true, options: enumOptions(FUEL_TYPES) },
    { key: "transmission", labelKey: "create.fields.transmission", type: "select", options: enumOptions(TRANSMISSIONS) },
    { key: "body_type", labelKey: "create.fields.bodyType", type: "select", options: enumOptions(BODY_TYPES) },
    { key: "engine_cc", labelKey: "create.fields.engineCc", placeholderKey: "create.fields.engineCcPh", type: "number" },
    { key: "color", labelKey: "create.fields.color", placeholderKey: "create.fields.colorPh", type: "text" },
  ],
  real_estate: [
    // Primary EG/Gulf split — chosen first. sale = تمليك (ownership), rent = إيجار.
    {
      key: "offer_type",
      labelKey: "create.fields.offerType",
      type: "select",
      required: true,
      options: [
        { value: "sale", labelKey: "create.opts.sale" },
        { value: "rent", labelKey: "create.opts.rent" },
      ],
    },
    { key: "property_type", labelKey: "create.fields.propertyType", type: "select", required: true, options: enumOptions(PROPERTY_TYPES) },
    { key: "area", labelKey: "create.fields.area", placeholderKey: "create.fields.areaPh", type: "number", required: true },
    { key: "rooms", labelKey: "create.fields.rooms", placeholderKey: "create.fields.roomsPh", type: "number", required: true },
    { key: "bathrooms", labelKey: "create.fields.bathrooms", placeholderKey: "create.fields.bathroomsPh", type: "number" },
    { key: "finishing", labelKey: "create.fields.finishing", type: "select", required: true, options: enumOptions(FINISHING_TYPES) },
    { key: "ownership", labelKey: "create.fields.ownership", type: "select", options: enumOptions(OWNERSHIP_TYPES) },
  ],
  industrial: [
    { key: "industry", labelKey: "create.fields.industry", type: "select", required: true, options: enumOptions(INDUSTRY_TYPES) },
    { key: "capacity", labelKey: "create.fields.capacity", placeholderKey: "create.fields.capacityPh", type: "text", required: true },
    {
      key: "condition",
      labelKey: "create.fields.condition",
      type: "select",
      options: [
        { value: "new", labelKey: "create.opts.newCond" },
        { value: "used", labelKey: "create.opts.used" },
      ],
    },
    { key: "brand", labelKey: "create.fields.brand", placeholderKey: "create.fields.brandPh", type: "text" },
    { key: "year", labelKey: "create.fields.year", placeholderKey: "create.fields.yearPh", type: "number" },
  ],
  raw_materials: [
    { key: "industry", labelKey: "create.fields.industry", type: "select", required: true, options: enumOptions(INDUSTRY_TYPES) },
    { key: "material", labelKey: "create.fields.material", type: "select", required: true, options: enumOptions(MATERIAL_TYPES) },
    { key: "capacity", labelKey: "create.fields.quantity", placeholderKey: "create.fields.quantityPh", type: "text", required: true },
    { key: "origin", labelKey: "create.fields.origin", type: "select", options: enumOptions(ORIGIN_COUNTRIES) },
  ],
};

/**
 * Canonical spec keys that MUST be present on a published listing per UI
 * category — the contract the BFF/normalization layer scores on, and the single
 * source of truth for "required". Keys handled by dedicated pickers rather than
 * SPEC_FIELDS_BY_UI are still listed for contract fidelity: `industrial_type`
 * (industrial picker, or auto "raw_material" for raw_materials) and the car
 * brand/model (CarPicker) are validated separately by the screen.
 */
export const REQUIRED_SPEC_KEYS: Record<UiListingCategory, readonly string[]> = {
  car: ["mileage", "year", "condition", "fuel_type"],
  real_estate: ["offer_type", "area", "rooms", "property_type", "finishing"],
  industrial: ["capacity", "industry", "industrial_type"],
  raw_materials: ["capacity", "industry", "material", "industrial_type"],
};

/**
 * Required structured fields for a UI category (used for per-step gating).
 * Derived from REQUIRED_SPEC_KEYS so the contract stays the single source of
 * truth; canonical keys without a matching structured field (industrial_type,
 * brand) are naturally excluded here because the screen validates those pickers
 * directly. The `required: true` flags on SPEC_FIELDS_BY_UI mirror this set so
 * the rendered Required/Optional tag and the gating logic never diverge.
 */
export const requiredSpecFieldsFor = (ui: UiListingCategory): SpecField[] => {
  const required = new Set(REQUIRED_SPEC_KEYS[ui]);
  return SPEC_FIELDS_BY_UI[ui].filter((f) => required.has(f.key));
};
