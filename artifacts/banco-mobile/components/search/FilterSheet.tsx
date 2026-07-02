import { Feather, Ionicons } from "@/components/icons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  SearchListingsFuelType,
  SearchListingsIndustry,
  SearchListingsOriginType,
  SearchListingsTransmission,
} from "@workspace/api-client-react";

import { AppText } from "@/components/AppText";
import {
  apiCategoryFor,
  Category,
  CategoryIcon,
  EngineChips,
} from "@/components/CategoryTabs";
import { brandLabel, type CarBrand } from "@/constants/cars";
import type { EngineDef } from "@/constants/engines";
import { INDUSTRY_TYPES } from "@/constants/listingCreateTaxonomy";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import type {
  PaymentType,
  SearchCriteria,
  SearchSort,
} from "@/lib/searchParams";

const SORTS: SearchSort[] = [
  "recommended",
  "newest",
  "price_asc",
  "price_desc",
  "popular",
];
const PAYMENTS: PaymentType[] = ["any", "installment"];

// Section-specific attribute filters. These criteria/back-end params existed but
// had NO controls in the sheet — cars get fuel + transmission, industrial gets
// industry + origin, each a single-select chip row (tap again to clear).
const FUELS: SearchListingsFuelType[] = [
  "petrol",
  "diesel",
  "hybrid",
  "electric",
  "natural_gas",
];
const FUEL_LABEL_KEY: Record<SearchListingsFuelType, string> = {
  petrol: "petrol",
  diesel: "diesel",
  hybrid: "hybrid",
  electric: "electric",
  natural_gas: "naturalGas",
};
const TRANSMISSIONS: SearchListingsTransmission[] = [
  "manual",
  "automatic",
  "cvt",
];
const ORIGINS: SearchListingsOriginType[] = ["local", "imported"];

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  criteria: SearchCriteria;
  /** Facet-gated categories (the active one is always kept visible). */
  shownCategories: Category[];
  /** Facet-gated engine chips for the active category (single-select "Type"). */
  engines: EngineDef[];
  /** Quick brand chips (cars only). */
  quickBrands: CarBrand[];
  brandValue: string | null;
  locationLabel: string;
  onSelectCategory: (c: Category) => void;
  onSelectEngine: (key: string) => void;
  onBrowseBrand: (b: CarBrand) => void;
  onOpenBrandPicker: () => void;
  onUpdate: (partial: Partial<SearchCriteria>) => void;
  onOpenLocationPicker: () => void;
  onClearLocation: () => void;
  onClearAll: () => void;
}

/**
 * The Search mini-app filter bottom sheet. Chip rows (sort / category / type /
 * brand / payment) apply immediately through `onUpdate` so the results behind
 * the sheet stay live; the free-text price and year ranges are local drafts
 * committed on "Apply" (a keystroke-per-query there would be wasteful). Every
 * control maps to a real backend param and the category / type chips are
 * facet-gated by the caller, so the sheet never offers a permanently-empty
 * filter.
 */
export function FilterSheet({
  visible,
  onClose,
  criteria,
  shownCategories,
  engines,
  quickBrands,
  brandValue,
  locationLabel,
  onSelectCategory,
  onSelectEngine,
  onBrowseBrand,
  onOpenBrandPicker,
  onUpdate,
  onOpenLocationPicker,
  onClearLocation,
  onClearAll,
}: FilterSheetProps) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();

  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  // Price / year are drafts: re-synced from the committed criteria each time the
  // sheet opens, then applied together on the Apply button.
  const [minPrice, setMinPrice] = useState(criteria.minPrice);
  const [maxPrice, setMaxPrice] = useState(criteria.maxPrice);
  const [minYear, setMinYear] = useState(criteria.minYear);
  const [maxYear, setMaxYear] = useState(criteria.maxYear);

  useEffect(() => {
    if (visible) {
      setMinPrice(criteria.minPrice);
      setMaxPrice(criteria.maxPrice);
      setMinYear(criteria.minYear);
      setMaxYear(criteria.maxYear);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const apply = () => {
    onUpdate({ minPrice, maxPrice, minYear, maxYear });
    onClose();
  };

  const isCar = criteria.category === "car";
  const isIndustrial = apiCategoryFor(criteria.category) === "industrial";
  const showEngines = engines.length > 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              paddingBottom: insets.bottom + 12,
              maxHeight: "88%",
            },
          ]}
        >
          {/* Grabber + header */}
          <View
            style={[styles.handle, { backgroundColor: colors.border }]}
          />
          <View style={[styles.sheetHeader, { flexDirection: rowDir }]}>
            <AppText style={[styles.sheetTitle, { color: colors.foreground }]}>
              {t("search.filters")}
            </AppText>
            <Pressable onPress={onClearAll} hitSlop={8}>
              <AppText style={[styles.clearAll, { color: colors.primary }]}>
                {t("search.clearAll")}
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Sort */}
            <SectionLabel text={t("search.sortBy")} align={textAlign} colors={colors} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipRow, { flexDirection: rowDir }]}
            >
              {SORTS.map((s) => {
                const active = criteria.sort === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => onUpdate({ sort: s })}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.secondary,
                      },
                    ]}
                    testID={`sort-${s}`}
                  >
                    <AppText
                      style={[
                        styles.chipText,
                        {
                          color: active
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {t(`search.sortOptions.${s}`)}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Category */}
            <SectionLabel text={t("search.category")} align={textAlign} colors={colors} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipRow, { flexDirection: rowDir }]}
            >
              {shownCategories.map((cat) => {
                const active = criteria.category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => onSelectCategory(cat)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.secondary,
                        flexDirection: rowDir,
                        alignItems: "center",
                        gap: 6,
                      },
                    ]}
                    testID={`filter-category-${cat}`}
                  >
                    <CategoryIcon
                      category={cat}
                      color={
                        active ? colors.primaryForeground : colors.mutedForeground
                      }
                    />
                    <AppText
                      style={[
                        styles.chipText,
                        {
                          color: active
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {t(`home.categories.${cat}`)}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Type (facet-gated engine chips) */}
            {showEngines && (
              <>
                <SectionLabel text={t("search.type")} align={textAlign} colors={colors} />
                <View style={styles.engineWrap}>
                  <EngineChips
                    engines={engines}
                    selected={criteria.engineKey}
                    onChange={onSelectEngine}
                  />
                </View>
              </>
            )}

            {/* Brand (cars) */}
            {isCar && (
              <>
                <SectionLabel text={t("search.brand")} align={textAlign} colors={colors} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.chipRow,
                    { flexDirection: rowDir },
                  ]}
                >
                  <Pressable
                    onPress={onOpenBrandPicker}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: colors.secondary,
                        flexDirection: rowDir,
                        alignItems: "center",
                        gap: 4,
                      },
                    ]}
                    testID="filter-all-brands"
                  >
                    <Feather name="grid" size={13} color={colors.foreground} />
                    <AppText style={[styles.chipText, { color: colors.foreground }]}>
                      {t("search.allBrands")}
                    </AppText>
                  </Pressable>
                  {quickBrands.map((b) => {
                    const active = brandValue === b.value;
                    return (
                      <Pressable
                        key={b.value}
                        onPress={() => onBrowseBrand(b)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.secondary,
                          },
                        ]}
                        testID={`filter-brand-${b.value}`}
                      >
                        <AppText
                          style={[
                            styles.chipText,
                            {
                              color: active
                                ? colors.primaryForeground
                                : colors.mutedForeground,
                            },
                          ]}
                        >
                          {brandLabel(b, isRTL)}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {/* Year range (cars) */}
                <SectionLabel text={t("search.year")} align={textAlign} colors={colors} />
                <View style={[styles.rangeRow, { flexDirection: rowDir }]}>
                  <TextInput
                    value={minYear}
                    onChangeText={setMinYear}
                    placeholder={t("search.yearFrom")}
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    maxLength={4}
                    style={[
                      styles.rangeInput,
                      {
                        backgroundColor: colors.secondary,
                        color: colors.foreground,
                        textAlign,
                      },
                    ]}
                    testID="year-min"
                  />
                  <AppText style={{ color: colors.mutedForeground }}>—</AppText>
                  <TextInput
                    value={maxYear}
                    onChangeText={setMaxYear}
                    placeholder={t("search.yearTo")}
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    maxLength={4}
                    style={[
                      styles.rangeInput,
                      {
                        backgroundColor: colors.secondary,
                        color: colors.foreground,
                        textAlign,
                      },
                    ]}
                    testID="year-max"
                  />
                </View>

                {/* Fuel (cars) */}
                <SectionLabel text={t("create.fields.fuel")} align={textAlign} colors={colors} />
                <ToggleChipRow
                  options={FUELS}
                  selected={criteria.fuelType}
                  labelFor={(v) => t(`create.opts.${FUEL_LABEL_KEY[v]}`)}
                  onToggle={(v) => onUpdate({ fuelType: v })}
                  rowDir={rowDir}
                  colors={colors}
                  testPrefix="filter-fuel"
                />

                {/* Transmission (cars) */}
                <SectionLabel text={t("create.fields.transmission")} align={textAlign} colors={colors} />
                <ToggleChipRow
                  options={TRANSMISSIONS}
                  selected={criteria.transmission}
                  labelFor={(v) => t(`create.opts.${v}`)}
                  onToggle={(v) => onUpdate({ transmission: v })}
                  rowDir={rowDir}
                  colors={colors}
                  testPrefix="filter-transmission"
                />
              </>
            )}

            {/* Industry + origin (industrial sections) */}
            {isIndustrial && (
              <>
                <SectionLabel text={t("create.fields.industry")} align={textAlign} colors={colors} />
                <ToggleChipRow
                  options={INDUSTRY_TYPES.map((i) => i.value as SearchListingsIndustry)}
                  selected={criteria.industry}
                  labelFor={(v) => {
                    const def = INDUSTRY_TYPES.find((i) => i.value === v);
                    return def ? (isRTL ? def.ar : def.en) : v;
                  }}
                  onToggle={(v) => onUpdate({ industry: v })}
                  rowDir={rowDir}
                  colors={colors}
                  testPrefix="filter-industry"
                />

                <SectionLabel text={t("create.fields.origin")} align={textAlign} colors={colors} />
                <ToggleChipRow
                  options={ORIGINS}
                  selected={criteria.originType}
                  labelFor={(v) => t(`create.opts.${v}`)}
                  onToggle={(v) => onUpdate({ originType: v })}
                  rowDir={rowDir}
                  colors={colors}
                  testPrefix="filter-origin"
                />
              </>
            )}

            {/* Location */}
            <SectionLabel text={t("search.location")} align={textAlign} colors={colors} />
            <Pressable
              onPress={onOpenLocationPicker}
              style={[
                styles.locationTrigger,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  flexDirection: rowDir,
                },
              ]}
              testID="filter-location-trigger"
            >
              <View style={[styles.locationLeft, { flexDirection: rowDir }]}>
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={colors.mutedForeground}
                />
                <AppText
                  style={[
                    styles.locationText,
                    {
                      color: criteria.location
                        ? colors.foreground
                        : colors.mutedForeground,
                      textAlign,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {criteria.location ? locationLabel : t("locationPicker.any")}
                </AppText>
              </View>
              {criteria.location ? (
                <Pressable onPress={onClearLocation} hitSlop={8}>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : (
                <Feather
                  name={isRTL ? "chevron-left" : "chevron-right"}
                  size={16}
                  color={colors.mutedForeground}
                />
              )}
            </Pressable>

            {/* Price */}
            <SectionLabel text={t("search.price")} align={textAlign} colors={colors} />
            <View style={[styles.rangeRow, { flexDirection: rowDir }]}>
              <TextInput
                value={minPrice}
                onChangeText={setMinPrice}
                placeholder={t("search.minPrice")}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
                style={[
                  styles.rangeInput,
                  {
                    backgroundColor: colors.secondary,
                    color: colors.foreground,
                    textAlign,
                  },
                ]}
                testID="price-min"
              />
              <AppText style={{ color: colors.mutedForeground }}>—</AppText>
              <TextInput
                value={maxPrice}
                onChangeText={setMaxPrice}
                placeholder={t("search.maxPrice")}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
                style={[
                  styles.rangeInput,
                  {
                    backgroundColor: colors.secondary,
                    color: colors.foreground,
                    textAlign,
                  },
                ]}
                testID="price-max"
              />
            </View>

            {/* Payment */}
            <SectionLabel text={t("search.paymentType")} align={textAlign} colors={colors} />
            <View style={[styles.chipRow, { flexDirection: rowDir }]}>
              {PAYMENTS.map((pt) => {
                const active = criteria.paymentType === pt;
                return (
                  <Pressable
                    key={pt}
                    onPress={() => onUpdate({ paymentType: pt })}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.secondary,
                      },
                    ]}
                    testID={`payment-${pt}`}
                  >
                    <AppText
                      style={[
                        styles.chipText,
                        {
                          color: active
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {pt === "any" ? t("search.any") : t("search.installmentOnly")}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {/* Apply footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={apply}
              style={[
                styles.applyBtn,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
              ]}
              testID="filter-apply"
            >
              <AppText
                style={[styles.applyText, { color: colors.primaryForeground }]}
              >
                {t("search.apply")}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Single-select chip row: tapping the active chip clears the filter (null). */
function ToggleChipRow<T extends string>({
  options,
  selected,
  labelFor,
  onToggle,
  rowDir,
  colors,
  testPrefix,
}: {
  options: T[];
  selected: T | null;
  labelFor: (v: T) => string;
  onToggle: (v: T | null) => void;
  rowDir: "row" | "row-reverse";
  colors: ReturnType<typeof useColors>;
  testPrefix: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.chipRow, { flexDirection: rowDir }]}
    >
      {options.map((v) => {
        const active = selected === v;
        return (
          <Pressable
            key={v}
            onPress={() => onToggle(active ? null : v)}
            style={[
              styles.chip,
              { backgroundColor: active ? colors.primary : colors.secondary },
            ]}
            testID={`${testPrefix}-${v}`}
          >
            <AppText
              style={[
                styles.chipText,
                {
                  color: active
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                },
              ]}
            >
              {labelFor(v)}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SectionLabel({
  text,
  align,
  colors,
}: {
  text: string;
  align: "left" | "right";
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <AppText
      style={[styles.sectionLabel, { color: colors.mutedForeground, textAlign: align }]}
    >
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: "100%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  clearAll: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  chipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  engineWrap: {
    marginHorizontal: -16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  rangeRow: {
    alignItems: "center",
    gap: 10,
  },
  rangeInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  locationTrigger: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  locationLeft: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  locationText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  applyBtn: {
    paddingVertical: 14,
    alignItems: "center",
  },
  applyText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
