/**
 * Auto-save draft for the Create-Listing wizard (#2 "حفظ تلقائي لو خرج المستخدم").
 *
 * PURE + DEFENSIVE by design: it persists only the serialisable text/selection
 * fields, never the picked photo assets (those are device-session URIs that don't
 * survive a restart). `parseListingDraft` validates EVERY field and returns null
 * on bad JSON, wrong version, expiry, or any type mismatch — so a corrupt or
 * stale blob can never partially corrupt the form. No React/RN/storage imports
 * here, so the logic is unit-checkable in isolation.
 */

export interface DraftPlan {
  mode: string;
  downPayment: string;
  monthlyPayment: string;
  durationMonths: string;
  isIslamic: boolean;
}

export interface DraftPhone {
  country: string;
  number: string;
}

/** A free-form seller-added spec (name/value) — unlimited, market-driven. */
export interface DraftCustomSpec {
  name: string;
  value: string;
}

export interface ListingDraftV1 {
  v: 1;
  savedAt: number;
  step: number;
  category: string | null;
  title: string;
  description: string;
  location: string;
  locationValue: string | null;
  cashPrice: string;
  isRequest: boolean;
  whatsappEnabled: boolean;
  specs: Record<string, string>;
  customSpecs: DraftCustomSpec[];
  carBrandValue: string | null;
  carModel: string | null;
  industrialType: string | null;
  carOrigin: "local" | "imported" | null;
  phones: DraftPhone[];
  plans: DraftPlan[];
}

/** The fields a caller supplies; `v`/`savedAt` are stamped on serialize. */
export type ListingDraftInput = Omit<ListingDraftV1, "v" | "savedAt">;

export const LISTING_DRAFT_KEY = "banco:listing-draft:v1";
export const LISTING_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const isStr = (x: unknown): x is string => typeof x === "string";
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** True when the draft holds something worth restoring (don't persist an empty form). */
export function listingDraftHasContent(d: ListingDraftInput): boolean {
  return !!(
    d.category ||
    d.title.trim() ||
    d.description.trim() ||
    d.cashPrice.trim() ||
    d.locationValue ||
    d.carBrandValue ||
    d.industrialType ||
    Object.keys(d.specs).length > 0 ||
    d.customSpecs.some((c) => c.name.trim() || c.value.trim())
  );
}

export function serializeListingDraft(d: ListingDraftInput, now: number = Date.now()): string {
  const out: ListingDraftV1 = { v: 1, savedAt: now, ...d };
  return JSON.stringify(out);
}

function parseStrRecord(x: unknown): Record<string, string> | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!isStr(v)) return null;
    out[k] = v;
  }
  return out;
}

function parsePhones(x: unknown): DraftPhone[] | null {
  if (!Array.isArray(x)) return null;
  const out: DraftPhone[] = [];
  for (const p of x) {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (!isStr(o.country) || !isStr(o.number)) return null;
    out.push({ country: o.country, number: o.number });
  }
  return out;
}

function parsePlans(x: unknown): DraftPlan[] | null {
  if (!Array.isArray(x)) return null;
  const out: DraftPlan[] = [];
  for (const p of x) {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (
      !isStr(o.mode) ||
      !isStr(o.downPayment) ||
      !isStr(o.monthlyPayment) ||
      !isStr(o.durationMonths) ||
      !isBool(o.isIslamic)
    ) {
      return null;
    }
    out.push({
      mode: o.mode,
      downPayment: o.downPayment,
      monthlyPayment: o.monthlyPayment,
      durationMonths: o.durationMonths,
      isIslamic: o.isIslamic,
    });
  }
  return out;
}

function parseCustomSpecs(x: unknown): DraftCustomSpec[] | null {
  if (x === undefined) return []; // backward-compat: older drafts had none
  if (!Array.isArray(x)) return null;
  const out: DraftCustomSpec[] = [];
  for (const p of x) {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (!isStr(o.name) || !isStr(o.value)) return null;
    out.push({ name: o.name, value: o.value });
  }
  return out;
}

/**
 * Strictly validate a stored blob. Returns null on bad JSON, wrong version,
 * expiry, or ANY field-type mismatch — never a partially-populated object.
 */
export function parseListingDraft(raw: string | null, now: number = Date.now()): ListingDraftV1 | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  if (o.v !== 1) return null;
  if (!isNum(o.savedAt) || now - o.savedAt > LISTING_DRAFT_TTL_MS) return null;
  if (!isNum(o.step)) return null;
  if (!(o.category === null || isStr(o.category))) return null;
  if (!isStr(o.title) || !isStr(o.description) || !isStr(o.location) || !isStr(o.cashPrice)) return null;
  if (!(o.locationValue === null || isStr(o.locationValue))) return null;
  if (!isBool(o.isRequest) || !isBool(o.whatsappEnabled)) return null;
  const specs = parseStrRecord(o.specs);
  if (!specs) return null;
  const customSpecs = parseCustomSpecs(o.customSpecs);
  if (!customSpecs) return null;
  if (!(o.carBrandValue === null || isStr(o.carBrandValue))) return null;
  if (!(o.carModel === null || isStr(o.carModel))) return null;
  if (!(o.industrialType === null || isStr(o.industrialType))) return null;
  if (!(o.carOrigin === null || o.carOrigin === "local" || o.carOrigin === "imported")) return null;
  const phones = parsePhones(o.phones);
  if (!phones) return null;
  const plans = parsePlans(o.plans);
  if (!plans) return null;

  return {
    v: 1,
    savedAt: o.savedAt,
    step: o.step,
    category: o.category as string | null,
    title: o.title,
    description: o.description,
    location: o.location,
    locationValue: o.locationValue as string | null,
    cashPrice: o.cashPrice,
    isRequest: o.isRequest,
    whatsappEnabled: o.whatsappEnabled,
    specs,
    customSpecs,
    carBrandValue: o.carBrandValue as string | null,
    carModel: o.carModel as string | null,
    industrialType: o.industrialType as string | null,
    carOrigin: o.carOrigin as ListingDraftV1["carOrigin"],
    phones,
    plans,
  };
}
