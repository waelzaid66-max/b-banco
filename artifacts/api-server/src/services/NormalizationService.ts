import { db } from "@workspace/db";
import {
  brands,
  models,
  carVariants,
  locations,
  listings,
  listingAttributes,
  propertyTypes,
  finishingTypes,
  ownershipTypes,
  industrialTypes,
  industries,
} from "@workspace/db/schema";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { bestMatch, normalizeText, slugify, type MatchCandidate } from "../lib/fuzzy";

/* ── Types ─────────────────────────────────────────────── */

export type Category = "car" | "real_estate" | "industrial";

export interface MediaInput {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string;
  is_thumbnail?: boolean;
  width?: number;
  height?: number;
}

export interface NormalizeInput {
  title: string;
  description?: string;
  /** Optional: when omitted (e.g. free-text bulk import) it is inferred via detectCategory. */
  category?: Category;
  base_price_cash: number;
  location: string;
  specs: Record<string, unknown>;
  media: MediaInput[];
}

export interface NormalizedTaxonomy {
  brandId: string | null;
  modelId: string | null;
  variantId: string | null;
  fuelType: string | null;
  condition: string | null;
  bodyType: string | null;
  transmission: string | null;
  propertyType: string | null;
  finishingType: string | null;
  ownershipType: string | null;
  industrialType: string | null;
  industry: string | null;
  // Reference-table FK ids resolved from the canonical enum values above.
  propertyTypeId: string | null;
  finishingTypeId: string | null;
  ownershipTypeId: string | null;
  industrialTypeId: string | null;
  industryId: string | null;
}

export interface NormalizationResult {
  title: string;
  description?: string;
  category: Category;
  locationId: string | null;
  /** Canonical "area، city" string resolved from the controlled location taxonomy (null when unmatched). */
  locationCanonical: string | null;
  taxonomy: NormalizedTaxonomy;
  specs: Record<string, unknown>;
  trustScore: number;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  /** Spam signals matched in the title/description (empty when clean). */
  spamFlags: string[];
  /** True when the price is a statistical outlier vs comparable listings. */
  isPriceOutlier: boolean;
  /**
   * Abuse-control verdict: when true the listing is hidden from the public
   * feed/search. Set for spam content (severe). Price outliers are demoted via
   * trust score rather than hidden.
   */
  isFlagged: boolean;
  flagReason: string | null;
  warnings: string[];
}

/* ── Auto-correction alias maps (keyed by canonical slug/value) ── */

const BRAND_ALIASES: Record<string, string[]> = {
  "mercedes-benz": ["mercedes", "merc", "mercedes benz", "مرسيدس", "مرسيدس بنز"],
  bmw: ["bmw", "بي ام دبليو", "بمو", "بي إم دبليو"],
  audi: ["audi", "اودي", "أودي"],
  toyota: ["toyota", "تويوتا"],
  hyundai: ["hyundai", "هيونداي", "هيونداي"],
  kia: ["kia", "كيا"],
  nissan: ["nissan", "نيسان"],
  volkswagen: ["vw", "volkswagen", "فولكس", "فولكس فاجن"],
  chevrolet: ["chevy", "chevrolet", "شيفروليه", "شيفرولية"],
  ford: ["ford", "فورد"],
  honda: ["honda", "هوندا"],
  jeep: ["jeep", "جيب"],
  peugeot: ["peugeot", "بيجو"],
  renault: ["renault", "رينو"],
  mitsubishi: ["mitsubishi", "ميتسوبيشي"],
  mg: ["mg", "ام جي", "إم جي"],
  porsche: ["porsche", "بورش"],
  "land-rover": ["land rover", "range rover", "لاند روفر", "رنج روفر"],
  lexus: ["lexus", "لكزس", "لكسس"],
};

const MODEL_ALIASES: Record<string, string[]> = {
  x5: ["x five", "xfive", "اكس فايف"],
  "330i": ["330", "3 series", "الفئة الثالثة"],
  "c-class": ["c class", "cclass", "c200", "c180", "c300", "سي كلاس"],
  gle: ["gle", "جي ال اي"],
  a4: ["a4", "a 4"],
  corolla: ["corolla", "كورولا"],
  fortuner: ["fortuner", "فورتشنر"],
  tucson: ["tucson", "توسان"],
  elantra: ["elantra", "النترا", "إلنترا"],
  sportage: ["sportage", "سبورتاج"],
  cerato: ["cerato", "سيراتو"],
  tiguan: ["tiguan", "تيجوان"],
  camaro: ["camaro", "كامارو"],
  mustang: ["mustang", "موستانج"],
  cayenne: ["cayenne", "كايين"],
  "x-trail": ["x trail", "xtrail", "اكس تريل"],
  "cr-v": ["crv", "cr v", "سي ار في"],
  "grand-cherokee": ["grand cherokee", "جراند شيروكي"],
  "rx-350": ["rx350", "rx 350"],
  lanos: ["lanos", "لانوس"],
  "208": ["208"],
  duster: ["duster", "داستر"],
  "eclipse-cross": ["eclipse cross", "eclipse"],
  zs: ["zs"],
};

const FUEL_ALIASES: Record<string, string[]> = {
  petrol: ["petrol", "benzine", "benzene", "gasoline", "gas", "بنزين"],
  diesel: ["diesel", "ديزل", "سولار"],
  hybrid: ["hybrid", "هايبرد", "هجين"],
  electric: ["electric", "ev", "كهرباء", "كهربائي"],
  natural_gas: ["cng", "natural gas", "غاز طبيعي", "غاز"],
};

const CONDITION_ALIASES: Record<string, string[]> = {
  new: ["new", "brand new", "zero", "جديد", "زيرو"],
  used: ["used", "second hand", "secondhand", "pre owned", "preowned", "مستعمل"],
};

const TRANSMISSION_ALIASES: Record<string, string[]> = {
  automatic: ["automatic", "auto", "at", "اوتوماتيك", "أوتوماتيك"],
  manual: ["manual", "mt", "stick", "مانوال", "عادي"],
  cvt: ["cvt"],
};

const BODY_TYPE_ALIASES: Record<string, string[]> = {
  sedan: ["sedan", "saloon", "سيدان"],
  suv: ["suv", "جيب", "دفع رباعي"],
  hatchback: ["hatchback", "hatch"],
  coupe: ["coupe", "كوبيه"],
  pickup: ["pickup", "pick up", "نقل"],
  van: ["van", "فان"],
  crossover: ["crossover"],
  minivan: ["minivan", "mini van"],
  convertible: ["convertible", "cabrio"],
};

const PROPERTY_TYPE_ALIASES: Record<string, string[]> = {
  apartment: ["apartment", "flat", "شقة", "شقه"],
  villa: ["villa", "standalone villa", "standalone", "فيلا", "فلة"],
  townhouse: ["townhouse", "town house", "تاون هاوس"],
  twinhouse: ["twinhouse", "twin house", "twin", "توين هاوس"],
  penthouse: ["penthouse", "بنتهاوس"],
  duplex: ["duplex", "دوبلكس"],
  studio: ["studio", "استوديو", "ستوديو"],
  chalet: ["chalet", "شاليه"],
  office: ["office", "office space", "مكتب", "اداري", "إداري"],
  clinic: ["clinic", "عيادة"],
  shop: ["shop", "store", "retail", "محل", "تجاري"],
  land: ["land", "plot", "أرض", "ارض"],
};

const FINISHING_ALIASES: Record<string, string[]> = {
  finished: ["finished", "fully finished", "تشطيب كامل", "متشطب", "lux"],
  semi_finished: ["semi finished", "semi-finished", "نص تشطيب", "نصف تشطيب"],
  core_shell: ["core and shell", "core & shell", "core shell", "محارة", "طوب احمر", "عظم"],
  super_lux: ["super lux", "super luxe", "super luxury", "سوبر لوكس"],
};

const OWNERSHIP_ALIASES: Record<string, string[]> = {
  resale: ["resale", "re sale", "ريسيل", "اعادة بيع"],
  primary: ["primary", "new launch", "developer", "من المطور", "اولى", "أولى"],
  installment_ready: ["installment ready", "installment", "تقسيط", "قسط"],
};

const INDUSTRIAL_TYPE_ALIASES: Record<string, string[]> = {
  factory: ["factory", "plant", "مصنع"],
  warehouse: ["warehouse", "cold storage", "storage", "silo", "مخزن", "مستودع", "ثلاجة", "صومعة"],
  machine: ["machine", "machining", "equipment", "ماكينة", "معدة", "معدات"],
  production_line: ["production line", "bottling", "moulding", "molding", "line", "خط انتاج", "خط إنتاج"],
  land: ["industrial land", "land", "plot", "ارض", "أرض"],
  raw_material: [
    "raw material",
    "raw materials",
    "polymer",
    "granules",
    "resin",
    "pellets",
    "feedstock",
    "مواد خام",
    "مادة خام",
    "بوليمر",
    "حبيبات",
    "خامات",
  ],
};

const INDUSTRY_ALIASES: Record<string, string[]> = {
  food: ["food", "processing", "grain", "اغذية", "غذائية", "طعام"],
  beverage: ["beverage", "drinks", "bottling", "مشروبات"],
  plastic: ["plastic", "injection", "بلاستيك"],
  textile: ["textile", "garment", "weaving", "نسيج", "غزل", "ملابس"],
  pharmaceutical: ["pharma", "pharmaceutical", "ادوية", "أدوية", "دواء"],
  chemical: ["chemical", "كيماويات"],
  engineering: ["engineering", "metal", "cnc", "fabrication", "marble", "هندسية", "معادن"],
};

/* ── Reference data cache ──────────────────────────────── */

interface ReferenceData {
  brands: Array<{ id: string; name: string; slug: string; category: string }>;
  models: Array<{ id: string; brandId: string; name: string; slug: string }>;
  variants: Array<{ id: string; modelId: string; name: string; slug: string }>;
  locations: Array<{ id: string; city: string; area: string; slug: string }>;
  // Vocabulary slug → reference-row id maps (enum value === slug).
  propertyTypeIds: Record<string, string>;
  finishingTypeIds: Record<string, string>;
  ownershipTypeIds: Record<string, string>;
  industrialTypeIds: Record<string, string>;
  industryIds: Record<string, string>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let referenceCache: { at: number; data: ReferenceData } | null = null;

export function invalidateReferenceCache(): void {
  referenceCache = null;
}

async function getReference(): Promise<ReferenceData> {
  if (referenceCache && Date.now() - referenceCache.at < CACHE_TTL_MS) {
    return referenceCache.data;
  }
  const [
    brandRows,
    modelRows,
    variantRows,
    locationRows,
    propertyTypeRows,
    finishingTypeRows,
    ownershipTypeRows,
    industrialTypeRows,
    industryRows,
  ] = await Promise.all([
    db.select({ id: brands.id, name: brands.name, slug: brands.slug, category: brands.category }).from(brands),
    db.select({ id: models.id, brandId: models.brandId, name: models.name, slug: models.slug }).from(models),
    db.select({ id: carVariants.id, modelId: carVariants.modelId, name: carVariants.name, slug: carVariants.slug }).from(carVariants),
    db.select({ id: locations.id, city: locations.city, area: locations.area, slug: locations.slug }).from(locations),
    db.select({ id: propertyTypes.id, slug: propertyTypes.slug }).from(propertyTypes),
    db.select({ id: finishingTypes.id, slug: finishingTypes.slug }).from(finishingTypes),
    db.select({ id: ownershipTypes.id, slug: ownershipTypes.slug }).from(ownershipTypes),
    db.select({ id: industrialTypes.id, slug: industrialTypes.slug }).from(industrialTypes),
    db.select({ id: industries.id, slug: industries.slug }).from(industries),
  ]);
  const toIdMap = (rows: Array<{ id: string; slug: string }>): Record<string, string> =>
    Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  const data: ReferenceData = {
    brands: brandRows,
    models: modelRows,
    variants: variantRows,
    locations: locationRows,
    propertyTypeIds: toIdMap(propertyTypeRows),
    finishingTypeIds: toIdMap(finishingTypeRows),
    ownershipTypeIds: toIdMap(ownershipTypeRows),
    industrialTypeIds: toIdMap(industrialTypeRows),
    industryIds: toIdMap(industryRows),
  };
  referenceCache = { at: Date.now(), data };
  return data;
}

/* ── Text cleaning ─────────────────────────────────────── */

export function cleanText(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/(.)\1{3,}/g, "$1$1$1") // collapse 4+ repeated chars (e.g. "!!!!!")
    .replace(/\s*([،,.])\s*/g, "$1 ")
    .trim();
}

/* ── Category detection (fallback for free-text / bulk import) ── */

export function detectCategory(text: string): Category {
  const n = normalizeText(text);
  const carHits = ["car", "vehicle", "sedan", "suv", "سيارة", "سيارات", "عربية"].filter((k) => n.includes(normalizeText(k))).length;
  const reHits = ["apartment", "villa", "duplex", "studio", "penthouse", "land", "office", "shop", "شقة", "فيلا", "عقار", "ارض"].filter((k) => n.includes(normalizeText(k))).length;
  const indHits = ["factory", "warehouse", "machine", "production", "industrial", "plant", "مصنع", "مخزن", "معدات", "خط انتاج"].filter((k) => n.includes(normalizeText(k))).length;
  if (indHits >= reHits && indHits >= carHits && indHits > 0) return "industrial";
  if (reHits >= carHits && reHits > 0) return "real_estate";
  return "car";
}

/* ── Enum coercion ─────────────────────────────────────── */

function coerceEnum(value: unknown, aliases: Record<string, string[]>): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value);
  const n = normalizeText(raw);
  if (!n) return null;
  // Exact key match
  for (const key of Object.keys(aliases)) {
    if (normalizeText(key) === n) return key;
  }
  // Alias match (whole-word containment or exact)
  for (const [key, list] of Object.entries(aliases)) {
    for (const alias of list) {
      const na = normalizeText(alias);
      if (!na) continue;
      if (n === na || ` ${n} `.includes(` ${na} `) || ` ${na} `.includes(` ${n} `)) return key;
    }
  }
  return null;
}

/** Scan a free-text blob for the first enum value whose alias appears in it. */
function inferEnumFromText(text: string, aliases: Record<string, string[]>): string | null {
  const n = normalizeText(text);
  for (const [key, list] of Object.entries(aliases)) {
    for (const alias of [key, ...list]) {
      const na = normalizeText(alias);
      if (na && ` ${n} `.includes(` ${na} `)) return key;
    }
  }
  return null;
}

/* ── Brand / model / variant / location matching ───────── */

function buildBrandCandidates(ref: ReferenceData): MatchCandidate<{ id: string; name: string; slug: string }>[] {
  return ref.brands
    .filter((b) => b.category === "car")
    .map((b) => ({ item: b, keys: [b.name, b.slug, ...(BRAND_ALIASES[b.slug] ?? [])] }));
}

/**
 * Auto-learn a car brand: insert it into the brands catalogue (idempotent by
 * slug) and return its id + canonical name. Invalidates the reference cache so
 * the new brand resolves on subsequent normalizations. Interactive create/update
 * only (opts.autoLearn) — never bulk import, so CSV typos can't pollute it.
 */
async function learnBrand(rawName: string): Promise<{ id: string; name: string }> {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 80);
  const slug = slugify(name);
  const [inserted] = await db
    .insert(brands)
    .values({ name, slug, category: "car" })
    .onConflictDoNothing()
    .returning({ id: brands.id });
  invalidateReferenceCache();
  if (inserted) return { id: inserted.id, name };
  // Slug already existed (concurrent/repeat insert) — reuse the existing row.
  const [existing] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.slug, slug))
    .limit(1);
  if (existing) return { id: existing.id, name: existing.name };
  throw Object.assign(new Error(`Failed to register brand "${name}".`), {
    code: "INTERNAL_ERROR",
  });
}

function buildModelCandidates(ref: ReferenceData, brandId?: string | null): MatchCandidate<{ id: string; name: string; slug: string }>[] {
  return ref.models
    .filter((m) => (brandId ? m.brandId === brandId : true))
    .map((m) => ({ item: m, keys: [m.name, m.slug, ...(MODEL_ALIASES[slugify(m.name)] ?? [])] }));
}

function buildLocationCandidates(ref: ReferenceData): MatchCandidate<{ id: string; city: string; area: string }>[] {
  return ref.locations.map((l) => ({ item: l, keys: [l.area, l.city, `${l.area} ${l.city}`] }));
}

/* ── Media validation ──────────────────────────────────── */

export interface MediaValidation {
  valid: boolean;
  errors: string[];
  imageCount: number;
  hasVideo: boolean;
  hasDuplicate: boolean;
}

export function validateMedia(media: MediaInput[]): MediaValidation {
  const errors: string[] = [];
  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");

  if (images.length === 0) errors.push("At least one image is required");

  const urls = media.map((m) => m.url.trim().toLowerCase());
  const hasDuplicate = urls.length !== new Set(urls).size;
  if (hasDuplicate) errors.push("Duplicate media files are not allowed");

  for (const m of images) {
    if (m.width && m.height && (m.width < 500 || m.height < 500)) {
      errors.push(`Image resolution too low (minimum 500x500): ${m.url}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    imageCount: images.length,
    hasVideo: videos.length > 0,
    hasDuplicate,
  };
}

/* ── Trust score ───────────────────────────────────────── */

export interface TrustInputs {
  sellerVerified: boolean;
  imageCount: number;
  hasVideo: boolean;
  attributeCompleteness: number; // 0..1
  taxonomyCompleteness: number; // 0..1
  isDuplicate: boolean;
  /** True when a controlled value (car brand) was auto-learned rather than
   *  matched to the curated catalogue — demotes rank below curated listings. */
  autoLearned?: boolean;
}

export function computeTrustScore(p: TrustInputs): number {
  let score = 40; // baseline
  if (p.sellerVerified) score += 20;
  score += Math.round(clamp01(p.attributeCompleteness) * 15);
  score += Math.round(clamp01(p.taxonomyCompleteness) * 15);
  if (p.imageCount >= 3) score += 5;
  else if (p.imageCount >= 1) score += 2;
  if (p.hasVideo) score += 5;
  if (p.isDuplicate) score -= 30;
  if (p.autoLearned) score -= 15; // auto-learned taxonomy ranks below curated matches
  return Math.max(0, Math.min(100, score));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/* ── Attribute completeness per category ───────────────── */

const REQUIRED_SPEC_KEYS: Record<Category, string[]> = {
  car: ["mileage", "year", "condition", "fuel_type"],
  real_estate: ["area", "rooms", "property_type", "finishing"],
  industrial: ["capacity", "industry", "industrial_type"],
};

function attributeCompleteness(category: Category, specs: Record<string, unknown>): number {
  const keys = REQUIRED_SPEC_KEYS[category];
  if (keys.length === 0) return 1;
  const present = keys.filter((k) => {
    const v = specs[k];
    return v !== undefined && v !== null && v !== "";
  }).length;
  return present / keys.length;
}

/* ── Duplicate detection ───────────────────────────────── */

export async function detectDuplicate(params: {
  sellerId: string;
  category: Category;
  price: number;
  title: string;
  modelId?: string | null;
  year?: number | null;
  excludeListingId?: string;
}): Promise<{ isDuplicate: boolean; duplicateOfId: string | null }> {
  const { sellerId, category, price, title, modelId, year, excludeListingId } = params;
  const low = String(price * 0.95);
  const high = String(price * 1.05);

  // Title similarity is computed in-database using PostgreSQL trigram (pg_trgm)
  // matching so it stays consistent with SQL-side indexing and handles fuzzy
  // near-duplicates robustly.
  const simExpr = sql<number>`similarity(${listings.title}, ${title})`;

  // Scope to the same seller, category and a ±5% price band. Title similarity is
  // an independent signal from same-model+same-year, so we do NOT prefilter on it
  // in SQL — a low-text-similarity relisting of the same model/year must still be
  // caught.
  const conditions = [
    eq(listings.userId, sellerId),
    eq(listings.category, category),
    gte(listings.basePriceCash, low),
    lte(listings.basePriceCash, high),
  ];
  if (excludeListingId) conditions.push(ne(listings.id, excludeListingId));

  const candidates = await db
    .select({
      id: listings.id,
      sim: simExpr,
      modelId: listingAttributes.modelId,
      year: sql<number | null>`CASE WHEN ${listingAttributes.specs} ->> 'year' ~ '^[0-9]{1,4}$' THEN (${listingAttributes.specs} ->> 'year')::int ELSE NULL END`,
    })
    .from(listings)
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(and(...conditions))
    .orderBy(sql`${simExpr} DESC`)
    .limit(50);

  for (const c of candidates) {
    const sim = Number(c.sim) || 0;
    const sameModel = !!modelId && c.modelId === modelId;
    const sameYear = year != null && c.year != null && c.year === year;
    // Strong textual (trigram) match, OR same model + same year within the ±5%
    // price band (a near-identical relisting even if the title was reworded).
    if (sim >= 0.7 || (sameModel && sameYear)) {
      return { isDuplicate: true, duplicateOfId: c.id };
    }
  }

  return { isDuplicate: false, duplicateOfId: null };
}

/* ── Listing abuse: spam content ───────────────────────── */

// Conservative spam phrase list (English + Arabic). Kept narrow on purpose — a
// false "hide" is worse than a missed demotion, and price/contact stuffing is
// caught by the structural checks below.
const SPAM_PHRASES = [
  "best price ever",
  "lowest price guaranteed",
  "100% guarantee",
  "100% guaranteed",
  "click here",
  "call now",
  "whatsapp now",
  "limited offer",
  "act now",
  "free gift",
  "make money fast",
  "earn money fast",
  "work from home",
  "double your money",
  "guaranteed profit",
  "risk free",
  "اتصل الان",
  "اضغط هنا",
  "عرض محدود",
  "اقوى عرض",
  "ربح مضمون",
  "فرصة استثمار",
];

/**
 * Scans title/description for spam signals: known spam phrases, embedded URLs,
 * and contact-number stuffing in the title (a common way to dodge the lead
 * funnel). Returns the matched signals; an empty array means clean.
 */
export function detectSpamKeywords(title: string, description?: string): string[] {
  const flags: string[] = [];
  const hay = normalizeText(`${title} ${description ?? ""}`);
  for (const phrase of SPAM_PHRASES) {
    const np = normalizeText(phrase);
    if (np && hay.includes(np)) flags.push(phrase);
  }
  const raw = `${title} ${description ?? ""}`;
  if (/(https?:\/\/|www\.)/i.test(raw)) flags.push("contains_url");
  // A long digit run in the title is almost always a phone number.
  if (/\d{9,}/.test(title.replace(/\s+/g, ""))) flags.push("phone_in_title");
  return flags;
}

/* ── Listing abuse: price outliers ─────────────────────── */

/**
 * Flags a price as a statistical outlier against comparable active listings
 * (same category, scoped by model for cars / property type for real estate).
 * Requires a minimum comparable sample so thin categories don't produce false
 * positives. Outliers are demoted (trust penalty), not hidden.
 */
export async function detectPriceOutlier(params: {
  category: Category;
  price: number;
  modelId?: string | null;
  propertyType?: string | null;
  excludeListingId?: string;
}): Promise<{ isOutlier: boolean; median: number | null; sampleSize: number }> {
  const { category, price, modelId, propertyType, excludeListingId } = params;
  if (!Number.isFinite(price) || price <= 0) return { isOutlier: false, median: null, sampleSize: 0 };

  const conditions = [eq(listings.status, "active"), eq(listings.category, category)];
  if (category === "car" && modelId) conditions.push(eq(listingAttributes.modelId, modelId));
  if (category === "real_estate" && propertyType) conditions.push(eq(listingAttributes.propertyType, propertyType as typeof listingAttributes.propertyType.enumValues[number]));
  if (excludeListingId) conditions.push(ne(listings.id, excludeListingId));

  const [stats] = await db
    .select({
      median: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${listings.basePriceCash}::numeric)`,
      n: sql<number>`count(*)`,
    })
    .from(listings)
    .leftJoin(listingAttributes, eq(listingAttributes.listingId, listings.id))
    .where(and(...conditions));

  const sampleSize = Number(stats?.n ?? 0);
  const median = stats?.median != null ? Number(stats.median) : null;
  // Need a meaningful comparable set; otherwise we can't judge.
  if (median == null || median <= 0 || sampleSize < 8) {
    return { isOutlier: false, median, sampleSize };
  }

  const isOutlier = price < median * 0.25 || price > median * 4;
  return { isOutlier, median, sampleSize };
}

/* ── Main pipeline ─────────────────────────────────────── */

function reject(message: string): never {
  throw Object.assign(new Error(message), { code: "INVALID_DATA" });
}

export async function normalizeListing(
  input: NormalizeInput,
  opts: {
    sellerId: string;
    sellerVerified: boolean;
    excludeListingId?: string;
    /** When false, missing/duplicate media downgrades trust instead of rejecting. Default true. */
    requireMedia?: boolean;
    /** When true (e.g. bulk import), unmatched controlled values warn instead of rejecting. Default false. */
    lenient?: boolean;
    /** When true (interactive create/update), a genuinely-new controlled value
     *  (currently: car brand) is AUTO-LEARNED into the catalogue instead of left
     *  unresolved — so it becomes searchable/pickable for everyone. Bulk import
     *  leaves this off so CSV typos never pollute the catalogue. Default false. */
    autoLearn?: boolean;
  }
): Promise<NormalizationResult> {
  const ref = await getReference();
  const warnings: string[] = [];
  // Set when a controlled value (car brand) is auto-learned — demotes trust/rank.
  let autoLearned = false;
  const requireMedia = opts.requireMedia !== false;

  // In lenient mode an unmatched controlled value is recorded as a warning and
  // left unresolved; in strict mode it aborts the operation.
  const failOrWarn = (message: string): void => {
    if (opts.lenient) {
      warnings.push(message);
      return;
    }
    reject(message);
  };

  const title = cleanText(input.title);
  const description = input.description ? cleanText(input.description) : undefined;
  const specs: Record<string, unknown> = { ...input.specs };
  const titleAndSpecs = `${title} ${Object.values(specs).map(String).join(" ")}`;

  // Category detection: infer from free text when not provided; when provided,
  // flag a mismatch against the detected category as a non-fatal signal.
  const detected = detectCategory(titleAndSpecs);
  const category: Category = input.category ?? detected;
  if (input.category && detected !== input.category) {
    warnings.push(
      `Provided category "${input.category}" differs from detected category "${detected}".`
    );
  }

  const taxonomy: NormalizedTaxonomy = {
    brandId: null,
    modelId: null,
    variantId: null,
    fuelType: null,
    condition: null,
    bodyType: null,
    transmission: null,
    propertyType: null,
    finishingType: null,
    ownershipType: null,
    industrialType: null,
    industry: null,
    propertyTypeId: null,
    finishingTypeId: null,
    ownershipTypeId: null,
    industrialTypeId: null,
    industryId: null,
  };

  /* — Media validation — */
  const mediaResult = validateMedia(input.media);
  if (!mediaResult.valid) {
    if (requireMedia) {
      reject(mediaResult.errors.join("; "));
    } else {
      warnings.push(...mediaResult.errors);
    }
  }

  /* — Location matching (controlled taxonomy) — */
  const locMatch = bestMatch(input.location, buildLocationCandidates(ref), 0.7);
  const locationId = locMatch?.item.id ?? null;
  const locationCanonical = locMatch
    ? [locMatch.item.area, locMatch.item.city].filter(Boolean).join("، ") || null
    : null;
  if (input.location && !locationId) {
    failOrWarn(`Unrecognized location: "${input.location}". Please choose a supported area.`);
  }

  /* — Category-specific taxonomy resolution — */
  if (category === "car") {
    // Brand: from specs.brand (reject if provided & unmatchable), else infer from title.
    const brandRaw = pickString(specs, ["brand", "make", "manufacturer"]);
    if (brandRaw) {
      const m = bestMatch(brandRaw, buildBrandCandidates(ref));
      if (m) {
        taxonomy.brandId = m.item.id;
        specs.brand = m.item.name;
      } else if (opts.autoLearn) {
        // Genuinely-new brand (no fuzzy match): learn it into the catalogue so it
        // becomes searchable/pickable for everyone, and resolve this listing to
        // it. Demoted in rank via the autoLearned trust penalty. Fuzzy matching
        // above already absorbs typos, so only real new brands reach here.
        const learned = await learnBrand(brandRaw);
        taxonomy.brandId = learned.id;
        specs.brand = learned.name;
        autoLearned = true;
        warnings.push(`New car brand auto-added to the catalogue: "${learned.name}".`);
      } else {
        failOrWarn(`Unrecognized car brand: "${brandRaw}". Please choose a supported brand.`);
      }
    } else {
      const m = bestMatch(title, buildBrandCandidates(ref), 0.9);
      if (m) {
        taxonomy.brandId = m.item.id;
        specs.brand = m.item.name;
      } else {
        warnings.push("Car brand could not be determined from the title.");
      }
    }

    // Model: scoped to matched brand. Reject if provided & unmatchable.
    const modelRaw = pickString(specs, ["model"]);
    if (modelRaw) {
      const m = bestMatch(modelRaw, buildModelCandidates(ref, taxonomy.brandId));
      if (!m) {
        failOrWarn(`Unrecognized model: "${modelRaw}". Please choose a supported model.`);
      } else {
        taxonomy.modelId = m.item.id;
        specs.model = m.item.name;
      }
    } else {
      const m = bestMatch(title, buildModelCandidates(ref, taxonomy.brandId), 0.92);
      if (m) {
        taxonomy.modelId = m.item.id;
        specs.model = m.item.name;
      }
    }

    // Variant (best-effort)
    if (taxonomy.modelId) {
      const variantCandidates = ref.variants
        .filter((v) => v.modelId === taxonomy.modelId)
        .map((v) => ({ item: v, keys: [v.name, v.slug] }));
      const variantRaw = pickString(specs, ["variant", "trim"]) ?? title;
      const vm = bestMatch(variantRaw, variantCandidates, 0.85);
      if (vm) {
        taxonomy.variantId = vm.item.id;
        specs.variant = vm.item.name;
      }
    }

    taxonomy.fuelType = coerceEnum(specs.fuel_type ?? specs.fuel, FUEL_ALIASES) ?? inferEnumFromText(titleAndSpecs, FUEL_ALIASES);
    taxonomy.condition = coerceEnum(specs.condition, CONDITION_ALIASES) ?? inferEnumFromText(titleAndSpecs, CONDITION_ALIASES);
    taxonomy.transmission = coerceEnum(specs.transmission, TRANSMISSION_ALIASES) ?? inferEnumFromText(titleAndSpecs, TRANSMISSION_ALIASES);
    taxonomy.bodyType = coerceEnum(specs.body_type ?? specs.bodyType, BODY_TYPE_ALIASES) ?? inferEnumFromText(titleAndSpecs, BODY_TYPE_ALIASES);

    enforceEnum(specs, ["fuel_type", "fuel"], taxonomy.fuelType, "fuel type", failOrWarn);
    enforceEnum(specs, ["condition"], taxonomy.condition, "condition", failOrWarn);
    enforceEnum(specs, ["transmission"], taxonomy.transmission, "transmission", failOrWarn);
    enforceEnum(specs, ["body_type", "bodyType"], taxonomy.bodyType, "body type", failOrWarn);

    if (taxonomy.fuelType) specs.fuel_type = taxonomy.fuelType;
    if (taxonomy.condition) specs.condition = taxonomy.condition;
    if (taxonomy.transmission) specs.transmission = taxonomy.transmission;
    if (taxonomy.bodyType) specs.body_type = taxonomy.bodyType;
  } else if (category === "real_estate") {
    taxonomy.propertyType =
      coerceEnum(specs.property_type ?? specs.type, PROPERTY_TYPE_ALIASES) ?? inferEnumFromText(titleAndSpecs, PROPERTY_TYPE_ALIASES);
    const propRaw = pickString(specs, ["property_type", "type"]);
    if (propRaw && !taxonomy.propertyType) {
      failOrWarn(`Unrecognized property type: "${propRaw}". Please choose a supported type.`);
    }
    taxonomy.finishingType = coerceEnum(specs.finishing ?? specs.finishing_type, FINISHING_ALIASES) ?? inferEnumFromText(titleAndSpecs, FINISHING_ALIASES);
    taxonomy.ownershipType = coerceEnum(specs.ownership ?? specs.ownership_type, OWNERSHIP_ALIASES) ?? inferEnumFromText(titleAndSpecs, OWNERSHIP_ALIASES);

    enforceEnum(specs, ["finishing", "finishing_type"], taxonomy.finishingType, "finishing type", failOrWarn);
    enforceEnum(specs, ["ownership", "ownership_type"], taxonomy.ownershipType, "ownership type", failOrWarn);

    if (taxonomy.propertyType) specs.property_type = taxonomy.propertyType;
    if (taxonomy.finishingType) specs.finishing = taxonomy.finishingType;
    if (taxonomy.ownershipType) specs.ownership = taxonomy.ownershipType;

    if (taxonomy.propertyType) taxonomy.propertyTypeId = ref.propertyTypeIds[taxonomy.propertyType] ?? null;
    if (taxonomy.finishingType) taxonomy.finishingTypeId = ref.finishingTypeIds[taxonomy.finishingType] ?? null;
    if (taxonomy.ownershipType) taxonomy.ownershipTypeId = ref.ownershipTypeIds[taxonomy.ownershipType] ?? null;
  } else if (category === "industrial") {
    taxonomy.industrialType = coerceEnum(specs.industrial_type ?? specs.type, INDUSTRIAL_TYPE_ALIASES) ?? inferEnumFromText(titleAndSpecs, INDUSTRIAL_TYPE_ALIASES);
    taxonomy.industry = coerceEnum(specs.industry, INDUSTRY_ALIASES) ?? inferEnumFromText(titleAndSpecs, INDUSTRY_ALIASES);

    enforceEnum(specs, ["industrial_type", "type"], taxonomy.industrialType, "industrial type", failOrWarn);
    enforceEnum(specs, ["industry"], taxonomy.industry, "industry", failOrWarn);

    if (taxonomy.industrialType) specs.industrial_type = taxonomy.industrialType;
    if (taxonomy.industry) specs.industry = taxonomy.industry;

    if (taxonomy.industrialType) taxonomy.industrialTypeId = ref.industrialTypeIds[taxonomy.industrialType] ?? null;
    if (taxonomy.industry) taxonomy.industryId = ref.industryIds[taxonomy.industry] ?? null;
  }

  /* — Duplicate detection — */
  const yearRaw = specs.year ?? specs.year_of_manufacture;
  const year = yearRaw != null && Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : null;
  const dupe = await detectDuplicate({
    sellerId: opts.sellerId,
    category,
    price: input.base_price_cash,
    title,
    modelId: taxonomy.modelId,
    year,
    excludeListingId: opts.excludeListingId,
  });

  /* — Listing abuse: spam content & price outliers — */
  const spamFlags = detectSpamKeywords(title, description);
  const outlier = await detectPriceOutlier({
    category,
    price: input.base_price_cash,
    modelId: taxonomy.modelId,
    propertyType: taxonomy.propertyType,
    excludeListingId: opts.excludeListingId,
  });
  const isPriceOutlier = outlier.isOutlier;
  if (isPriceOutlier) {
    warnings.push(
      `Price ${input.base_price_cash} is far from the typical ${category} price (~${Math.round(outlier.median ?? 0)}).`,
    );
  }

  /* — Trust score — */
  const taxonomyKeys = Object.values(taxonomy);
  const taxonomyResolved = taxonomyKeys.filter((v) => v !== null).length;
  const taxonomyExpected = category === "car" ? 6 : category === "real_estate" ? 3 : 2;
  let trustScore = computeTrustScore({
    sellerVerified: opts.sellerVerified,
    imageCount: mediaResult.imageCount,
    hasVideo: mediaResult.hasVideo,
    attributeCompleteness: attributeCompleteness(category, specs),
    taxonomyCompleteness: Math.min(1, taxonomyResolved / taxonomyExpected),
    isDuplicate: dupe.isDuplicate,
    autoLearned,
  });

  // Spam → hide (flagged) and zero-out trust. Price outlier → heavy demotion.
  const isFlagged = spamFlags.length > 0;
  let flagReason: string | null = null;
  if (isFlagged) {
    flagReason = `spam: ${spamFlags.join(", ")}`;
    trustScore = Math.max(0, trustScore - 40);
  } else if (isPriceOutlier) {
    flagReason = "price_outlier";
  }
  if (isPriceOutlier) trustScore = Math.max(0, trustScore - 25);

  return {
    title,
    description,
    category,
    locationId,
    locationCanonical,
    taxonomy,
    specs,
    trustScore,
    isDuplicate: dupe.isDuplicate,
    duplicateOfId: dupe.duplicateOfId,
    spamFlags,
    isPriceOutlier,
    isFlagged,
    flagReason,
    warnings,
  };
}

/* ── Helpers ───────────────────────────────────────────── */

function pickString(specs: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = specs[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * Enforces a controlled enum field: when the seller PROVIDED a value under any of
 * `keys` but it could not be resolved to a valid taxonomy value, reject (strict)
 * or warn (lenient). Keeps controlled attributes from persisting as free text.
 */
function enforceEnum(
  specs: Record<string, unknown>,
  keys: string[],
  resolved: string | null,
  label: string,
  failOrWarn: (message: string) => void
): void {
  if (resolved) return;
  const raw = pickString(specs, keys);
  if (raw) {
    failOrWarn(`Unrecognized ${label}: "${raw}". Please choose a supported ${label}.`);
  }
}
