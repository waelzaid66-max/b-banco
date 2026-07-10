import { Feather } from "@/components/icons";
import {
  getGetMySubscriptionQueryKey,
  getGetPromoAdSummaryQueryKey,
  useBoostListing,
  useGetMySubscription,
  useGetPromoAdSummary,
  type BoostListingBody,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

type Variant = "full" | "outline" | "compact";
type AdType = NonNullable<BoostListingBody["ad_type"]>;

interface PromoteButtonProps {
  listingId: string;
  variant?: Variant;
  onPromoted?: () => void;
}

/**
 * Reusable "ترويج / Promote" control. Owner-only surfaces (listing detail, "my
 * listings", profile grid) render this. It reuses the EXISTING boost + plans
 * flow: eligibility is an active subscription OR available free ad credit
 * (granted to all users); with neither we route straight to /plans, and a
 * 402/403 from the boost itself (e.g. depleted funds) routes to /plans too. The
 * three options
 * map onto the existing ad types — تثبيت→top_search, تمييز→featured,
 * رفع للأعلى→native_feed — for a fixed 7-day window.
 */
export function PromoteButton({
  listingId,
  variant = "full",
  onPromoted,
}: PromoteButtonProps) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const [open, setOpen] = useState(false);

  const subQuery = useGetMySubscription({
    query: { queryKey: getGetMySubscriptionQueryKey() },
  });
  const eligible = subQuery.data?.data?.subscription?.status === "active";
  const boostPrice = subQuery.data?.data?.plan?.boost_price;
  const egp = t("common.egp");
  const priceLine =
    boostPrice != null && boostPrice !== ""
      ? t("promote.priceLine", {
          price: `${egp} ${Number(boostPrice).toLocaleString(
            isRTL ? "ar-EG" : "en-US",
          )}`,
          days: 7,
        })
      : null;

  const promoQuery = useGetPromoAdSummary({
    query: { queryKey: getGetPromoAdSummaryQueryKey() },
  });
  const promo = promoQuery.data?.data;
  const promoBalance = promo ? Number(promo.balance) : 0;
  const hasPromo = !!promo?.campaign_enabled && promoBalance > 0;

  const boost = useBoostListing();

  const goPlans = () => {
    setOpen(false);
    router.push("/plans");
  };

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (subQuery.isLoading || promoQuery.isLoading) return;
    // Free ad credit is granted to ALL users, so promo holders can promote even
    // without an active subscription — the boost consumes promo first and only
    // bills the wallet for any remainder. Route to /plans only when NEITHER an
    // active subscription nor free ad credit is available to fund the boost.
    if (!eligible && !hasPromo) {
      goPlans();
      return;
    }
    setOpen(true);
  };

  const promote = (adType: AdType) => {
    if (boost.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    boost.mutate(
      { data: { listing_id: listingId, ad_type: adType, duration_days: 7 } },
      {
        onSuccess: (res) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setOpen(false);
          onPromoted?.();
          // Keep the promo balance fresh so the wallet/sheet reflect consumption.
          promoQuery.refetch();
          const promoUsed = Number(res?.data?.promo_used ?? "0");
          const walletCharged = Number(res?.data?.wallet_charged ?? "0");
          if (promoUsed > 0 && walletCharged <= 0) {
            Alert.alert(
              t("promote.usedPromoOnly", {
                promo: promoUsed.toLocaleString(),
              }),
            );
          } else if (promoUsed > 0) {
            Alert.alert(
              t("promote.usedSplit", {
                promo: promoUsed.toLocaleString(),
                wallet: walletCharged.toLocaleString(),
              }),
            );
          } else {
            Alert.alert(t("promote.success"));
          }
        },
        onError: (err) => {
          const status = (err as { status?: number } | null)?.status;
          if (status === 402 || status === 403) {
            goPlans();
            return;
          }
          Alert.alert(t("promote.error"));
        },
      },
    );
  };

  const options: {
    type: AdType;
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    hint: string;
  }[] = [
    {
      type: "top_search",
      icon: "search",
      label: t("promote.pin"),
      hint: t("promote.pinHint"),
    },
    {
      type: "featured",
      icon: "star",
      label: t("promote.feature"),
      hint: t("promote.featureHint"),
    },
    {
      type: "native_feed",
      icon: "trending-up",
      label: t("promote.bump"),
      hint: t("promote.bumpHint"),
    },
  ];

  return (
    <>
      <Pressable
        onPress={onPress}
        style={[
          styles.btnBase,
          isRTL && variant !== "compact" && styles.rowReverse,
          variant === "full" && {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
          },
          variant === "outline" && {
            borderWidth: 1,
            borderColor: colors.primary,
            borderRadius: colors.radius,
          },
          variant === "compact" && [
            styles.btnCompact,
            { backgroundColor: colors.primary },
          ],
        ]}
        hitSlop={variant === "compact" ? 8 : undefined}
        testID={`promote-${listingId}`}
      >
        <Feather
          name="trending-up"
          size={variant === "compact" ? 14 : 16}
          color={variant === "full" || variant === "compact" ? colors.primaryForeground : colors.primary}
        />
        {variant !== "compact" ? (
          <AppText
            style={[
              styles.btnLabel,
              {
                color:
                  variant === "full" ? colors.primaryForeground : colors.primary,
              },
            ]}
          >
            {t("promote.cta")}
          </AppText>
        ) : null}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => !boost.isPending && setOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => !boost.isPending && setOpen(false)}
            accessibilityRole="button"
          />
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.handle} />
            <AppText style={[styles.sheetTitle, { color: colors.foreground }]}>
              {t("promote.sheetTitle")}
            </AppText>
            <AppText
              style={[styles.sheetHint, { color: colors.mutedForeground }]}
            >
              {t("promote.sheetHint")}
            </AppText>
            {hasPromo ? (
              <View
                style={[
                  styles.promoBanner,
                  {
                    backgroundColor: colors.primary + "12",
                    borderColor: colors.primary + "44",
                    borderRadius: colors.radius,
                    flexDirection: isRTL ? "row-reverse" : "row",
                  },
                ]}
              >
                <Feather name="gift" size={16} color={colors.primary} />
                <View style={styles.promoBannerText}>
                  <AppText
                    style={[
                      styles.promoBannerTitle,
                      {
                        color: colors.primary,
                        textAlign: isRTL ? "right" : "left",
                      },
                    ]}
                  >
                    {t("promote.creditAvailable", {
                      amount: promoBalance.toLocaleString(),
                    })}
                  </AppText>
                  <AppText
                    style={[
                      styles.promoBannerHint,
                      {
                        color: colors.mutedForeground,
                        textAlign: isRTL ? "right" : "left",
                      },
                    ]}
                  >
                    {t("promote.creditNote")}
                  </AppText>
                </View>
              </View>
            ) : null}
            {priceLine && (
              <View
                style={[
                  styles.priceBadge,
                  {
                    backgroundColor: colors.primary + "14",
                    borderRadius: colors.radius,
                  },
                  isRTL && styles.rowReverse,
                ]}
              >
                <Feather name="tag" size={14} color={colors.primary} />
                <AppText style={[styles.priceText, { color: colors.primary }]}>
                  {priceLine}
                </AppText>
              </View>
            )}
            {options.map((opt) => {
              const busy =
                boost.isPending && boost.variables?.data?.ad_type === opt.type;
              return (
                <Pressable
                  key={opt.type}
                  onPress={() => promote(opt.type)}
                  disabled={boost.isPending}
                  style={[
                    styles.option,
                    { borderColor: colors.border, borderRadius: colors.radius },
                    isRTL && styles.rowReverse,
                  ]}
                  testID={`promote-opt-${opt.type}`}
                >
                  <View
                    style={[
                      styles.optionIcon,
                      { backgroundColor: colors.primary + "1A" },
                    ]}
                  >
                    <Feather name={opt.icon} size={18} color={colors.primary} />
                  </View>
                  <View style={styles.optionTextWrap}>
                    <AppText
                      style={[
                        styles.optionLabel,
                        {
                          color: colors.foreground,
                          textAlign: isRTL ? "right" : "left",
                        },
                      ]}
                    >
                      {opt.label}
                    </AppText>
                    <AppText
                      style={[
                        styles.optionHint,
                        {
                          color: colors.mutedForeground,
                          textAlign: isRTL ? "right" : "left",
                        },
                      ]}
                    >
                      {opt.hint}
                    </AppText>
                  </View>
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather
                      name={isRTL ? "chevron-left" : "chevron-right"}
                      size={18}
                      color={colors.mutedForeground}
                    />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => !boost.isPending && setOpen(false)}
              style={styles.cancelBtn}
              testID="promote-cancel"
            >
              <AppText
                style={[styles.cancelText, { color: colors.mutedForeground }]}
              >
                {t("common.cancel")}
              </AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btnBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  btnCompact: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
    width: 30,
    height: 30,
    borderRadius: 999,
  },
  rowReverse: { flexDirection: "row-reverse" },
  btnLabel: { fontSize: 13, fontWeight: "700" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(150,150,150,0.4)",
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  sheetHint: { fontSize: 13, textAlign: "center", marginBottom: 6 },
  promoBanner: {
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
  },
  promoBannerText: { flex: 1 },
  promoBannerTitle: { fontSize: 14, fontWeight: "700" },
  promoBannerHint: { fontSize: 12, marginTop: 2 },
  priceBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 6,
  },
  priceText: { fontSize: 13, fontWeight: "700" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    padding: 12,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTextWrap: { flex: 1 },
  optionLabel: { fontSize: 15, fontWeight: "600" },
  optionHint: { fontSize: 12, marginTop: 2 },
  cancelBtn: { paddingVertical: 12, alignItems: "center", marginTop: 2 },
  cancelText: { fontSize: 14, fontWeight: "600" },
});
