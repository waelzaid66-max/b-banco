import { Feather } from "@/components/icons";
import {
  useListBookings,
  getListBookingsQueryKey,
  useUpdateBooking,
  type BookingListItem,
  type ListBookingsRole,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

/**
 * The booking inbox — the other half of the hotel model. Two sides of the same
 * data: "Trips" (stays I requested as a guest) and "Requests" (incoming bookings
 * on my listings, where I confirm or reject). Role separation is the whole point,
 * so it is the primary control at the top. Purely additive: a new screen wired to
 * GET /v1/bookings + PATCH /v1/bookings/:id, using the app's theme + i18n.
 */

// Status → colour + icon. Universal booking semantics, scoped to this screen.
const STATUS_META: Record<
  string,
  { color: string; icon: React.ComponentProps<typeof Feather>["name"] }
> = {
  requested: { color: "#E0A106", icon: "clock" },
  confirmed: { color: "#1FA97D", icon: "check-circle" },
  rejected: { color: "#E0393B", icon: "x-circle" },
  cancelled: { color: "#8A8A8E", icon: "slash" },
};

function money(n: number | null | undefined, currency: string): string | null {
  if (typeof n !== "number") return null;
  return `${Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${currency}`;
}

export default function BookingsScreen() {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rowDir = isRTL ? "row-reverse" : "row";
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<ListBookingsRole>(
    roleParam === "host" ? "host" : "guest",
  );

  useEffect(() => {
    if (roleParam === "host" || roleParam === "guest") {
      setRole(roleParam);
    }
  }, [roleParam]);
  const { data, isLoading, isError, refetch, isRefetching } = useListBookings(
    { role },
    { query: { queryKey: getListBookingsQueryKey({ role }) } },
  );
  const { mutate, isPending } = useUpdateBooking();
  const [actingId, setActingId] = useState<string | null>(null);

  const items = data?.data ?? [];

  const act = (id: string, action: "confirm" | "reject" | "cancel") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActingId(id);
    mutate(
      { id, data: { action } },
      {
        onSettled: () => setActingId(null),
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Both sides + the listing's availability may have changed.
          queryClient.invalidateQueries({ queryKey: ["listBookings"] });
          queryClient.invalidateQueries({ queryKey: ["getListingAvailability"] });
        },
      },
    );
  };

  const renderItem = ({ item }: { item: BookingListItem }) => {
    const meta = STATUS_META[item.status] ?? STATUS_META.requested;
    const total = money(item.total_price, item.currency);
    const isHost = role === "host";
    const busy = isPending && actingId === item.id;
    // Available actions per side + state (mirrors the server's rules).
    const canConfirm = isHost && item.status === "requested";
    const canReject = isHost && item.status === "requested";
    const canCancel =
      !isHost && (item.status === "requested" || item.status === "confirmed");

    return (
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}
        onPress={() => router.push(`/listing/${item.listing_id}`)}
        testID={`booking-row-${item.id}`}
      >
        <View style={[styles.cardTop, { flexDirection: rowDir }]}>
          <AppText style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {item.listing_title}
          </AppText>
          <View style={[styles.statusPill, { backgroundColor: meta.color + "1A", flexDirection: rowDir }]}>
            <Feather name={meta.icon} size={12} color={meta.color} />
            <AppText style={[styles.statusText, { color: meta.color }]}>
              {t(`bookings.status.${item.status}`)}
            </AppText>
          </View>
        </View>

        <View style={[styles.metaRow, { flexDirection: rowDir }]}>
          <Feather name="calendar" size={13} color={colors.mutedForeground} />
          <AppText style={[styles.metaText, { color: colors.mutedForeground }]}>
            {item.check_in} → {item.check_out} · {item.nights} {t("booking.nights")}
          </AppText>
        </View>

        {item.counterparty_name ? (
          <View style={[styles.metaRow, { flexDirection: rowDir }]}>
            <Feather name={isHost ? "user" : "home"} size={13} color={colors.mutedForeground} />
            <AppText style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.counterparty_name}
            </AppText>
          </View>
        ) : null}

        <View style={[styles.cardBottom, { flexDirection: rowDir }]}>
          {total ? (
            <AppText style={[styles.total, { color: colors.foreground }]}>{total}</AppText>
          ) : (
            <View />
          )}

          {canConfirm || canReject || canCancel ? (
            <View style={[styles.actions, { flexDirection: rowDir }]}>
              {busy ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <>
                  {canReject ? (
                    <Pressable
                      onPress={() => act(item.id, "reject")}
                      style={[styles.actionBtn, { borderColor: colors.border }]}
                      testID={`booking-reject-${item.id}`}
                    >
                      <AppText style={[styles.actionText, { color: colors.destructive }]}>
                        {t("bookings.reject")}
                      </AppText>
                    </Pressable>
                  ) : null}
                  {canConfirm ? (
                    <Pressable
                      onPress={() => act(item.id, "confirm")}
                      style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                      testID={`booking-confirm-${item.id}`}
                    >
                      <AppText style={[styles.actionText, { color: colors.primaryForeground }]}>
                        {t("bookings.confirm")}
                      </AppText>
                    </Pressable>
                  ) : null}
                  {canCancel ? (
                    <Pressable
                      onPress={() => act(item.id, "cancel")}
                      style={[styles.actionBtn, { borderColor: colors.border }]}
                      testID={`booking-cancel-${item.id}`}
                    >
                      <AppText style={[styles.actionText, { color: colors.destructive }]}>
                        {t("bookings.cancel")}
                      </AppText>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, borderBottomColor: colors.border, flexDirection: rowDir },
        ]}
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))}
          style={styles.backBtn}
          hitSlop={12}
          testID="bookings-back"
        >
          <Feather name={isRTL ? "arrow-right" : "arrow-left"} size={22} color={colors.foreground} />
        </Pressable>
        <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
          {t("bookings.title")}
        </AppText>
        <View style={styles.backBtn} />
      </View>

      {/* Role segmented control — the guest/host separation, front and centre. */}
      <View style={[styles.segment, { backgroundColor: colors.secondary, flexDirection: rowDir }]}>
        {(["guest", "host"] as ListBookingsRole[]).map((r) => {
          const active = role === r;
          return (
            <Pressable
              key={r}
              onPress={() => {
                Haptics.selectionAsync();
                setRole(r);
              }}
              style={[styles.segmentBtn, active && { backgroundColor: colors.card, borderRadius: colors.radius }]}
              testID={`bookings-tab-${r}`}
            >
              <AppText
                style={[
                  styles.segmentText,
                  { color: active ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {t(r === "guest" ? "bookings.tabTrips" : "bookings.tabRequests")}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={48} color={colors.mutedForeground} />
          <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {t("bookings.errorBody")}
          </AppText>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}>
            <AppText style={{ color: colors.primaryForeground, fontWeight: "600" }}>
              {t("common.retry")}
            </AppText>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="calendar" size={48} color={colors.mutedForeground} />
          <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {t(role === "guest" ? "bookings.emptyTrips" : "bookings.emptyRequests")}
          </AppText>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
          onRefresh={refetch}
          refreshing={isRefetching}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "600" },
  segment: { margin: 16, marginBottom: 4, padding: 4, borderRadius: 12 },
  segmentBtn: { flex: 1, paddingVertical: 9, alignItems: "center" },
  segmentText: { fontSize: 14, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  emptyText: { fontSize: 14, textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  cardTop: { alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "700" },
  statusPill: { alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "700" },
  metaRow: { alignItems: "center", gap: 6 },
  metaText: { flex: 1, fontSize: 13 },
  cardBottom: { alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 8 },
  total: { fontSize: 15, fontWeight: "800" },
  actions: { alignItems: "center", gap: 8 },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: { fontSize: 13, fontWeight: "700" },
});
