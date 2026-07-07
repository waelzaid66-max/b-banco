import { Feather, Ionicons } from "@/components/icons";
import {
  getMySubscription,
  getPromoAdSummary,
  getWallet,
  listTransactions,
  type PromoAdSummary,
  type SubscriptionMe,
  type WalletState,
  type WalletTransaction,
} from "@workspace/api-client-react";
import { router, type Href } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { exportBillingReportCsv } from "@/lib/billingExport";

type LoadState = "loading" | "ready" | "error";

const RECENT_TX = 5;

function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "0";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

type HubLink = {
  key: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  hint: string;
  href: Href;
  testID: string;
};

export default function BillingHubScreen() {
  const colors = useColors();
  const { t, isRTL, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const egp = t("common.egp");
  const rowDir: "row" | "row-reverse" = isRTL ? "row-reverse" : "row";

  const [state, setState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [promo, setPromo] = useState<PromoAdSummary | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionMe | null>(null);
  const [recentTx, setRecentTx] = useState<WalletTransaction[]>([]);
  const [exportingCsv, setExportingCsv] = useState(false);

  const load = useCallback(async () => {
    try {
      const [walletRes, subRes, txRes] = await Promise.all([
        getWallet(),
        getMySubscription(),
        listTransactions({ limit: RECENT_TX }),
      ]);
      setWallet(walletRes.data ?? null);
      setSubscription(subRes.data ?? null);
      setRecentTx(txRes.data ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
    try {
      const promoRes = await getPromoAdSummary();
      setPromo(promoRes.data ?? null);
    } catch {
      setPromo(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onExportCsv = useCallback(async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      await exportBillingReportCsv();
    } catch {
      Alert.alert(t("common.error"), t("billing.exportFailed"));
    } finally {
      setExportingCsv(false);
    }
  }, [exportingCsv, t]);

  const links: HubLink[] = [
    {
      key: "wallet",
      icon: "credit-card",
      title: t("billing.links.wallet"),
      hint: t("billing.links.walletHint"),
      href: "/wallet" as Href,
      testID: "billing-link-wallet",
    },
    {
      key: "invoices",
      icon: "file-text",
      title: t("billing.links.invoices"),
      hint: t("billing.links.invoicesHint"),
      href: "/invoices" as Href,
      testID: "billing-link-invoices",
    },
    {
      key: "plans",
      icon: "star",
      title: t("billing.links.plans"),
      hint: t("billing.links.plansHint"),
      href: "/plans" as Href,
      testID: "billing-link-plans",
    },
  ];

  const planName = subscription?.plan?.name?.trim() || t("billing.noPlan");
  const promoBalance = promo && promo.campaign_enabled ? Number(promo.balance) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
            flexDirection: rowDir,
          },
        ]}
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))}
          style={styles.backBtn}
          hitSlop={12}
          testID="billing-back"
        >
          <Feather
            name={isRTL ? "arrow-right" : "arrow-left"}
            size={22}
            color={colors.foreground}
          />
        </Pressable>
        <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
          {t("billing.title")}
        </AppText>
        <View style={styles.backBtn} />
      </View>

      {state === "loading" ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : state === "error" ? (
        <View style={styles.stateWrap}>
          <Feather name="wifi-off" size={52} color={colors.mutedForeground} />
          <AppText style={[styles.stateTitle, { color: colors.foreground }]}>
            {t("billing.errorTitle")}
          </AppText>
          <AppText style={[styles.stateText, { color: colors.mutedForeground }]}>
            {t("billing.errorBody")}
          </AppText>
          <Pressable
            onPress={() => {
              setState("loading");
              load();
            }}
            style={[styles.retryBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            testID="billing-retry"
          >
            <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
            <AppText style={[styles.retryText, { color: colors.primaryForeground }]}>
              {t("common.retry")}
            </AppText>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <View style={[styles.summaryRow, { flexDirection: rowDir }]}>
            <View
              style={[
                styles.summaryCard,
                { backgroundColor: colors.primary, borderRadius: colors.radius + 4, flex: 1 },
              ]}
            >
              <View style={[styles.summaryTop, { flexDirection: rowDir }]}>
                <AppText style={[styles.summaryLabel, { color: colors.primaryForeground }]}>
                  {t("wallet.available")}
                </AppText>
                <Ionicons name="wallet" size={18} color={colors.primaryForeground} />
              </View>
              <AppText
                style={[
                  styles.summaryValue,
                  { color: colors.primaryForeground, textAlign: isRTL ? "right" : "left" },
                ]}
              >
                {egp} {fmtMoney(wallet?.balance)}
              </AppText>
            </View>
            {promo?.campaign_enabled ? (
              <View
                style={[
                  styles.summaryCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius + 4,
                    borderWidth: StyleSheet.hairlineWidth,
                    flex: 1,
                  },
                ]}
              >
                <View style={[styles.summaryTop, { flexDirection: rowDir }]}>
                  <AppText style={[styles.summaryLabelDark, { color: colors.mutedForeground }]}>
                    {t("wallet.promo.title")}
                  </AppText>
                  <Feather name="gift" size={16} color={colors.primary} />
                </View>
                <AppText
                  style={[
                    styles.summaryValueDark,
                    { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
                  ]}
                >
                  {egp} {fmtMoney(promoBalance)}
                </AppText>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => router.push("/plans")}
            style={[
              styles.planChip,
              {
                flexDirection: rowDir,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            testID="billing-plan-chip"
          >
            <Feather name="star" size={16} color={colors.primary} />
            <AppText style={[styles.planChipText, { color: colors.foreground, flex: 1 }]}>
              {t("billing.currentPlan", { plan: planName })}
            </AppText>
            <Feather
              name={isRTL ? "chevron-left" : "chevron-right"}
              size={16}
              color={colors.mutedForeground}
            />
          </Pressable>

          <AppText
            style={[
              styles.sectionTitle,
              { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
            ]}
          >
            {t("billing.quickLinks")}
          </AppText>
          <View style={styles.linksGrid}>
            {links.map((link) => (
              <Pressable
                key={link.key}
                onPress={() => router.push(link.href)}
                style={[
                  styles.linkCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                testID={link.testID}
              >
                <View style={[styles.linkIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Feather name={link.icon} size={20} color={colors.primary} />
                </View>
                <AppText style={[styles.linkTitle, { color: colors.foreground }]}>{link.title}</AppText>
                <AppText style={[styles.linkHint, { color: colors.mutedForeground }]}>
                  {link.hint}
                </AppText>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={onExportCsv}
            disabled={exportingCsv}
            style={[
              styles.exportCard,
              {
                flexDirection: rowDir,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            testID="billing-export-csv"
          >
            <View style={[styles.exportIcon, { backgroundColor: colors.primary + "18" }]}>
              {exportingCsv ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Feather name="download" size={18} color={colors.primary} />
              )}
            </View>
            <View style={styles.exportBody}>
              <AppText style={[styles.exportTitle, { color: colors.foreground }]}>
                {t("billing.exportCsv")}
              </AppText>
              <AppText style={[styles.exportHint, { color: colors.mutedForeground }]}>
                {t("billing.exportCsvHint")}
              </AppText>
            </View>
          </Pressable>

          <View style={[styles.sectionHead, { flexDirection: rowDir }]}>
            <AppText style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t("billing.recentActivity")}
            </AppText>
            <Pressable onPress={() => router.push("/wallet")} hitSlop={8} testID="billing-see-all-tx">
              <AppText style={[styles.seeAll, { color: colors.primary }]}>{t("billing.seeAll")}</AppText>
            </Pressable>
          </View>

          {recentTx.length === 0 ? (
            <View
              style={[styles.emptyCard, { backgroundColor: colors.card, borderRadius: colors.radius }]}
            >
              <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {t("wallet.emptyTitle")}
              </AppText>
            </View>
          ) : (
            <View
              style={[styles.txCard, { backgroundColor: colors.card, borderRadius: colors.radius }]}
            >
              {recentTx.map((tx, i) => {
                const value = Math.abs(parseFloat(tx.amount) || 0);
                const credit = parseFloat(tx.amount) > 0;
                return (
                  <View
                    key={tx.id}
                    style={[
                      styles.txRow,
                      {
                        flexDirection: rowDir,
                        borderTopColor: colors.border,
                        borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={styles.txBody}>
                      <AppText style={[styles.txLabel, { color: colors.foreground }]}>
                        {tx.description?.trim() ? tx.description : t(`wallet.tx.${tx.type}`)}
                      </AppText>
                      <AppText style={[styles.txDate, { color: colors.mutedForeground }]}>
                        {formatDate(tx.created_at, lang)}
                      </AppText>
                    </View>
                    <AppText
                      style={[
                        styles.txAmount,
                        { color: credit ? colors.primary : colors.foreground },
                      ]}
                    >
                      {credit ? "+" : "−"}
                      {egp} {fmtMoney(value)}
                    </AppText>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "600" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  stateTitle: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  stateText: { fontSize: 14, textAlign: "center" },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryText: { fontSize: 15, fontWeight: "600" },
  content: { padding: 16, paddingBottom: 48, gap: 16 },
  summaryRow: { gap: 12 },
  summaryCard: { padding: 16 },
  summaryTop: { alignItems: "center", justifyContent: "space-between" },
  summaryLabel: { fontSize: 12, fontWeight: "600", opacity: 0.9 },
  summaryLabelDark: { fontSize: 12, fontWeight: "600" },
  summaryValue: { fontSize: 24, fontWeight: "700", marginTop: 8 },
  summaryValueDark: { fontSize: 22, fontWeight: "700", marginTop: 8 },
  planChip: {
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  planChipText: { fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  sectionHead: { alignItems: "center", justifyContent: "space-between" },
  seeAll: { fontSize: 14, fontWeight: "600" },
  linksGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  linkCard: {
    width: "47%",
    flexGrow: 1,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  linkTitle: { fontSize: 14, fontWeight: "700" },
  linkHint: { fontSize: 12, lineHeight: 17 },
  exportCard: {
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  exportIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  exportBody: { flex: 1, gap: 4 },
  exportTitle: { fontSize: 14, fontWeight: "700" },
  exportHint: { fontSize: 12, lineHeight: 17 },
  emptyCard: { padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14, textAlign: "center" },
  txCard: { paddingHorizontal: 16, paddingVertical: 4 },
  txRow: { alignItems: "center", gap: 12, paddingVertical: 12 },
  txBody: { flex: 1, gap: 2 },
  txLabel: { fontSize: 14, fontWeight: "600" },
  txDate: { fontSize: 12 },
  txAmount: { fontSize: 14, fontWeight: "700" },
});
