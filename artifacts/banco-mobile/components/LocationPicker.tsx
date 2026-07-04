import { Feather } from "@/components/icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import {
  LOCATIONS,
  LocGroup,
  flattenAreas,
  locLabel,
} from "@/constants/locations";
import {
  useGetPlaceSuggestions,
  getGetPlaceSuggestionsQueryKey,
} from "@workspace/api-client-react";

// Maps a static-taxonomy country value to the ISO code the reference dataset
// uses, so suggestions stay scoped to the country the user is browsing. Unmapped
// countries simply get unscoped suggestions (today only Egypt has data).
const COUNTRY_ISO: Record<string, string> = {
  Egypt: "EG",
  UAE: "AE",
  "Saudi Arabia": "SA",
  Qatar: "QA",
  Kuwait: "KW",
  Bahrain: "BH",
  Oman: "OM",
  Jordan: "JO",
  Lebanon: "LB",
  Iraq: "IQ",
};

interface LocationPickerProps {
  visible: boolean;
  selectedValue?: string;
  onClose: () => void;
  onSelect: (value: string, label: string) => void;
  onClear: () => void;
}

export function LocationPicker({
  visible,
  selectedValue,
  onClose,
  onSelect,
  onClear,
}: LocationPickerProps) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();

  const [countryIdx, setCountryIdx] = useState(0);
  const [activeGroup, setActiveGroup] = useState<LocGroup | null>(null);
  const [query, setQuery] = useState("");

  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";
  const country = LOCATIONS[countryIdx];

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return flattenAreas(country).filter(({ area, group }) => {
      return (
        area.en.toLowerCase().includes(q) ||
        area.ar.includes(query.trim()) ||
        group.en.toLowerCase().includes(q) ||
        group.ar.includes(query.trim())
      );
    });
  }, [query, country]);

  // Debounce so a reference request isn't fired on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // ADDITIVE: reference-dataset suggestions (cities / districts / compounds /
  // projects) that the static list doesn't carry — e.g. Mivida, Il Bosco,
  // Madinaty. Scoped to the active country when it maps to an ISO code.
  const iso = COUNTRY_ISO[country.value];
  const refParams = { q: debouncedQuery, ...(iso ? { country: iso } : {}), limit: 8 };
  const { data: refResp } = useGetPlaceSuggestions(refParams, {
    query: {
      queryKey: getGetPlaceSuggestionsQueryKey(refParams),
      enabled: debouncedQuery.length >= 2,
      staleTime: 60_000,
    },
  });
  const refSuggestions = useMemo(() => {
    const items = refResp?.data ?? [];
    // Drop any place already shown by the static list (by lower-cased EN name).
    const staticNames = new Set(searchResults.map(({ area }) => area.en.toLowerCase()));
    return items.filter((p) => !staticNames.has((p.name_en ?? "").toLowerCase()));
  }, [refResp, searchResults]);

  const reset = () => {
    setActiveGroup(null);
    setQuery("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pick = (value: string, label: string) => {
    reset();
    onSelect(value, label);
  };

  const Row = ({
    label,
    onPress,
    active,
    chevron,
    muted,
  }: {
    label: string;
    onPress: () => void;
    active?: boolean;
    chevron?: boolean;
    muted?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        { flexDirection: rowDir, borderBottomColor: colors.border },
      ]}
    >
      <AppText
        style={[
          styles.rowLabel,
          {
            color: muted
              ? colors.mutedForeground
              : active
                ? colors.primary
                : colors.foreground,
            textAlign,
            fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
          },
        ]}
      >
        {label}
      </AppText>
      {active ? (
        <Feather name="check" size={18} color={colors.primary} />
      ) : chevron ? (
        <Feather
          name={isRTL ? "chevron-left" : "chevron-right"}
          size={18}
          color={colors.mutedForeground}
        />
      ) : null}
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { flexDirection: rowDir }]}>
            {activeGroup ? (
              <Pressable
                onPress={() => setActiveGroup(null)}
                hitSlop={10}
                style={styles.headerBtn}
              >
                <Feather
                  name={isRTL ? "arrow-right" : "arrow-left"}
                  size={22}
                  color={colors.foreground}
                />
              </Pressable>
            ) : (
              <View style={styles.headerBtn} />
            )}
            <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
              {activeGroup
                ? locLabel(activeGroup, isRTL)
                : t("locationPicker.title")}
            </AppText>
            <Pressable onPress={handleClose} hitSlop={10} style={styles.headerBtn}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>

          {/* Search box */}
          <View
            style={[
              styles.searchBox,
              {
                flexDirection: rowDir,
                backgroundColor: colors.secondary,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("locationPicker.searchPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground, textAlign }]}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Feather name="x-circle" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {/* Country pills (hidden while drilled into a group or searching) */}
          {!activeGroup && !query ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.countryScroll}
              contentContainerStyle={[
                styles.countryRow,
                isRTL && { flexDirection: "row-reverse" },
              ]}
            >
              {LOCATIONS.map((c, i) => {
                const isActive = i === countryIdx;
                return (
                  <Pressable
                    key={c.value}
                    onPress={() => {
                      setCountryIdx(i);
                      setActiveGroup(null);
                    }}
                    style={[
                      styles.countryPill,
                      {
                        backgroundColor: isActive
                          ? colors.primary
                          : colors.secondary,
                      },
                    ]}
                  >
                    <AppText
                      style={{
                        color: isActive
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                        fontSize: 13,
                        fontFamily: isActive
                          ? "Inter_600SemiBold"
                          : "Inter_400Regular",
                      }}
                    >
                      {locLabel(c, isRTL)}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {query ? (
              <>
                {searchResults.map(({ area, group }) => (
                  <Row
                    key={`${group.value}-${area.value}`}
                    label={
                      area.value === group.value
                        ? locLabel(area, isRTL)
                        : `${locLabel(area, isRTL)} · ${locLabel(group, isRTL)}`
                    }
                    active={selectedValue === area.value}
                    onPress={() => pick(area.value, locLabel(area, isRTL))}
                  />
                ))}

                {/* Reference dataset — compounds / projects / districts the
                    static list doesn't have. Picks store the place NAME as the
                    location value (adaptive free-text, matched by search). */}
                {refSuggestions.length > 0 ? (
                  <>
                    <AppText
                      style={[styles.sectionHeader, { color: colors.mutedForeground, textAlign }]}
                    >
                      {t("locationPicker.placesSection")}
                    </AppText>
                    {refSuggestions.map((p) => {
                      const nm = (isRTL ? p.name_ar || p.name_en : p.name_en) ?? "";
                      return (
                        <Row
                          key={p.id}
                          label={nm}
                          active={selectedValue === nm}
                          onPress={() => pick(nm, nm)}
                        />
                      );
                    })}
                  </>
                ) : null}

                {searchResults.length === 0 && refSuggestions.length === 0 ? (
                  <AppText style={[styles.empty, { color: colors.mutedForeground }]}>
                    {t("locationPicker.noResults")}
                  </AppText>
                ) : null}
              </>
            ) : activeGroup ? (
              <>
                <Row
                  label={t("locationPicker.allOf", {
                    name: locLabel(activeGroup, isRTL),
                  })}
                  active={selectedValue === activeGroup.value}
                  onPress={() =>
                    pick(activeGroup.value, locLabel(activeGroup, isRTL))
                  }
                />
                {activeGroup.areas.map((area) => (
                  <Row
                    key={area.value}
                    label={locLabel(area, isRTL)}
                    active={selectedValue === area.value}
                    onPress={() => pick(area.value, locLabel(area, isRTL))}
                  />
                ))}
              </>
            ) : (
              <>
                <Row
                  label={t("locationPicker.any")}
                  muted
                  active={!selectedValue}
                  onPress={() => {
                    reset();
                    onClear();
                  }}
                />
                {country.groups.map((group) =>
                  group.areas.length > 0 ? (
                    <Row
                      key={group.value}
                      label={locLabel(group, isRTL)}
                      chevron
                      onPress={() => setActiveGroup(group)}
                    />
                  ) : (
                    <Row
                      key={group.value}
                      label={locLabel(group, isRTL)}
                      active={selectedValue === group.value}
                      onPress={() => pick(group.value, locLabel(group, isRTL))}
                    />
                  )
                )}
              </>
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    height: "82%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    textAlign: "center",
  },
  searchBox: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  countryScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 4,
  },
  countryRow: {
    gap: 8,
    paddingBottom: 12,
    alignItems: "center",
  },
  countryPill: {
    paddingHorizontal: 16,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  list: {
    flex: 1,
  },
  row: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 14.5,
    flex: 1,
  },
  empty: {
    textAlign: "center",
    paddingVertical: 32,
    fontSize: 14,
  },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingTop: 16,
    paddingBottom: 6,
  },
});
