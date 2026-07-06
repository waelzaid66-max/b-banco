import { describe, it, expect } from "vitest";
import { transformToFeedItem } from "./BffService";
import type { NormalizedPayment } from "./PaymentService";

/**
 * Pure-function coverage for the FeedItem projection — specifically the additive
 * `is_bookable` flag that drives the "قابل للحجز / Bookable" card + map-pin badge.
 * No DB: transformToFeedItem is a deterministic mapper, so this is fast and CI-safe.
 */

const EMPTY_PAYMENT: NormalizedPayment = {
  has_installment: false,
  options: [],
  lowest_monthly: null,
  lowest_down_payment: null,
  badge: null,
};

// Minimal valid raw row; override per case. `as never` because RawListingRow is
// not exported — we build exactly the fields transformToFeedItem reads.
function row(over: Record<string, unknown>) {
  return {
    id: "L1",
    title: "Nice flat",
    category: "real_estate",
    base_price_cash: "500",
    location: "New Cairo",
    status: "active",
    created_at: new Date("2030-01-01T00:00:00Z"),
    user_id: "U1",
    is_verified: true,
    user_name: "Owner",
    user_role: "individual",
    views: 0,
    clicks: 0,
    thumbnail_url: "https://cdn.example/x.jpg",
    has_video: false,
    is_sponsored: false,
    payment: EMPTY_PAYMENT,
    coordinates: null,
    best_offer_badge: null,
    industrial_type: null,
    ...over,
  } as never;
}

describe("transformToFeedItem — is_bookable", () => {
  it("is true ONLY for a furnished/daily real-estate rental (the hotel model)", () => {
    const item = transformToFeedItem(
      row({ category: "real_estate", rental_term: "furnished_daily" }),
    );
    expect(item?.is_bookable).toBe(true);
  });

  it("is false for a long-term real-estate rental", () => {
    for (const term of ["new_law", "old_law", "annual_contract"]) {
      const item = transformToFeedItem(row({ category: "real_estate", rental_term: term }));
      expect(item?.is_bookable, `term=${term}`).toBe(false);
    }
  });

  it("is false for real-estate with no rental term (a sale)", () => {
    const item = transformToFeedItem(row({ category: "real_estate", rental_term: null }));
    expect(item?.is_bookable).toBe(false);
  });

  it("is false for a furnished_daily value on a NON real-estate category", () => {
    // Defensive: the flag must gate on category too, not just the term string.
    const item = transformToFeedItem(
      row({ category: "car", rental_term: "furnished_daily" }),
    );
    expect(item?.is_bookable).toBe(false);
  });

  it("does not disturb the other additive flags", () => {
    const item = transformToFeedItem(
      row({ category: "real_estate", rental_term: "furnished_daily", is_request: false }),
    );
    expect(item?.category).toBe("real_estate");
    expect(item?.is_request).toBe(false);
    expect(item?.is_bookable).toBe(true);
  });
});
