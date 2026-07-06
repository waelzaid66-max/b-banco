import type { FeedItem } from "../validators/schemas";
import type { NormalizedPayment } from "./PaymentService";

interface RawListingRow {
  id: string;
  title: string;
  category: "car" | "real_estate" | "industrial";
  base_price_cash: string;
  location: string;
  status: string | null;
  created_at: Date | string;
  user_id: string | null;
  is_verified: boolean | null;
  user_name: string | null;
  user_role: string | null;
  quality_score?: number | null;
  views: number;
  clicks: number;
  thumbnail_url: string | null;
  has_video: boolean;
  is_sponsored: boolean;
  payment: NormalizedPayment;
  // Additive (Task #32): display coordinates (listing override → area centroid)
  // and the provider-tagged best-offer feed hook. Both nullable.
  coordinates: { lat: number; lng: number } | null;
  best_offer_badge: string | null;
  // Additive: industrial sub-type for client-side category grouping (null for car/real_estate).
  industrial_type: string | null;
  // Additive: seller opted this listing in to WhatsApp contact (opt-in only).
  whatsapp_enabled?: boolean | null;
  // Additive: buyer "request/wanted" post. Drives the price_display fallback
  // and the client "طلب / Wanted" badge. Optional/nullable for legacy rows.
  is_request?: boolean | null;
  // Additive: rental context from specs — drives the honest price-period suffix.
  offer_type?: string | null;
  rental_term?: string | null;
}

/**
 * Rentals are quoted per period, not as a lump sum — showing "15K EGP" alone on
 * a rental misleads. The suffix follows the listing's actual rental system:
 * furnished_daily → /يوم, annual_contract (Gulf yearly tenancy) → /سنة,
 * everything else rented (new_law / old_law / unspecified) → /شهر (the EG norm).
 */
function rentPeriodSuffix(row: RawListingRow): string {
  if (row.offer_type !== "rent") return "";
  if (row.rental_term === "furnished_daily") return " /يوم";
  if (row.rental_term === "annual_contract") return " /سنة";
  return " /شهر";
}

function formatEGP(value: string | number): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")}M EGP`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString("en-EG")}K EGP`;
  return `${n.toLocaleString("en-EG")} EGP`;
}

function buildUrgencySignal(views: number, clicks: number): string | null {
  if (views > 500) return `🔥 Viewed ${views.toLocaleString()} times`;
  if (views > 100) return `👁 ${views} views today`;
  if (clicks > 50) return `⚡ High demand`;
  return null;
}

const TOP_DEALER_ROLES = new Set(["dealer", "company", "enterprise"]);

function buildTrustSignal(
  isVerified: boolean | null,
  role: string | null,
  qualityScore?: number | null
): string {
  // High-performing verified dealers earn an elevated "Top Dealer" signal.
  if (isVerified && role && TOP_DEALER_ROLES.has(role) && (qualityScore ?? 0) >= 80) {
    return "Top Dealer";
  }
  if (isVerified && role === "dealer") return "Verified Dealer";
  if (isVerified && role === "company") return "Verified Company";
  if (isVerified) return "Verified Seller";
  return "Private Seller";
}

function buildSmartBadge(row: RawListingRow): string | null {
  if (row.views > 200 && row.clicks > 20) return "🔥 Trending";
  if (row.clicks > 50) return "High Demand";
  if (row.payment.has_installment && row.payment.lowest_down_payment) return "Easy Installment";
  if (row.is_sponsored) return "Featured";
  return null;
}

/**
 * BFF transformation: converts raw DB row → UI-ready FeedItem.
 * Drops listings missing critical fields (id, media_preview, price).
 */
export function transformToFeedItem(row: RawListingRow): FeedItem | null {
  if (!row.id || !row.thumbnail_url || !row.base_price_cash) return null;

  return {
    id: row.id,
    media_preview: row.thumbnail_url,
    // Buyer requests carry no asking price (base_price_cash is a 0 placeholder);
    // surface an honest "price requested" label instead of "0 EGP".
    price_display: row.is_request
      ? "طلب سعر / Price requested"
      : formatEGP(row.base_price_cash) + rentPeriodSuffix(row),
    installment_badge: row.payment.badge,
    title: row.title,
    location: row.location,
    urgency_signal: buildUrgencySignal(row.views, row.clicks),
    trust_signal: buildTrustSignal(row.is_verified, row.user_role, row.quality_score),
    smart_badge: buildSmartBadge(row),
    has_video: row.has_video,
    is_sponsored: row.is_sponsored,
    coordinates: row.coordinates,
    best_offer_badge: row.best_offer_badge,
    industrial_type: row.industrial_type,
    // The listing's main section, verbatim — powers per-section client UI.
    category: row.category ?? null,
    // Owner-facing surfaces gate Promote on this; public feeds are already
    // active-only so it is true there too.
    is_active: row.status === "active",
    // Opt-in only — false unless the seller explicitly enabled WhatsApp.
    whatsapp_enabled: row.whatsapp_enabled === true,
    // ISO timestamp for owner-facing "Listed <date>" captions. row.created_at
    // is required upstream (Date or ISO string); normalize to ISO, never null
    // in practice but typed nullable to honor the additive contract.
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at ?? null),
    // Buyer request/wanted flag for the "طلب / Wanted" badge; null when unknown.
    is_request: row.is_request ?? null,
    // Additive: bookable when it's a furnished/daily real-estate rental (hotel
    // model) — surfaces the "قابل للحجز / Bookable" badge on cards + map pins.
    is_bookable:
      row.category === "real_estate" && row.rental_term === "furnished_daily",
  };
}

/**
 * Batch transform: filters out null results (incomplete listings).
 */
export function transformFeedItems(rows: RawListingRow[]): FeedItem[] {
  return rows.map(transformToFeedItem).filter((item): item is FeedItem => item !== null);
}

export type { RawListingRow };
