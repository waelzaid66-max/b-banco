import { Feather } from "@/components/icons";
import {
  getGetMyListingsQueryKey,
  useGetMyListings,
  useListBookings,
  getListBookingsQueryKey,
  type FeedItem,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { filterBookableListings } from "@/lib/rentalHost";

/**
 * Furnished / daily rental host hub — isolated from sale & long-term rent.
 */
export default function RentalHostHubScreen() {
  const colors = useColors();
  const { t, isRTL, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const rowDir = isRTL ? "row-reverse" : "row";

  const listingsQ = useGetMyListings(undefined, {
    query: { queryKey: getGetMyListingsQueryKey() },
  });
  const hostBookingsQ = useListBookings(
    { role: "host" },
    { query: { queryKey: getListBookingsQueryKey({ role: "host" }) } },
  );

  const bookableUnits = useMemo(
    () => filterBookableListings(listingsQ.data?.data ?? []),
    [listingsQ.data?.data],
  );
  const pendingRequests = useMemo(
    () =>
      (hostBookingsQ.data?.data ?? []).filter((b) => b.status === "requested")
        .length,
    [hostBookingsQ.data?.data],
  );

  const refreshing = listingsQ.isRefetching || hostBookingsQ.isRefetching;
  const onRefresh = () => {
    void listingsQ.refetch();
    void hostBookingsQ.refetch();
  };

  const loading = listingsQ.isLoading || hostBookingsQ.isLoading;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={12}
          testID="rental-hub-back"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
          {t("rentals.hub.title")}
        </AppText>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="home" size={22} color={colors.primary} />
          </View>
          <AppText style={[styles.heroTitle, { color: colors.foreground, textAlign: isRTL ? "right" : "left" }]}>
            {t("rentals.hub.subtitle")}
          </AppText>
          <AppText style={[styles.heroBody, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
            {t("rentals.hub.philosophy")}
          </AppText>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={[styles.statsRow, { flexDirection: rowDir }]}>
              <StatCard
                label={t("rentals.hub.pendingRequests")}
                value={String(pendingRequests)}
                icon="inbox"
                colors={colors}
                isRTL={isRTL}
              />
              <StatCard
                label={t("rentals.hub.activeUnits")}
                value={String(bookableUnits.length)}
                icon="key"
                colors={colors}
                isRTL={isRTL}
              />
            </View>

            <View style={[styles.actions, { flexDirection: rowDir }]}>
              <ActionChip
                icon="calendar"
                label={t("rentals.hub.viewRequests")}
                badge={pendingRequests > 0 ? pendingRequests : undefined}
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push({ pathname: "/bookings", params: { role: "host" } });
                }}
                colors={colors}
                primary
              />
              <ActionChip
                icon="map-pin"
                label={t("rentals.hub.myTrips")}
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push("/bookings");
                }}
                colors={colors}
              />
            </View>

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/listings/create");
              }}
              style={[
                styles.addCard,
                { borderColor: colors.primary, backgroundColor: colors.primary + "0D" },
                { flexDirection: rowDir },
              ]}
              testID="rental-hub-add-unit"
            >
              <Feather name="plus-circle" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <AppText style={[styles.addTitle, { color: colors.primary, textAlign: isRTL ? "right" : "left" }]}>
                  {t("rentals.hub.addUnit")}
                </AppText>
                <AppText style={[styles.addHint, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
                  {t("rentals.hub.addUnitHint")}
                </AppText>
              </View>
            </Pressable>

            <AppText style={[styles.sectionLabel, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
              {t("rentals.hub.unitsSection")}
            </AppText>

            {bookableUnits.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="moon" size={40} color={colors.mutedForeground} />
                <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {t("rentals.hub.emptyUnits")}
                </AppText>
                <AppText style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  {t("rentals.hub.emptyUnitsHint")}
                </AppText>
              </View>
            ) : (
              bookableUnits.map((unit) => (
                <UnitRow key={unit.id} unit={unit} colors={colors} isRTL={isRTL} lang={lang} t={t} />
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
  colors,
  isRTL,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  colors: ReturnType<typeof useColors>;
  isRTL: boolean;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statTop, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <Feather name={icon} size={16} color={colors.primary} />
        <AppText style={[styles.statValue, { color: colors.foreground }]}>{value}</AppText>
      </View>
      <AppText style={[styles.statLabel, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
        {label}
      </AppText>
    </View>
  );
}

function ActionChip({
  icon,
  label,
  badge,
  onPress,
  colors,
  primary,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  badge?: number;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.actionChip,
        {
          backgroundColor: primary ? colors.primary : colors.card,
          borderColor: primary ? colors.primary : colors.border,
        },
      ]}
    >
      <Feather name={icon} size={16} color={primary ? colors.primaryForeground : colors.foreground} />
      <AppText
        style={[
          styles.actionLabel,
          { color: primary ? colors.primaryForeground : colors.foreground },
        ]}
        numberOfLines={1}
      >
        {label}
      </AppText>
      {badge != null && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
          <AppText style={styles.badgeText}>{badge}</AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

function UnitRow({
  unit,
  colors,
  isRTL,
  lang,
  t,
}: {
  unit: FeedItem;
  colors: ReturnType<typeof useColors>;
  isRTL: boolean;
  lang: string;
  t: (key: string) => string;
}) {
  const id = unit.id ?? "";
  return (
    <View style={[styles.unitCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.unitTop, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <View style={{ flex: 1 }}>
          <AppText style={[styles.unitTitle, { color: colors.foreground, textAlign: isRTL ? "right" : "left" }]} numberOfLines={1}>
            {unit.title ?? t("mine.untitled")}
          </AppText>
          <AppText style={[styles.unitMeta, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]} numberOfLines={1}>
            {[unit.location, unit.price_display].filter(Boolean).join(" · ")}
          </AppText>
        </View>
        <View style={[styles.bookablePill, { backgroundColor: colors.primary + "1A" }]}>
          <AppText style={[styles.bookableText, { color: colors.primary }]}>
            {t("rentals.hub.unitBadge")}
          </AppText>
        </View>
      </View>
      <View style={[styles.unitActions, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <Pressable
          onPress={() => id && router.push(`/listing/${id}`)}
          style={[styles.unitBtn, { borderColor: colors.border }]}
        >
          <AppText style={{ color: colors.foreground, fontSize: 13 }}>
            {t("rentals.hub.viewListing")}
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => id && router.push(`/listings/edit/${id}` as Href)}
          style={[styles.unitBtn, { borderColor: colors.primary }]}
        >
          <AppText style={{ color: colors.primary, fontSize: 13 }}>
            {t("rentals.hub.editUnit")}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  hero: {
    margin: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontSize: 16, fontWeight: "700" },
  heroBody: { fontSize: 14, lineHeight: 20 },
  centered: { paddingVertical: 40, alignItems: "center" },
  statsRow: { paddingHorizontal: 16, gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  statTop: { alignItems: "center", gap: 8 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 12 },
  actions: { paddingHorizontal: 16, gap: 10, marginBottom: 12 },
  actionChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionLabel: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  addCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 10,
  },
  addTitle: { fontSize: 15, fontWeight: "700" },
  addHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  empty: {
    marginHorizontal: 16,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  unitCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  unitTop: { alignItems: "flex-start", gap: 10 },
  unitTitle: { fontSize: 15, fontWeight: "700" },
  unitMeta: { fontSize: 12, marginTop: 2 },
  bookablePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  bookableText: { fontSize: 11, fontWeight: "700" },
  unitActions: { gap: 8 },
  unitBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
});
