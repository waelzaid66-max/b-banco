import type { Href } from "expo-router";
import type { Notification } from "@workspace/api-client-react";

/**
 * Single source of truth for where a notification deep-links on tap. Used by
 * both the in-app notifications feed (notifications.tsx) and the remote-push
 * tap handler (usePushNotifications), so a push and its in-app twin always
 * route to the exact same destination (Task #102).
 *
 * `data` carries typed ids the server attaches (conversation_id, listing_id,
 * rfq_id, etc.); we route off whichever is present for the notification type.
 * Returns null when there is no meaningful destination — callers fall back to
 * the notifications list.
 */
export function routeForNotification(
  type: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
): Href | null {
  const d = (data ?? {}) as Record<string, unknown>;

  if (type === "message" && typeof d.conversation_id === "string") {
    const params: { id: string; name?: string; listingId?: string; role?: string } = {
      id: d.conversation_id,
    };
    if (typeof d.listing_id === "string") params.listingId = d.listing_id;
    if (typeof d.counterparty_name === "string" && d.counterparty_name.trim()) {
      params.name = d.counterparty_name.trim();
    }
    if (d.viewer_role === "buyer" || d.viewer_role === "seller") {
      params.role = d.viewer_role;
    }
    return { pathname: "/messages/[id]", params };
  }

  if (type === "rfq" && typeof d.rfq_id === "string") {
    return { pathname: "/rfq/[id]", params: { id: d.rfq_id } };
  }

  if (type === "investment" && typeof d.investment_id === "string") {
    return {
      pathname: "/business/investments/[id]",
      params: { id: d.investment_id },
    };
  }

  if (type === "global_supply" && typeof d.request_id === "string") {
    return {
      pathname: "/business/global-supply/[id]",
      params: { id: d.request_id },
    };
  }

  // A new booking request → the host's booking inbox (not the listing), so the
  // host lands right where they confirm/reject.
  if (type === "booking") {
    return { pathname: "/bookings", params: { role: "host" } } as Href;
  }

  if (
    type === "payment_success" ||
    type === "payment_failed" ||
    type === "subscription_expiring"
  ) {
    return "/billing" as Href;
  }

  // comment, price_drop, new_match, lead, review, system, verification → listing when present.
  if (typeof d.listing_id === "string") {
    return { pathname: "/listing/[id]", params: { id: d.listing_id } };
  }

  if (type === "review") {
    return "/(tabs)/profile";
  }

  // Verification / business account updates land on the business hub.
  if (
    type === "verification" ||
    type === "account" ||
    type === "business" ||
    type === "dealer"
  ) {
    return "/business/supply-hub" as Href;
  }

  // Lead without listing id → seller leads inbox when available.
  if (type === "lead") {
    return "/business/requests" as Href;
  }

  return null;
}

/** Convenience overload for an in-app Notification record. */
export function routeForNotificationItem(n: Notification): Href | null {
  return routeForNotification(
    n.type,
    (n.data ?? null) as Record<string, unknown> | null,
  );
}

/** Public listing detail is the only push destination guests may open. */
export function notificationRequiresAuth(dest: Href): boolean {
  if (typeof dest === "string") {
    return !dest.startsWith("/listing/");
  }
  const path = dest.pathname ?? "";
  return path !== "/listing/[id]";
}
