import { Feather } from "@/components/icons";
import {
  getInvoice,
  type Invoice,
  type InvoiceTransactionType,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { downloadInvoicePdf } from "@/lib/billingExport";

type LoadState = "loading" | "ready" | "error";

function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "0";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function txLabelKey(type: InvoiceTransactionType): string {
  if (!type) return "invoices.type.unknown";
  return `wallet.tx.${type}`;
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { t, isRTL, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const egp = t("common.egp");
  const rowDir: "row" | "row-reverse" = isRTL ? "row-reverse" : "row";

  const [state, setState] = useState<LoadState>("loading");
  const [invoice, setInvoice] = useState<Invoice | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setState("error");
      return;
    }
    try {
      const res = await getInvoice(id);
      setInvoice(res.data);
      setState(res.data ? "ready" : "error");
    } catch {
      setState("error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDownloadPdf = useCallback(async () => {
    if (!invoice?.id || exporting) return;
    setExporting(true);
    try {
      await downloadInvoicePdf(invoice.id, invoice.invoice_number);
    } catch {
      Alert.alert(t("common.error"), t("invoices.exportFailed"));
    } finally {
      setExporting(false);
    }
  }, [exporting, invoice, t]);

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
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/invoices" as Href))}
          style={styles.backBtn}
          hitSlop={12}
          testID="invoice-detail-back"
        >
          <Feather
            name={isRTL ? "arrow-right" : "arrow-left"}
            size={22}
            color={colors.foreground}
          />
        </Pressable>
        <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
          {t("invoices.detailTitle")}
        </AppText>
        <View style={styles.backBtn} />
      </View>

      {state === "loading" ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : state === "error" || !invoice ? (
        <View style={styles.stateWrap}>
          <Feather name="alert-circle" size={52} color={colors.mutedForeground} />
          <AppText style={[styles.stateTitle, { color: colors.foreground }]}>
            {t("invoices.notFoundTitle")}
          </AppText>
          <AppText style={[styles.stateText, { color: colors.mutedForeground }]}>
            {t("invoices.notFoundBody")}
          </AppText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.heroCard,
              { backgroundColor: colors.primary, borderRadius: colors.radius + 4 },
            ]}
          >
            <AppText style={[styles.heroLabel, { color: colors.primaryForeground }]}>
              {invoice.invoice_number}
            </AppText>
            <AppText
              style={[
                styles.heroAmount,
                { color: colors.primaryForeground, textAlign: isRTL ? "right" : "left" },
              ]}
            >
              {egp} {fmtMoney(invoice.amount)}
            </AppText>
            <AppText
              style={[
                styles.heroStatus,
                { color: colors.primaryForeground, textAlign: isRTL ? "right" : "left" },
              ]}
            >
              {t(`invoices.status.${invoice.status}`)}
            </AppText>
          </View>

          <View
            style={[styles.metaCard, { backgroundColor: colors.card, borderRadius: colors.radius }]}
          >
            <MetaRow
              label={t("invoices.fields.type")}
              value={t(txLabelKey(invoice.transaction_type))}
              colors={colors}
              isRTL={isRTL}
              rowDir={rowDir}
            />
            <MetaRow
              label={t("invoices.fields.issued")}
              value={formatDate(invoice.issued_at ?? invoice.created_at, lang)}
              colors={colors}
              isRTL={isRTL}
              rowDir={rowDir}
            />
            {invoice.description ? (
              <MetaRow
                label={t("invoices.fields.description")}
                value={invoice.description}
                colors={colors}
                isRTL={isRTL}
                rowDir={rowDir}
              />
            ) : null}
          </View>

          {invoice.line_items && invoice.line_items.length > 0 ? (
            <>
              <AppText
                style={[
                  styles.sectionTitle,
                  { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
                ]}
              >
                {t("invoices.lineItems")}
              </AppText>
              <View
                style={[
                  styles.linesCard,
                  { backgroundColor: colors.card, borderRadius: colors.radius },
                ]}
              >
                {invoice.line_items.map((line, i) => (
                  <View
                    key={`${line.label}-${i}`}
                    style={[
                      styles.lineRow,
                      {
                        flexDirection: rowDir,
                        borderTopColor: colors.border,
                        borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <AppText style={[styles.lineLabel, { color: colors.foreground, flex: 1 }]}>
                      {line.label}
                    </AppText>
                    <AppText style={[styles.lineAmount, { color: colors.foreground }]}>
                      {egp} {fmtMoney(line.amount)}
                    </AppText>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Pressable
            onPress={onDownloadPdf}
            disabled={exporting}
            style={[
              styles.exportBtn,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                flexDirection: rowDir,
              },
            ]}
            testID="invoice-download-pdf"
          >
            {exporting ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Feather name="download" size={18} color={colors.primary} />
            )}
            <AppText style={[styles.exportBtnText, { color: colors.foreground }]}>
              {t("invoices.downloadPdf")}
            </AppText>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function MetaRow({
  label,
  value,
  colors,
  isRTL,
  rowDir,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  isRTL: boolean;
  rowDir: "row" | "row-reverse";
}) {
  return (
    <View style={[styles.metaRow, { flexDirection: rowDir }]}>
      <AppText style={[styles.metaLabel, { color: colors.mutedForeground }]}>{label}</AppText>
      <AppText
        style={[
          styles.metaValue,
          { color: colors.foreground, textAlign: isRTL ? "left" : "right", flex: 1 },
        ]}
      >
        {value}
      </AppText>
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
  content: { padding: 16, paddingBottom: 48, gap: 16 },
  heroCard: { padding: 20 },
  heroLabel: { fontSize: 13, fontWeight: "600", opacity: 0.9 },
  heroAmount: { fontSize: 30, fontWeight: "700", marginTop: 8 },
  heroStatus: { fontSize: 13, marginTop: 6, opacity: 0.9, textTransform: "uppercase" },
  metaCard: { padding: 16, gap: 14 },
  metaRow: { alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  metaLabel: { fontSize: 13, fontWeight: "500", minWidth: 100 },
  metaValue: { fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  linesCard: { paddingHorizontal: 16, paddingVertical: 4 },
  lineRow: { alignItems: "center", justifyContent: "space-between", paddingVertical: 14, gap: 12 },
  lineLabel: { fontSize: 14 },
  lineAmount: { fontSize: 14, fontWeight: "700" },
  exportBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  exportBtnText: { fontSize: 15, fontWeight: "600" },
});
