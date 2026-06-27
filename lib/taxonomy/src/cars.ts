/**
 * BANCO car taxonomy — real market data for Egypt + GCC, bilingual (EN/AR).
 *
 * Two layers, kept deliberately separate so nothing here ever fabricates a
 * backend capability:
 *
 *  • BROWSE layer (rich): the full brand/model catalogue users can browse. The
 *    search API has no brand/model param, but listing TITLES are English and
 *    contain "<Brand> <Model> <Year>" (e.g. "BMW 330i 2022"), so selecting a
 *    brand (or brand+model) maps to the free-text `q` param via an ILIKE title
 *    match. Brands/models with no inventory simply return no results — honest,
 *    never fake.
 *
 *  • CREATE layer (controlled): the backend normalizes new listings in STRICT
 *    mode and REJECTS unknown brands/models. Only the brands/models actually
 *    seeded in the DB resolve to a brand_id/model_id. `CREATE_SAFE_BRANDS` /
 *    `CREATE_SAFE_MODELS` mirror exactly what the backend accepts, so the
 *    create picker can never produce a rejected listing.
 */

export type Bi = { en: string; ar: string };

export interface CarCountry {
  value: string;
  en: string;
  ar: string;
}

export interface CarBrand {
  /** Stable internal key. */
  value: string;
  en: string;
  ar: string;
  /** Country bucket for the picker. */
  country: string;
  /** Exact backend brand name (set only for create-safe brands). */
  dbName?: string;
  /** Browse search term override (defaults to `en`); matches the brand string used in listing titles. */
  q?: string;
  popular?: boolean;
  luxury?: boolean;
  electric?: boolean;
  /** True when the backend has this brand seeded and will resolve it on create. */
  createSafe?: boolean;
}

export const CAR_COUNTRIES: CarCountry[] = [
  { value: "japan", en: "Japan", ar: "اليابان" },
  { value: "germany", en: "Germany", ar: "ألمانيا" },
  { value: "south_korea", en: "South Korea", ar: "كوريا الجنوبية" },
  { value: "china", en: "China", ar: "الصين" },
  { value: "usa", en: "United States", ar: "الولايات المتحدة" },
  { value: "uk", en: "United Kingdom", ar: "المملكة المتحدة" },
  { value: "italy", en: "Italy", ar: "إيطاليا" },
  { value: "france", en: "France", ar: "فرنسا" },
  { value: "sweden", en: "Sweden", ar: "السويد" },
  { value: "czech", en: "Czech Republic", ar: "التشيك" },
  { value: "spain", en: "Spain", ar: "إسبانيا" },
  { value: "india", en: "India", ar: "الهند" },
  { value: "other", en: "Other", ar: "أخرى" },
];

export const CAR_BRANDS: CarBrand[] = [
  // ── Japan ──
  { value: "toyota", en: "Toyota", ar: "تويوتا", country: "japan", dbName: "Toyota", createSafe: true, popular: true },
  { value: "lexus", en: "Lexus", ar: "لكزس", country: "japan", dbName: "Lexus", createSafe: true, luxury: true },
  { value: "honda", en: "Honda", ar: "هوندا", country: "japan", dbName: "Honda", createSafe: true },
  { value: "nissan", en: "Nissan", ar: "نيسان", country: "japan", dbName: "Nissan", createSafe: true, popular: true },
  { value: "mitsubishi", en: "Mitsubishi", ar: "ميتسوبيشي", country: "japan", dbName: "Mitsubishi", createSafe: true },
  { value: "mazda", en: "Mazda", ar: "مازدا", country: "japan" },
  { value: "subaru", en: "Subaru", ar: "سوبارو", country: "japan" },
  { value: "suzuki", en: "Suzuki", ar: "سوزوكي", country: "japan" },
  { value: "infiniti", en: "Infiniti", ar: "إنفينيتي", country: "japan", luxury: true },
  { value: "acura", en: "Acura", ar: "أكورا", country: "japan" },
  { value: "daihatsu", en: "Daihatsu", ar: "دايهاتسو", country: "japan" },
  { value: "isuzu", en: "Isuzu", ar: "إيسوزو", country: "japan" },

  // ── Germany ──
  { value: "bmw", en: "BMW", ar: "بي إم دبليو", country: "germany", dbName: "BMW", createSafe: true, popular: true, luxury: true },
  { value: "mercedes_benz", en: "Mercedes-Benz", ar: "مرسيدس بنز", country: "germany", dbName: "Mercedes-Benz", q: "Mercedes", createSafe: true, popular: true, luxury: true },
  { value: "audi", en: "Audi", ar: "أودي", country: "germany", dbName: "Audi", createSafe: true, popular: true, luxury: true },
  { value: "volkswagen", en: "Volkswagen", ar: "فولكس فاجن", country: "germany", dbName: "Volkswagen", createSafe: true, popular: true },
  { value: "porsche", en: "Porsche", ar: "بورش", country: "germany", dbName: "Porsche", createSafe: true, luxury: true },
  { value: "opel", en: "Opel", ar: "أوبل", country: "germany" },
  { value: "maybach", en: "Maybach", ar: "مايباخ", country: "germany", luxury: true },
  { value: "smart", en: "Smart", ar: "سمارت", country: "germany" },

  // ── South Korea ──
  { value: "hyundai", en: "Hyundai", ar: "هيونداي", country: "south_korea", dbName: "Hyundai", createSafe: true, popular: true },
  { value: "kia", en: "Kia", ar: "كيا", country: "south_korea", dbName: "Kia", createSafe: true, popular: true },
  { value: "genesis", en: "Genesis", ar: "جينيسيس", country: "south_korea", luxury: true },

  // ── China ──
  { value: "byd", en: "BYD", ar: "بي واي دي", country: "china", popular: true, electric: true },
  { value: "mg", en: "MG", ar: "إم جي", country: "china", dbName: "MG", createSafe: true, popular: true },
  { value: "chery", en: "Chery", ar: "شيري", country: "china", popular: true },
  { value: "jetour", en: "Jetour", ar: "جيتور", country: "china", popular: true },
  { value: "geely", en: "Geely", ar: "جيلي", country: "china" },
  { value: "haval", en: "Haval", ar: "هافال", country: "china" },
  { value: "great_wall", en: "Great Wall", ar: "جريت وول", country: "china" },
  { value: "changan", en: "Changan", ar: "شانجان", country: "china" },
  { value: "omoda", en: "Omoda", ar: "أومودا", country: "china" },
  { value: "jaecoo", en: "Jaecoo", ar: "جايكو", country: "china" },
  { value: "jac", en: "JAC", ar: "جاك", country: "china" },
  { value: "nio", en: "NIO", ar: "نيو", country: "china", electric: true },
  { value: "xpeng", en: "XPeng", ar: "إكس بينج", country: "china", electric: true },
  { value: "zeekr", en: "Zeekr", ar: "زيكر", country: "china", electric: true },
  { value: "li_auto", en: "Li Auto", ar: "لي أوتو", country: "china", electric: true },
  { value: "hongqi", en: "Hongqi", ar: "هونشي", country: "china", luxury: true },

  // ── United States ──
  { value: "chevrolet", en: "Chevrolet", ar: "شيفروليه", country: "usa", dbName: "Chevrolet", createSafe: true, popular: true },
  { value: "ford", en: "Ford", ar: "فورد", country: "usa", dbName: "Ford", createSafe: true },
  { value: "jeep", en: "Jeep", ar: "جيب", country: "usa", dbName: "Jeep", createSafe: true },
  { value: "tesla", en: "Tesla", ar: "تسلا", country: "usa", electric: true, luxury: true },
  { value: "gmc", en: "GMC", ar: "جي إم سي", country: "usa" },
  { value: "cadillac", en: "Cadillac", ar: "كاديلاك", country: "usa", luxury: true },
  { value: "dodge", en: "Dodge", ar: "دودج", country: "usa" },
  { value: "ram", en: "Ram", ar: "رام", country: "usa" },
  { value: "chrysler", en: "Chrysler", ar: "كرايسلر", country: "usa" },
  { value: "lincoln", en: "Lincoln", ar: "لينكولن", country: "usa", luxury: true },
  { value: "lucid", en: "Lucid", ar: "لوسيد", country: "usa", electric: true, luxury: true },
  { value: "rivian", en: "Rivian", ar: "ريفيان", country: "usa", electric: true },

  // ── United Kingdom ──
  { value: "land_rover", en: "Land Rover", ar: "لاند روفر", country: "uk", dbName: "Land Rover", createSafe: true, luxury: true },
  { value: "jaguar", en: "Jaguar", ar: "جاكوار", country: "uk", luxury: true },
  { value: "mini", en: "Mini", ar: "ميني", country: "uk" },
  { value: "bentley", en: "Bentley", ar: "بنتلي", country: "uk", luxury: true },
  { value: "rolls_royce", en: "Rolls-Royce", ar: "رولز رويس", country: "uk", luxury: true },
  { value: "aston_martin", en: "Aston Martin", ar: "أستون مارتن", country: "uk", luxury: true },
  { value: "mclaren", en: "McLaren", ar: "مكلارين", country: "uk", luxury: true },

  // ── Italy ──
  { value: "ferrari", en: "Ferrari", ar: "فيراري", country: "italy", luxury: true },
  { value: "lamborghini", en: "Lamborghini", ar: "لامبورغيني", country: "italy", luxury: true },
  { value: "maserati", en: "Maserati", ar: "مازيراتي", country: "italy", luxury: true },
  { value: "alfa_romeo", en: "Alfa Romeo", ar: "ألفا روميو", country: "italy" },
  { value: "fiat", en: "Fiat", ar: "فيات", country: "italy" },
  { value: "abarth", en: "Abarth", ar: "أبارث", country: "italy" },

  // ── France ──
  { value: "renault", en: "Renault", ar: "رينو", country: "france", dbName: "Renault", createSafe: true, popular: true },
  { value: "peugeot", en: "Peugeot", ar: "بيجو", country: "france", dbName: "Peugeot", createSafe: true, popular: true },
  { value: "citroen", en: "Citroen", ar: "ستروين", country: "france" },
  { value: "ds", en: "DS Automobiles", ar: "دي إس", country: "france", luxury: true },
  { value: "bugatti", en: "Bugatti", ar: "بوغاتي", country: "france", luxury: true },
  { value: "alpine", en: "Alpine", ar: "ألبين", country: "france" },

  // ── Sweden ──
  { value: "volvo", en: "Volvo", ar: "فولفو", country: "sweden" },
  { value: "polestar", en: "Polestar", ar: "بولستار", country: "sweden", electric: true },
  { value: "koenigsegg", en: "Koenigsegg", ar: "كونيجسيج", country: "sweden", luxury: true },

  // ── Czech Republic ──
  { value: "skoda", en: "Skoda", ar: "سكودا", country: "czech", popular: true },

  // ── Spain ──
  { value: "seat", en: "SEAT", ar: "سيات", country: "spain" },
  { value: "cupra", en: "Cupra", ar: "كوبرا", country: "spain" },

  // ── India ──
  { value: "tata", en: "Tata", ar: "تاتا", country: "india" },
  { value: "mahindra", en: "Mahindra", ar: "ماهيندرا", country: "india" },
  { value: "maruti_suzuki", en: "Maruti Suzuki", ar: "ماروتي سوزوكي", country: "india" },

  // ── Other ──
  { value: "togg", en: "TOGG", ar: "توج", country: "other", electric: true },
  { value: "vinfast", en: "VinFast", ar: "فينفاست", country: "other", electric: true },
  { value: "proton", en: "Proton", ar: "بروتون", country: "other" },
];

/**
 * Rich browse models per brand (used to refine the `q` title search, e.g.
 * "Toyota Corolla"). Plain English so they match the English listing titles.
 */
export const CAR_MODELS: Record<string, string[]> = {
  bmw: [
    "116i", "118i", "120i", "218i", "220i", "320i", "328i", "330i", "340i",
    "420i", "430i", "520i", "528i", "530i", "730i", "740i", "750i",
    "M2", "M3", "M4", "M5", "M8", "X1", "X2", "X3", "X4", "X5", "X6", "X7",
    "i4", "i5", "i7", "iX",
  ],
  mercedes_benz: [
    "A180", "A200", "CLA", "C180", "C200", "C300", "C43 AMG", "C63 AMG",
    "E200", "E300", "E350", "E63 AMG", "S350", "S450", "S500", "S580",
    "GLA", "GLB", "GLC", "GLE", "GLS", "G-Class", "AMG GT", "SL",
    "EQA", "EQB", "EQC", "EQE", "EQS",
  ],
  audi: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q5", "Q7", "Q8", "TT", "R8", "e-tron", "Q4 e-tron"],
  toyota: [
    "Corolla", "Corolla Cross", "Camry", "Yaris", "Avalon", "Crown", "Prius",
    "RAV4", "Highlander", "Fortuner", "Land Cruiser", "Prado", "Rush", "Raize",
    "Hilux", "Hiace", "C-HR",
  ],
  hyundai: ["Accent", "Elantra", "Sonata", "i10", "i20", "i30", "Venue", "Creta", "Tucson", "Santa Fe", "Palisade", "Kona", "IONIQ 5", "IONIQ 6"],
  kia: ["Picanto", "Rio", "Cerato", "K3", "K5", "Stinger", "Seltos", "Sportage", "Sorento", "Telluride", "EV6", "EV9"],
  nissan: ["Sunny", "Sentra", "Altima", "Maxima", "Micra", "Juke", "Qashqai", "X-Trail", "Pathfinder", "Patrol", "Navara", "Leaf", "Ariya"],
  honda: ["City", "Civic", "Accord", "HR-V", "CR-V", "Pilot", "Passport", "Odyssey"],
  chevrolet: ["Spark", "Aveo", "Optra", "Lanos", "Malibu", "Captiva", "Equinox", "Traverse", "Tahoe", "Suburban", "Camaro", "Silverado"],
  ford: ["Fiesta", "Focus", "Fusion", "Escape", "Kuga", "Edge", "Explorer", "Expedition", "Everest", "Ranger", "F-150", "Mustang", "Mustang Mach-E"],
  volkswagen: ["Polo", "Golf", "Passat", "Jetta", "Arteon", "T-Roc", "Tiguan", "Touareg", "ID.4", "ID.6"],
  skoda: ["Fabia", "Rapid", "Octavia", "Superb", "Kamiq", "Karoq", "Kodiaq"],
  renault: ["Logan", "Sandero", "Megane", "Talisman", "Duster", "Kadjar", "Koleos"],
  peugeot: ["208", "301", "308", "508", "2008", "3008", "5008"],
  mg: ["MG3", "MG5", "MG6", "ZS", "HS", "RX5", "MG4 EV", "ZS EV"],
  chery: ["Arrizo 5", "Arrizo 6", "Tiggo 2", "Tiggo 3", "Tiggo 4", "Tiggo 7", "Tiggo 8"],
  byd: ["F3", "Dolphin", "Atto 3", "Han", "Tang", "Seal"],
  tesla: ["Model S", "Model 3", "Model X", "Model Y"],
  land_rover: ["Defender", "Discovery", "Discovery Sport", "Range Rover", "Range Rover Sport", "Range Rover Velar", "Range Rover Evoque"],
  volvo: ["S60", "S90", "XC40", "XC60", "XC90", "C40 Recharge"],
  mazda: ["Mazda2", "Mazda3", "Mazda6", "CX-3", "CX-5", "CX-9", "CX-30"],
  subaru: ["Impreza", "Legacy", "Forester", "Outback", "XV", "WRX"],
  mitsubishi: ["Lancer", "Attrage", "ASX", "Outlander", "Pajero", "Eclipse Cross", "L200"],
  jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Renegade"],
  porsche: ["911", "Cayenne", "Macan", "Panamera", "Taycan", "Cayman", "Boxster"],
  lexus: ["ES", "IS", "LS", "NX", "RX 350", "LX", "UX"],
};

/**
 * Brands the backend has seeded and will resolve to a brand_id on create.
 * Anything outside this set is rejected by strict normalization.
 */
export const CREATE_SAFE_BRANDS: CarBrand[] = CAR_BRANDS.filter((b) => b.createSafe);

/**
 * Exact model names seeded in the DB, per brand value. The create model picker
 * only offers these (plus an "Other" path that omits specs.model so the backend
 * infers leniently from the title) — guaranteeing a create never gets rejected.
 */
export const CREATE_SAFE_MODELS: Record<string, string[]> = {
  audi: ["A4"],
  bmw: ["330i", "X5"],
  chevrolet: ["Camaro", "Lanos"],
  ford: ["Mustang"],
  honda: ["CR-V"],
  hyundai: ["Elantra", "Tucson"],
  jeep: ["Grand Cherokee"],
  kia: ["Cerato", "Sportage"],
  land_rover: ["Range Rover"],
  lexus: ["RX 350"],
  mg: ["ZS"],
  mercedes_benz: ["C-Class", "GLE"],
  mitsubishi: ["Eclipse Cross"],
  nissan: ["X-Trail"],
  peugeot: ["208"],
  porsche: ["Cayenne"],
  renault: ["Duster"],
  toyota: ["Corolla", "Fortuner"],
  volkswagen: ["Tiguan"],
};

/** Canonical enum vocab — values mirror the backend's alias maps exactly. */
export const BODY_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "sedan", en: "Sedan", ar: "سيدان" },
  { value: "suv", en: "SUV", ar: "إس يو في" },
  { value: "crossover", en: "Crossover", ar: "كروس أوفر" },
  { value: "hatchback", en: "Hatchback", ar: "هاتشباك" },
  { value: "coupe", en: "Coupe", ar: "كوبيه" },
  { value: "convertible", en: "Convertible", ar: "مكشوفة" },
  { value: "pickup", en: "Pickup", ar: "بيك أب" },
  { value: "minivan", en: "Minivan", ar: "ميني فان" },
  { value: "van", en: "Van", ar: "فان" },
];

export const FUEL_TYPES: { value: string; en: string; ar: string }[] = [
  { value: "petrol", en: "Petrol", ar: "بنزين" },
  { value: "diesel", en: "Diesel", ar: "ديزل" },
  { value: "hybrid", en: "Hybrid", ar: "هايبرد" },
  { value: "electric", en: "Electric", ar: "كهربائي" },
  { value: "natural_gas", en: "Natural Gas", ar: "غاز طبيعي" },
];

export const TRANSMISSIONS: { value: string; en: string; ar: string }[] = [
  { value: "automatic", en: "Automatic", ar: "أوتوماتيك" },
  { value: "manual", en: "Manual", ar: "مانوال" },
  { value: "cvt", en: "CVT", ar: "سي في تي" },
];

export const CONDITIONS: { value: string; en: string; ar: string }[] = [
  { value: "new", en: "New", ar: "جديدة" },
  { value: "used", en: "Used", ar: "مستعملة" },
];

export const CAR_COLORS: { value: string; en: string; ar: string }[] = [
  { value: "black", en: "Black", ar: "أسود" },
  { value: "white", en: "White", ar: "أبيض" },
  { value: "silver", en: "Silver", ar: "فضي" },
  { value: "gray", en: "Gray", ar: "رمادي" },
  { value: "red", en: "Red", ar: "أحمر" },
  { value: "blue", en: "Blue", ar: "أزرق" },
  { value: "navy", en: "Navy", ar: "كحلي" },
  { value: "green", en: "Green", ar: "أخضر" },
  { value: "brown", en: "Brown", ar: "بني" },
  { value: "beige", en: "Beige", ar: "بيج" },
  { value: "gold", en: "Gold", ar: "ذهبي" },
  { value: "orange", en: "Orange", ar: "برتقالي" },
  { value: "burgundy", en: "Burgundy", ar: "نبيتي" },
];

/* ── Helpers ──────────────────────────────────────────── */

const BRAND_BY_VALUE: Record<string, CarBrand> = Object.fromEntries(
  CAR_BRANDS.map((b) => [b.value, b]),
);

export function brandByValue(value: string | undefined): CarBrand | undefined {
  return value ? BRAND_BY_VALUE[value] : undefined;
}

export function brandLabel(brand: CarBrand, isRTL: boolean): string {
  return isRTL ? brand.ar : brand.en;
}

export function countryLabel(country: CarCountry, isRTL: boolean): string {
  return isRTL ? country.ar : country.en;
}

/** Term to inject into the search `q` param to match the brand in titles. */
export function brandQuery(brand: CarBrand): string {
  return brand.q ?? brand.en;
}

export function browseModels(brandValue: string): string[] {
  return CAR_MODELS[brandValue] ?? [];
}

export function createModels(brandValue: string): string[] {
  return CREATE_SAFE_MODELS[brandValue] ?? [];
}

/** Popular-in-Egypt brands with live inventory — the default quick chips. */
export const POPULAR_BRANDS: CarBrand[] = CAR_BRANDS.filter((b) => b.popular);
