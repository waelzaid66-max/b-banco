import { Feather, Ionicons } from "@/components/icons";
import { AppTextInput as TextInput } from "@/components/AppTextInput";
import type { TextInput as RNTextInput } from "react-native";
import {
  getAutocomplete,
  sendBehaviorSignal,
  FeedItem,
  SearchListingsCategory,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppText } from "@/components/AppText";
import { CarPicker } from "@/components/CarPicker";
import { LocationPicker } from "@/components/LocationPicker";
import { SearchDiscover } from "@/components/SearchDiscover";
import { SkeletonCard } from "@/components/SkeletonCard";
import { SearchResultsSurface } from "@/components/search/SearchResultsSurface";
import { SearchResultsMap } from "@/components/search/SearchResultsMap";
import { FilterSheet } from "@/components/search/FilterSheet";
import {
  Category,
  CategoryIcon,
  CategoryTabs,
  EngineChips,
  apiCategoryFor,
} from "@/components/CategoryTabs";
import {
  useInventoryFacets,
  visibleCategories,
  visibleEngines,
} from "@/lib/facets";
import {
  POPULAR_BRANDS,
  brandQuery,
  type CarBrand,
} from "@/constants/cars";
import { labelForValue } from "@/constants/locations";
import { useI18n } from "@/context/LanguageContext";
import { SavedSearch, useSession } from "@/context/SessionContext";
import { useSound } from "@/context/SoundContext";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useColors } from "@/hooks/useColors";
import { useSearchMiniApp } from "@/hooks/useSearchMiniApp";
import {
  DEFAULT_CRITERIA,
  SearchCriteria,
  type PaymentType,
  type SearchSort,
} from "@/lib/searchParams";

type FilterCategory = Category;

const CATEGORIES: FilterCategory[] = [
  "all",
  "car",
  "real_estate",
  "facilities",
  "materials",
];

// Quick brand chips = popular brands that actually have live inventory (the
// create-safe set). The full rich catalogue is reachable via the "All brands"
// picker; brands with no inventory there honestly return empty results.
const QUICK_BRANDS: CarBrand[] = POPULAR_BRANDS.filter((b) => b.createSafe);

// Car/industrial attribute fields are category-specific; clear them whenever the
// category changes so e.g. a car fuel filter never leaks into a real-estate browse.
const CLEAR_ATTRS: Partial<SearchCriteria> = {
  engineKey: "all",
  brand: null,
  model: null,
  fuelType: null,
  transmission: null,
  minYear: "",
  maxYear: "",
  industry: null,
  originType: null,
};

// The category-independent filters, reset by the sheet's "Clear all" (combined
// with CLEAR_ATTRS). The text query is intentionally preserved.
const CLEAR_FILTERS: Partial<SearchCriteria> = {
  category: "all",
  sort: "recommended",
  minPrice: "",
  maxPrice: "",
  location: "",
  paymentType: "any",
};

// Valid sort keys arriving via navigation (e.g. the Home "Sort" launcher). Any
// other / missing value falls back to "recommended".
const SORTS: SearchSort[] = [
  "recommended",
  "newest",
  "price_asc",
  "price_desc",
  "popular",
];

/**
 * Leading icon of the search box. Morphs between the generic search glyph (no
 * category filter) and the active section's icon when a category is selected —
 * crossfading the same two stacked nodes via Reanimated (never remounted). The
 * last concrete category is retained so fading back out reads cleanly.
 */
function MorphSearchIcon({
  category,
  color,
}: {
  category: FilterCategory;
  color: string;
}) {
  const active = category !== "all";
  const [lastCat, setLastCat] = useState<FilterCategory>(
    active ? category : "car"
  );
  useEffect(() => {
    if (active) setLastCat(category);
  }, [active, category]);

  const p = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(active ? 1 : 0, { duration: 240 });
  }, [active, p]);

  const searchStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ scale: 1 - p.value * 0.3 }],
  }));
  const catStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 0.7 + p.value * 0.3 }],
  }));

  return (
    <View style={styles.morphIcon}>
      <Animated.View style={[styles.morphLayer, searchStyle]}>
        <Feather name="search" size={18} color={color} />
      </Animated.View>
      <Animated.View style={[styles.morphLayer, catStyle]}>
        <CategoryIcon category={lastCat} size={18} color={color} />
      </Animated.View>
    </View>
  );
}

export default function SearchScreen() {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const { playSound } = useSound();
  const insets = useSafeAreaInsets();
  const {
    sessionId,
    isSaved,
    toggleSave,
    saveSearch,
    isSearchSaved,
    cacheFeedItem,
  } = useSession();
  const { requireAuth } = useAuthGate();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const params = useLocalSearchParams<{
    q?: string;
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    location?: string;
    paymentType?: string;
    sort?: string;
  }>();

  // Fire a coarse behaviour signal on each committed search (category intent).
  const onCommitted = useCallback(
    (c: SearchCriteria) => {
      sendBehaviorSignal({
        session_id: sessionId,
        action: "click",
        category: apiCategoryFor(c.category) as
          | SearchListingsCategory
          | undefined,
      }).catch(() => {});
    },
    [sessionId]
  );

  const search = useSearchMiniApp(onCommitted);
  const { criteria, items, viewState, phase, hasNext, commit, update, loadMore, retry } =
    search;

  // Map view toggle. Only results that carry real coordinates are mappable, so
  // both the toggle's visibility and the map's honest "N on the map" caption are
  // driven by this subset — never the full result list.
  const [mapMode, setMapMode] = useState(false);
  const mappableItems = useMemo(
    () =>
      items.filter(
        (i) =>
          i.coordinates &&
          Number.isFinite(i.coordinates.lat) &&
          Number.isFinite(i.coordinates.lng)
      ),
    [items]
  );
  const canMap = viewState === "results" && mappableItems.length > 0;
  // Leaving results (or losing every mapped pin) drops back to the list so the
  // map never lingers over a discover/loading/empty/error surface.
  useEffect(() => {
    if (!canMap && mapMode) setMapMode(false);
  }, [canMap, mapMode]);

  // "Explore on map" from discover: the results that decide whether a map is
  // even possible haven't loaded yet, so latch the intent. Flip to map mode the
  // moment mappable results arrive, or drop the intent when the browse resolves
  // with no coordinates (results/empty/error) — never wait on an impossible map.
  const [wantMap, setWantMap] = useState(false);
  useEffect(() => {
    if (!wantMap) return;
    if (canMap) {
      setMapMode(true);
      setWantMap(false);
    } else if (
      viewState === "results" ||
      viewState === "empty" ||
      viewState === "error"
    ) {
      setWantMap(false);
    }
  }, [wantMap, canMap, viewState]);

  // Category chips are facet-gated: only categories with live inventory show.
  // Fails open while facets load; the active category is always kept visible.
  const { globalFacets, scopedFacets, loading: facetsLoading } =
    useInventoryFacets(criteria.category);
  const shownCategories = useMemo(() => {
    const visible = visibleCategories(CATEGORIES, globalFacets);
    return CATEGORIES.filter(
      (c) => visible.includes(c) || c === criteria.category
    );
  }, [globalFacets, criteria.category]);

  // Facet-gated "Type" chips for the active category (cars / real-estate).
  const engineList = useMemo(
    () => visibleEngines(criteria.category, scopedFacets),
    [criteria.category, scopedFacets]
  );
  // If a refresh reveals the selected engine no longer has inventory, fall back
  // to "all" so the committed criteria never references a vanished chip.
  useEffect(() => {
    // Skip while facets load: requiresFacet chips fail closed during the load
    // window, so resetting here would wipe a remembered selection on return.
    if (facetsLoading) return;
    if (
      criteria.engineKey !== "all" &&
      !engineList.some((e) => e.key === criteria.engineKey)
    ) {
      update({ engineKey: "all" });
    }
  }, [engineList, criteria.engineKey, update, facetsLoading]);

  // Live text input value (the only field that is debounced rather than
  // committed immediately). Price / year drafts live inside the FilterSheet.
  const [draftQuery, setDraftQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [brandValue, setBrandValue] = useState<string | null>(null);
  const [carPickerOpen, setCarPickerOpen] = useState(false);

  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<RNTextInput>(null);

  useEffect(
    () => () => {
      if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    []
  );

  const fetchAutocomplete = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await getAutocomplete({ q });
      setSuggestions(res.data ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  // Live typing: update the input immediately, debounce autocomplete (250ms) and
  // the committed search (350ms). The results list stays mounted throughout, so
  // each keystroke refreshes results in place with no flicker or remount.
  const handleQueryChange = (text: string) => {
    setDraftQuery(text);
    setBrandValue(null);
    setShowSuggestions(true);
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(() => fetchAutocomplete(text), 250);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      update({ q: text, brand: null, model: null });
    }, 350);
  };

  const commitQueryNow = (q: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    setShowSuggestions(false);
    update({ q, brand: null, model: null });
  };

  const clearQuery = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    setDraftQuery("");
    setBrandValue(null);
    setSuggestions([]);
    setShowSuggestions(false);
    update({ q: "", brand: null, model: null });
  };

  // Browse cars by brand: car titles are English "Brand Model Year", so the
  // brand's English term (or `q` override, e.g. Mercedes) is a reliable title
  // match. Forces category=car and commits immediately.
  const browseBrand = useCallback(
    (brand: CarBrand, model: string | null) => {
      const display = model
        ? `${brandQuery(brand)} ${model}`
        : brandQuery(brand);
      setDraftQuery(display);
      setBrandValue(brand.value);
      setShowFilters(false);
      setShowSuggestions(false);
      setCarPickerOpen(false);
      // Structured brand/model (not free-text q) so a later category switch or
      // picker-clear removes the car intent cleanly, and T003/T004 facet-gating
      // can read it. The backend matches brand/model via ilike on the English
      // title — the same match q would do — so results are unchanged.
      update({
        ...CLEAR_ATTRS,
        q: "",
        category: "car",
        brand: brandQuery(brand),
        model,
      });
    },
    [update]
  );

  // Re-run a saved search arriving via navigation params.
  const appliedSig = useRef<string>("");
  useEffect(() => {
    // Navigation can arrive with a free-text query, a category, and/or a sort
    // (the Home "Sort" launcher pushes only `sort`). Any one of the three is
    // enough to commit a browse; bare navigation with none of them is ignored.
    if (!params.q && !params.sort && !params.category) return;
    const sig = JSON.stringify(params);
    if (sig === appliedSig.current) return;
    appliedSig.current = sig;

    const category = (CATEGORIES.includes(params.category as FilterCategory)
      ? params.category
      : "all") as FilterCategory;
    const pt: PaymentType =
      params.paymentType === "installment" ? "installment" : "any";
    const sort: SearchSort = (SORTS.includes(params.sort as SearchSort)
      ? params.sort
      : "recommended") as SearchSort;
    const q = params.q ? String(params.q) : "";
    const minP = params.minPrice ? String(params.minPrice) : "";
    const maxP = params.maxPrice ? String(params.maxPrice) : "";
    const loc = params.location ? String(params.location) : "";

    setDraftQuery(q);
    setBrandValue(null);
    commit({
      ...DEFAULT_CRITERIA,
      q,
      category,
      minPrice: minP,
      maxPrice: maxP,
      location: loc,
      paymentType: pt,
      sort,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const handleSuggestionTap = (s: string) => {
    setDraftQuery(s);
    setBrandValue(null);
    commitQueryNow(s);
  };

  const handleCardPress = (item: FeedItem) => {
    // Guests are funneled into sign-up before any listing opens (Task #101).
    if (!requireAuth()) return;
    cacheFeedItem(item);
    router.push(`/listing/${item.id}`);
  };

  const applySaved = useCallback(
    (s: SavedSearch) => {
      const cat = (CATEGORIES.includes(s.category as FilterCategory)
        ? s.category
        : "all") as FilterCategory;
      setDraftQuery(s.q);
      setBrandValue(null);
      commit({
        ...DEFAULT_CRITERIA,
        q: s.q,
        category: cat,
        minPrice: s.minPrice,
        maxPrice: s.maxPrice,
        location: s.location,
        paymentType: s.paymentType,
      });
    },
    [commit]
  );

  const selectCategory = (cat: FilterCategory) => {
    // A brand browse shows its term in the search box; clear that display too so
    // the car term can't leak into the new category and empty its results.
    if (brandValue) setDraftQuery("");
    setBrandValue(null);
    update({ ...CLEAR_ATTRS, category: cat });
  };

  // Discover-surface section/engine browse → filter THIS tab in place (same
  // committed-criteria path as the persistent tabs), instead of pushing a
  // separate /search-results screen. Sets category + engine atomically.
  const browseSection = (cat: FilterCategory, engine: string) => {
    if (brandValue) setDraftQuery("");
    setBrandValue(null);
    update({ ...CLEAR_ATTRS, category: cat, engineKey: engine });
  };

  // Discover "Explore on map" → browse a coordinate-rich category (real-estate)
  // and latch the intent to flip to the map once mappable results land.
  const exploreOnMap = () => {
    if (brandValue) setDraftQuery("");
    setBrandValue(null);
    setWantMap(true);
    update({ ...CLEAR_ATTRS, category: "real_estate", engineKey: "all" });
  };

  // Engine "Type" chip selection inside the sheet → committed criteria.
  const selectEngine = (key: string) => update({ engineKey: key });

  // Quick brand chip inside the sheet (closes the sheet via browseBrand).
  const browseBrandChip = useCallback(
    (b: CarBrand) => browseBrand(b, null),
    [browseBrand]
  );

  // "Clear all" inside the sheet: drop every filter but keep the text query.
  const clearAllFilters = useCallback(() => {
    setBrandValue(null);
    update({ ...CLEAR_ATTRS, ...CLEAR_FILTERS });
  }, [update]);

  const handleSaveSearch = () => {
    saveSearch({
      q: draftQuery.trim(),
      category: criteria.category,
      minPrice: criteria.minPrice,
      maxPrice: criteria.maxPrice,
      location: criteria.location,
      paymentType: criteria.paymentType,
    });
  };

  const activeFilterCount = [
    criteria.category !== "all",
    !!criteria.minPrice || !!criteria.maxPrice,
    !!criteria.location,
    criteria.paymentType !== "any",
  ].filter(Boolean).length;

  const searchSaved =
    !!draftQuery.trim() &&
    isSearchSaved({
      q: draftQuery.trim(),
      category: criteria.category,
      minPrice: criteria.minPrice,
      maxPrice: criteria.maxPrice,
      location: criteria.location,
      paymentType: criteria.paymentType,
    });

  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  const locationLabel = criteria.location
    ? labelForValue(criteria.location, isRTL) || criteria.location
    : "";

  // The single overlay shown above the permanently-mounted results list. Null
  // means "show the list". Derived purely from the hook's view-state.
  let overlay: React.ReactNode = null;
  if (viewState === "discover") {
    overlay = (
      <SearchDiscover
        onBrowseBrand={(b) => browseBrand(b, null)}
        onApplySaved={applySaved}
        onOpenListing={handleCardPress}
        onBrowseSection={browseSection}
        onExploreMap={exploreOnMap}
      />
    );
  } else if (viewState === "loading") {
    overlay = (
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </View>
    );
  } else if (viewState === "error") {
    overlay = (
      <View style={styles.emptyState}>
        <Feather name="wifi-off" size={52} color={colors.mutedForeground} />
        <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>
          {t("search.errorTitle")}
        </AppText>
        <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {t("search.errorHint")}
        </AppText>
        <Pressable
          onPress={retry}
          style={[
            styles.applyBtn,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              paddingHorizontal: 28,
              marginTop: 16,
            },
          ]}
          testID="search-retry"
        >
          <AppText style={[styles.applyText, { color: colors.primaryForeground }]}>
            {t("search.retry")}
          </AppText>
        </Pressable>
      </View>
    );
  } else if (viewState === "empty") {
    overlay = (
      <View style={styles.emptyState}>
        <Feather name="alert-circle" size={52} color={colors.mutedForeground} />
        <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>
          {t("search.noResults")}
        </AppText>
        <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {t("search.noResultsHint")}
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            flexDirection: rowDir,
          },
        ]}
      >
        <View
          style={[
            styles.searchRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              flexDirection: rowDir,
            },
          ]}
        >
          <MorphSearchIcon
            category={criteria.category}
            color={colors.mutedForeground}
          />
          <TextInput
            ref={inputRef}
            value={draftQuery}
            onChangeText={handleQueryChange}
            onSubmitEditing={() => commitQueryNow(draftQuery)}
            onFocus={() => playSound("tap")}
            placeholder={t("search.placeholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, textAlign }]}
            returnKeyType="search"
            testID="search-input"
            autoCorrect={false}
          />
          {draftQuery.length > 0 && (
            <Pressable onPress={clearQuery} hitSlop={8}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {!!draftQuery.trim() && (
          <Pressable
            onPress={handleSaveSearch}
            disabled={searchSaved}
            style={[
              styles.iconBtn,
              {
                backgroundColor: searchSaved ? colors.primary : colors.secondary,
                borderRadius: colors.radius,
              },
            ]}
            testID="save-search"
          >
            <Feather
              name="bookmark"
              size={18}
              color={searchSaved ? colors.primaryForeground : colors.foreground}
            />
          </Pressable>
        )}

        <Pressable
          onPress={() => setShowFilters((v) => !v)}
          style={[
            styles.iconBtn,
            {
              backgroundColor:
                activeFilterCount > 0 ? colors.primary : colors.secondary,
              borderRadius: colors.radius,
            },
          ]}
          testID="filter-toggle"
        >
          <Feather
            name="sliders"
            size={18}
            color={
              activeFilterCount > 0
                ? colors.primaryForeground
                : colors.foreground
            }
          />
          {activeFilterCount > 0 && (
            <View
              style={[
                styles.filterBadge,
                { backgroundColor: colors.primaryForeground },
              ]}
            >
              <AppText style={[styles.filterBadgeText, { color: colors.primary }]}>
                {activeFilterCount}
              </AppText>
            </View>
          )}
        </Pressable>
      </View>

      {/* Persistent, always-visible section selector — the primary "selection
          tool". Picking a section sets criteria.category, which makes the
          criteria active and filters the list in place (no navigating away). */}
      <CategoryTabs
        selected={criteria.category}
        onChange={selectCategory}
        visible={shownCategories}
      />
      {/* In-place sub-filters for car / real-estate (new/used, property type,
          financing, …), surfaced under the tabs instead of buried in the filter
          sheet. Empty for every other section, so this row only appears where it
          applies. No rent/lease chip — that data does not exist (see
          constants/engines.ts). */}
      {!facetsLoading && engineList.length > 1 && (
        <EngineChips
          engines={engineList}
          selected={criteria.engineKey}
          onChange={selectEngine}
        />
      )}

      <FilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        criteria={criteria}
        shownCategories={shownCategories}
        engines={engineList}
        quickBrands={QUICK_BRANDS}
        brandValue={brandValue}
        locationLabel={locationLabel}
        onSelectCategory={selectCategory}
        onSelectEngine={selectEngine}
        onBrowseBrand={browseBrandChip}
        onOpenBrandPicker={() => setCarPickerOpen(true)}
        onUpdate={update}
        onOpenLocationPicker={() => setLocationPickerOpen(true)}
        onClearLocation={() => update({ location: "" })}
        onClearAll={clearAllFilters}
      />

      {showSuggestions && suggestions.length > 0 && (
        <View
          style={[
            styles.suggestions,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          {suggestions.map((s, i) => (
            <Pressable
              key={i}
              onPress={() => handleSuggestionTap(s)}
              style={[
                styles.suggestionItem,
                {
                  flexDirection: rowDir,
                  borderBottomColor:
                    i < suggestions.length - 1 ? colors.border : "transparent",
                },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={14}
                color={colors.mutedForeground}
              />
              <AppText style={[styles.suggestionText, { color: colors.foreground }]}>
                {s}
              </AppText>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.resultsArea}>
        <SearchResultsSurface
          items={items}
          onCardPress={handleCardPress}
          onSave={toggleSave}
          isSaved={isSaved}
          onEndReached={loadMore}
          loadingMore={phase === "loadingMore"}
          refreshing={phase === "refreshing"}
          error={phase === "error"}
          onRetry={retry}
          overlay={overlay}
        />

        {mapMode && canMap ? (
          <SearchResultsMap
            items={mappableItems}
            criteria={criteria}
            onOpenListing={handleCardPress}
            onOpenListingId={(id) => router.push(`/listing/${id}`)}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        ) : null}

        {canMap ? (
          <View
            style={[styles.mapToggleWrap, { bottom: insets.bottom + 80 }]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => {
                playSound("tap");
                setMapMode((m) => !m);
              }}
              style={[
                styles.mapToggle,
                {
                  backgroundColor: colors.foreground,
                  flexDirection: isRTL ? "row-reverse" : "row",
                },
              ]}
              testID="map-toggle"
            >
              <Feather
                name={mapMode ? "list" : "map"}
                size={16}
                color={colors.background}
              />
              <AppText style={[styles.mapToggleText, { color: colors.background }]}>
                {mapMode ? t("search.viewList") : t("search.viewMap")}
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>

      <LocationPicker
        visible={locationPickerOpen}
        selectedValue={criteria.location}
        onClose={() => setLocationPickerOpen(false)}
        onSelect={(value) => {
          update({ location: value });
          setLocationPickerOpen(false);
        }}
        onClear={() => {
          update({ location: "" });
          setLocationPickerOpen(false);
        }}
      />

      <CarPicker
        visible={carPickerOpen}
        mode="browse"
        selectedBrand={brandValue ?? undefined}
        onClose={() => setCarPickerOpen(false)}
        onSelect={(brand, model) => browseBrand(brand, model)}
        onClear={() => {
          setBrandValue(null);
          setDraftQuery("");
          update({ q: "", brand: null, model: null });
          setCarPickerOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  resultsArea: { flex: 1 },
  mapToggleWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  mapToggle: {
    alignItems: "center",
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mapToggleText: { fontSize: 14, fontWeight: "700" },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    alignItems: "center",
    gap: 10,
  },
  searchRow: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
  },
  morphIcon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  morphLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  iconBtn: {
    padding: 12,
    position: "relative",
  },
  filterBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
  applyBtn: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  applyText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  suggestions: {
    position: "absolute",
    top: 90,
    left: 16,
    right: 76,
    zIndex: 100,
    borderWidth: 1,
    overflow: "hidden",
  },
  suggestionItem: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  suggestionText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 40,
  },
});
