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
  Alert,
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
  IndustrialSubChips,
  type IndustrialType,
  apiCategoryFor,
  industrialGroupForCategory,
} from "@/components/CategoryTabs";
import {
  useInventoryFacets,
  visibleCategories,
  visibleEngines,
  visibleIndustrialTypes,
} from "@/lib/facets";
import {
  POPULAR_BRANDS,
  brandQuery,
  type CarBrand,
} from "@/constants/cars";
import { labelForValue } from "@/constants/locations";
import { DEFAULT_MARKET_COUNTRY } from "@/constants/listingCreateTaxonomy";
import {
  loadPreferredMarketCountry,
  savePreferredMarketCountry,
} from "@/lib/marketPreference";
import { engineByKey, enginesForCategory } from "@/constants/engines";
import { useI18n } from "@/context/LanguageContext";
import { SavedSearch, useSession } from "@/context/SessionContext";
import { useSound } from "@/context/SoundContext";
import {
  hasIncomingSearchNavParams,
  parseMobileSearchNavParams,
  searchCriteriaToNavParams,
} from "@/lib/searchNavParams";
import { useColors } from "@/hooks/useColors";
import { useSearchMiniApp } from "@/hooks/useSearchMiniApp";
import {
  CLEAR_SECTION_ATTRS,
  DEFAULT_CRITERIA,
  SearchCriteria,
  criteriaKey,
  hasActiveCriteria,
  type PaymentType,
  type SearchSort,
} from "@/lib/searchParams";
import {
  DEFAULT_NEAR_RADIUS_KM,
  requestNearMeCoords,
} from "@/lib/nearMe";
import {
  MarketCountryButton,
  MarketCountryPicker,
} from "@/components/MarketCountryPicker";
import {
  rentalTermsForSearch,
  sanitizeRentalTermForMarket,
} from "@/lib/searchTaxonomy";
import { sectionAccent } from "@/lib/sectionTheme";

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
const QUICK_BRANDS: CarBrand[] = POPULAR_BRANDS;

// Section-scoped attrs — shared CLEAR_SECTION_ATTRS from search-contract
// (same wipe as web SearchControls on category change).
const CLEAR_ATTRS = CLEAR_SECTION_ATTRS;

// The category-independent filters, reset by the sheet's "Clear all" (combined
// with CLEAR_ATTRS). The text query is intentionally preserved.
const CLEAR_FILTERS: Partial<SearchCriteria> = {
  category: "all",
  sort: "recommended",
  minPrice: "",
  maxPrice: "",
  location: "",
  paymentType: "any",
  marketCountry: DEFAULT_MARKET_COUNTRY,
  nearMeEnabled: false,
  nearLat: null,
  nearLng: null,
  nearRadiusKm: DEFAULT_NEAR_RADIUS_KM,
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
    recordQuery,
  } = useSession();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const params = useLocalSearchParams<Record<string, string | string[]>>();

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
  const { criteria, items, viewState, phase, hasNext, commit, update, applyPatch, loadMore, retry } =
    search;

  // Hydrate preferred market (shared with create publish stamp) once on mount.
  const marketHydrated = useRef(false);
  useEffect(() => {
    if (marketHydrated.current) return;
    let cancelled = false;
    void loadPreferredMarketCountry().then((iso) => {
      if (cancelled) return;
      marketHydrated.current = true;
      if (iso === DEFAULT_MARKET_COUNTRY) return;
      applyPatch({
        marketCountry: iso,
        rentalTerm: sanitizeRentalTermForMarket(null, iso),
      });
      if (items.length > 0 || phase !== "idle") retry();
    });
    return () => {
      cancelled = true;
    };
  }, [applyPatch, retry, items.length, phase]);

  // Map view toggle. Only results that carry real coordinates are mappable, so
  // both the toggle's visibility and the map's honest "N on the map" caption are
  // driven by this subset — never the full result list.
  const [mapMode, setMapMode] = useState(false);
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
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
  // Map chrome is available whenever results are showing. Page items may lack
  // coordinates while GET /search/map still returns clusters for the same filters.
  const inResultsView = viewState === "results";
  const hasPagePins = mappableItems.length > 0;
  const showMapChrome = inResultsView;
  // Leaving results drops back to the list — never keep map over discover/empty/error.
  useEffect(() => {
    if (!inResultsView && mapMode) setMapMode(false);
  }, [inResultsView, mapMode]);

  // Sticky map is a trap: ANY criteria change (fuel, material, years, price…)
  // returns to the list so each section's results stay the default surface.
  // Explore-on-map still latches wantMap after the next fetch.
  const criteriaMapKey = criteriaKey(criteria);
  const prevCriteriaMapKey = useRef(criteriaMapKey);
  useEffect(() => {
    if (prevCriteriaMapKey.current === criteriaMapKey) return;
    prevCriteriaMapKey.current = criteriaMapKey;
    setMapMode(false);
  }, [criteriaMapKey]);

  // "Explore on map" from discover: the results that decide whether a map is
  // even possible haven't loaded yet, so latch the intent. Flip to map mode the
  // moment mappable results arrive, or drop the intent when the browse resolves
  // with no coordinates (results/empty/error) — never wait on an impossible map.
  const [wantMap, setWantMap] = useState(false);
  useEffect(() => {
    if (!wantMap) return;
    if (inResultsView) {
      setMapMode(true);
      setWantMap(false);
      return;
    }
    if (viewState === "empty" || viewState === "error") {
      if (viewState !== "error") {
        Alert.alert(t("search.discover.exploreMap"), t("search.mapNoPins"));
      }
      setWantMap(false);
    }
  }, [wantMap, inResultsView, viewState, t]);

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
  const activeGroup = industrialGroupForCategory(criteria.category);
  const visibleIndTypes = useMemo(
    () => (activeGroup ? visibleIndustrialTypes(activeGroup, scopedFacets) : null),
    [activeGroup, scopedFacets]
  );
  const showIndustrialChips =
    !facetsLoading && !!visibleIndTypes && visibleIndTypes.length > 1;
  // If facets reveal the committed engine/sub-type no longer has inventory,
  // normalize criteria once and re-query (single fetch, not two updates).
  // MUST clear dependents (originType / rentalTerm / industry / material) so
  // hidden chrome never leaves a live API filter from another mini-app.
  useEffect(() => {
    if (facetsLoading) return;
    const patch: Partial<SearchCriteria> = {};
    if (
      criteria.engineKey !== "all" &&
      !engineList.some((e) => e.key === criteria.engineKey)
    ) {
      patch.engineKey = "all";
      // Leaving import must not keep origin_type=imported under "All".
      if (criteria.category === "car" && criteria.originType) {
        patch.originType = null;
      }
      // Leaving rent must not keep rental_term under sale/all.
      if (criteria.category === "real_estate" && criteria.rentalTerm) {
        patch.rentalTerm = null;
      }
    }
    if (
      criteria.industrialType !== "all" &&
      visibleIndTypes &&
      !visibleIndTypes.includes(criteria.industrialType)
    ) {
      patch.industrialType = "all";
      // Same clears as selectIndustrialType when collapsing to group "all".
      if (criteria.category === "materials") {
        patch.industry = null;
        patch.material = null;
      }
    }
    if (Object.keys(patch).length === 0) return;
    applyPatch(patch);
    const next = { ...criteria, ...patch };
    if (hasActiveCriteria(next)) retry();
  }, [
    engineList,
    visibleIndTypes,
    criteria,
    applyPatch,
    retry,
    facetsLoading,
  ]);

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

  const autocompleteSeq = useRef(0);

  const fetchAutocomplete = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setSuggestions([]);
        return;
      }
      const seq = ++autocompleteSeq.current;
      try {
        // Scope suggestions to the active browse company — never mix villa
        // titles into cars or steel into facilities.
        const params: {
          q: string;
          category?: SearchListingsCategory;
          industrial_type?: string;
        } = { q };
        if (criteria.category === "car" || criteria.category === "real_estate") {
          params.category = criteria.category;
        } else if (
          criteria.category === "facilities" ||
          criteria.category === "materials"
        ) {
          params.category = "industrial";
          if (criteria.industrialType !== "all") {
            params.industrial_type = criteria.industrialType;
          } else {
            const group = industrialGroupForCategory(criteria.category);
            if (group?.length) params.industrial_type = group.join(",");
          }
        }
        const res = await getAutocomplete(params);
        if (seq !== autocompleteSeq.current) return;
        setSuggestions(res.data ?? []);
      } catch {
        if (seq !== autocompleteSeq.current) return;
        setSuggestions([]);
      }
    },
    [criteria.category, criteria.industrialType],
  );

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
    // Deliberate searches only (submit / suggestion tap) feed the "recent
    // searches" chips — the debounced while-typing commits would record
    // half-typed words.
    recordQuery(q);
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

  // Deep links / saved searches / assistant → full contract parse.
  const appliedSig = useRef<string>("");
  useEffect(() => {
    if (!hasIncomingSearchNavParams(params)) return;
    const sig = JSON.stringify(params);
    if (sig === appliedSig.current) return;
    appliedSig.current = sig;

    let cancelled = false;
    void (async () => {
      const preferredMarket = await loadPreferredMarketCountry();
      if (cancelled) return;
      const parsed = parseMobileSearchNavParams(params);
      const hasMarketInUrl =
        params.market_country != null || params.marketCountry != null;
      setDraftQuery(parsed.q);
      setBrandValue(parsed.brand);
      commit({
        ...DEFAULT_CRITERIA,
        ...parsed,
        marketCountry: hasMarketInUrl ? parsed.marketCountry : preferredMarket,
        rentalTerm: sanitizeRentalTermForMarket(
          parsed.rentalTerm,
          hasMarketInUrl ? parsed.marketCountry : preferredMarket,
        ),
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const handleSuggestionTap = (s: string) => {
    setDraftQuery(s);
    setBrandValue(null);
    commitQueryNow(s);
  };

  const handleCardPress = useCallback(
    (item: FeedItem) => {
      cacheFeedItem(item);
      router.push(`/listing/${item.id}`);
    },
    [cacheFeedItem],
  );

  const applySaved = useCallback(
    (s: SavedSearch) => {
      if (s.criteria) {
        setDraftQuery(s.criteria.q);
        setBrandValue(s.criteria.brand);
        commit({ ...DEFAULT_CRITERIA, ...s.criteria });
        return;
      }
      router.push({
        pathname: "/(tabs)/search",
        params: searchCriteriaToNavParams({
          ...DEFAULT_CRITERIA,
          q: s.q,
          category: (CATEGORIES.includes(s.category as FilterCategory)
            ? s.category
            : "all") as FilterCategory,
          minPrice: s.minPrice,
          maxPrice: s.maxPrice,
          location: s.location,
          paymentType: s.paymentType,
        }),
      });
    },
    [commit],
  );

  const selectCategory = (cat: FilterCategory) => {
    // A brand browse shows its term in the search box; clear that display too so
    // the car term can't leak into the new category and empty its results.
    if (brandValue) setDraftQuery("");
    setBrandValue(null);
    setSuggestions([]);
    const patch: Partial<SearchCriteria> = { ...CLEAR_ATTRS, category: cat };
    // Installment chrome is car/RE only — never carry into facilities/materials.
    if (cat === "facilities" || cat === "materials") {
      patch.paymentType = "any";
    }
    update(patch);
  };

  // Discover-surface section/engine browse → filter THIS tab in place (same
  // committed-criteria path as the persistent tabs), instead of pushing a
  // separate /search-results screen. Sets category + engine atomically; mirrors
  // selectEngine so import also latches originType (one job, one criteria write).
  const browseSection = (cat: FilterCategory, engine: string) => {
    if (brandValue) setDraftQuery("");
    setBrandValue(null);
    setSuggestions([]);
    const def = engineByKey(cat, engine);
    const patch: Partial<SearchCriteria> = {
      ...CLEAR_ATTRS,
      category: cat,
      engineKey: engine,
    };
    if (def?.params.origin_type) {
      patch.originType = def.params.origin_type;
    }
    // Rent-only filters only survive an explicit rent engine browse.
    if (def?.params.offer_type !== "rent") {
      patch.rentalTerm = null;
    }
    if (cat === "facilities" || cat === "materials") {
      patch.paymentType = "any";
    }
    update(patch);
  };

  // Discover "Explore on map" → latch map intent on the CURRENT category so we
  // never hijack cars/industrial into real-estate. Host falls back to list if
  // the browse has no coordinates.
  const exploreOnMap = (section: Category) => {
    if (brandValue) setDraftQuery("");
    setBrandValue(null);
    setWantMap(true);
    const cat = section === "all" ? "real_estate" : section;
    update({
      ...CLEAR_ATTRS,
      category: cat,
      engineKey: "all",
    });
  };

  // Engine chip → committed criteria. Non-rent RE engines clear rent-only
  // filters so villa/warehouse/finance chips never keep a stale rental_term.
  // Import cars also sets originType so the filter matches industrial origin axis.
  // Fuel/transmission are FilterSheet-only (not engines) — no dual write here.
  const selectEngine = (key: string) => {
    const engine = engineByKey(criteria.category, key);
    const patch: Partial<SearchCriteria> = { engineKey: key };
    if (criteria.category === "real_estate") {
      patch.rentalTerm =
        engine?.params.offer_type === "rent" ? criteria.rentalTerm : null;
    }
    if (engine?.params.origin_type) {
      patch.originType = engine.params.origin_type;
    } else if (criteria.category === "car" && criteria.originType) {
      patch.originType = null;
    }
    update(patch);
  };

  const selectIndustrialType = (type: IndustrialType) => {
    const patch: Partial<SearchCriteria> = { industrialType: type };
    // Commodity browse must not keep a stale factory-sector industry filter.
    if (
      criteria.category === "materials" &&
      (type === "all" || type === "raw_material")
    ) {
      patch.industry = null;
    }
    // Machine / production_line don't use commodity material chips.
    if (
      criteria.category === "materials" &&
      type !== "all" &&
      type !== "raw_material"
    ) {
      patch.material = null;
    }
    update(patch);
  };

  const selectOrigin = (o: "all" | "local" | "imported") =>
    update({ originType: o === "all" ? null : o });

  // Materials own local/imported logistics; facilities are site assets.
  const showOriginChrome = criteria.category === "materials";

  const selectRentalTerm = (term: string) => {
    // Choosing a rental system implies rent browse — latch the rent engine so
    // the shopper never filters "old_law" under villa/sale without offer_type.
    const next = criteria.rentalTerm === term ? null : term;
    update({
      rentalTerm: next,
      ...(next && criteria.category === "real_estate"
        ? { engineKey: "rent" }
        : {}),
    });
  };

  const selectMarketCountry = (code: string) => {
    void savePreferredMarketCountry(code);
    update({
      marketCountry: code,
      rentalTerm: sanitizeRentalTermForMarket(criteria.rentalTerm, code),
    });
  };

  const toggleNearMe = useCallback(async () => {
    if (criteria.nearMeEnabled) {
      update({
        nearMeEnabled: false,
        nearLat: null,
        nearLng: null,
      });
      return;
    }
    const coords = await requestNearMeCoords();
    if (!coords) {
      Alert.alert(t("search.nearMe"), t("search.nearMeDenied"));
      return;
    }
    update({
      nearMeEnabled: true,
      nearLat: coords.lat,
      nearLng: coords.lng,
      nearRadiusKm: DEFAULT_NEAR_RADIUS_KM,
    });
  }, [criteria.nearMeEnabled, t, update]);

  const rentalTerms = rentalTermsForSearch(criteria.marketCountry);

  const originKey: "all" | "local" | "imported" =
    criteria.originType === "local" || criteria.originType === "imported"
      ? criteria.originType
      : "all";

  const showRentalTerms =
    criteria.category === "real_estate" &&
    engineByKey(criteria.category, criteria.engineKey)?.params.offer_type ===
      "rent";

  // Quick brand chip inside the sheet (closes the sheet via browseBrand).
  const browseBrandChip = useCallback(
    (b: CarBrand) => browseBrand(b, null),
    [browseBrand]
  );

  // "Clear all" inside the sheet: drop every filter but keep the text query.
  const clearAllFilters = useCallback(() => {
    setBrandValue(null);
    void savePreferredMarketCountry(DEFAULT_MARKET_COUNTRY);
    update({ ...CLEAR_ATTRS, ...CLEAR_FILTERS });
  }, [update]);

  const handleSaveSearch = () => {
    const snapshot: SearchCriteria = {
      ...criteria,
      q: draftQuery.trim(),
    };
    saveSearch({
      criteria: snapshot,
      q: snapshot.q,
      category: snapshot.category,
      minPrice: snapshot.minPrice,
      maxPrice: snapshot.maxPrice,
      location: snapshot.location,
      paymentType: snapshot.paymentType,
    });
  };

  // Count filters owned by the active browse company (badge must not lie).
  const rentEngineActive =
    criteria.category === "real_estate" &&
    engineByKey(criteria.category, criteria.engineKey)?.params.offer_type === "rent";
  const activeFilterCount = [
    criteria.category !== "all",
    criteria.engineKey !== "all",
    criteria.category === "facilities" || criteria.category === "materials"
      ? criteria.industrialType !== "all"
      : false,
    !!criteria.minPrice || !!criteria.maxPrice,
    !!criteria.location,
    criteria.paymentType !== "any" &&
      (criteria.category === "car" ||
        criteria.category === "real_estate" ||
        criteria.category === "all"),
    rentEngineActive && !!criteria.rentalTerm,
    criteria.category === "car" && (!!criteria.brand || !!criteria.model),
    criteria.category === "car" && !!criteria.fuelType,
    criteria.category === "car" && !!criteria.transmission,
    criteria.category === "car" && (!!criteria.minYear || !!criteria.maxYear),
    (criteria.category === "facilities" ||
      (criteria.category === "materials" &&
        (criteria.industrialType === "machine" ||
          criteria.industrialType === "production_line"))) &&
      !!criteria.industry,
    (criteria.category === "car" || criteria.category === "materials") &&
      !!criteria.originType,
    criteria.category === "materials" && !!criteria.material,
    criteria.nearMeEnabled,
    criteria.marketCountry !== DEFAULT_MARKET_COUNTRY,
  ].filter(Boolean).length;

  const searchSaved = isSearchSaved({
    criteria: { ...criteria, q: draftQuery.trim() },
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
        onSearchQuery={(q) => {
          setDraftQuery(q);
          commitQueryNow(q);
        }}
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

      {/* Primary chrome: categories only. Engines / industrial / origin stay
          one compact row. Country is a single searchable sheet (not chips).
          Rent engines are real (offer_type) — see search-contract engines. */}
      <CategoryTabs
        selected={criteria.category}
        onChange={selectCategory}
        visible={shownCategories}
      />
      <View style={[styles.secondaryChrome, { flexDirection: rowDir }]}>
        {!facetsLoading && engineList.length > 1 && !showIndustrialChips ? (
          <View style={styles.secondaryChromeFlex}>
            <EngineChips
              engines={engineList}
              selected={criteria.engineKey}
              onChange={selectEngine}
              accent={sectionAccent(criteria.category)}
            />
          </View>
        ) : null}
        {showIndustrialChips ? (
          <View style={styles.secondaryChromeFlex}>
            <IndustrialSubChips
              types={visibleIndTypes!}
              selected={criteria.industrialType}
              onChange={selectIndustrialType}
              accent={sectionAccent(criteria.category)}
            />
          </View>
        ) : null}
        <MarketCountryButton
          selected={criteria.marketCountry}
          onPress={() => {
            playSound("tap");
            setMarketPickerOpen(true);
          }}
        />
      </View>
      {showOriginChrome ? (
        <View style={[styles.originRow, { flexDirection: rowDir }]}>
          {(["all", "local", "imported"] as const).map((o) => {
            const active = originKey === o;
            return (
              <Pressable
                key={o}
                onPress={() => {
                  playSound("tap");
                  selectOrigin(o);
                }}
                style={[
                  styles.originChip,
                  {
                    backgroundColor: active
                      ? sectionAccent(criteria.category)
                      : colors.secondary,
                  },
                ]}
                testID={`search-origin-${o}`}
              >
                <AppText
                  style={[
                    styles.originChipText,
                    {
                      color: active
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {o === "all"
                    ? t("home.engines.all")
                    : t(`create.opts.${o}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* Shopper rent browse only — host ops live on Profile → Rental hub. */}
      {showRentalTerms ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.rentalChrome,
            { flexDirection: rowDir },
          ]}
        >
          {rentalTerms.map((r) => {
            const active = criteria.rentalTerm === r.value;
            return (
              <Pressable
                key={r.value}
                onPress={() => {
                  playSound("tap");
                  selectRentalTerm(r.value);
                }}
                style={[
                  styles.originChip,
                  {
                    backgroundColor: active
                      ? sectionAccent(criteria.category)
                      : colors.secondary,
                  },
                ]}
                testID={`search-rental-${r.value}`}
              >
                <AppText
                  style={[
                    styles.originChipText,
                    {
                      color: active
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {isRTL ? r.ar : r.en}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Orientation line: how many results the current criteria produced.
          "24+" while more pages exist, exact once the tail is loaded. */}
      {viewState === "results" && items.length > 0 && (
        <AppText
          style={[
            styles.resultsCount,
            { color: colors.mutedForeground, textAlign },
          ]}
          testID="results-count"
        >
          {t("search.resultsCount", {
            count: `${items.length}${hasNext ? "+" : ""}`,
          })}
        </AppText>
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
        onUpdate={(partial) => {
          if (partial.marketCountry) {
            void savePreferredMarketCountry(partial.marketCountry);
          }
          // FilterSheet rental-term toggle must latch rent engine (same as chrome).
          if (
            partial.rentalTerm &&
            criteria.category === "real_estate" &&
            criteria.engineKey !== "rent"
          ) {
            partial = { ...partial, engineKey: "rent" };
          }
          if (
            partial.rentalTerm === null &&
            Object.prototype.hasOwnProperty.call(partial, "rentalTerm")
          ) {
            // clearing term alone is fine
          }
          update(partial);
        }}
        onOpenLocationPicker={() => setLocationPickerOpen(true)}
        onClearLocation={() => update({ location: "" })}
        onToggleNearMe={() => void toggleNearMe()}
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

        {mapMode && inResultsView ? (
          <SearchResultsMap
            items={mappableItems}
            criteria={criteria}
            onOpenListing={handleCardPress}
            onOpenListingId={(id) =>
              router.push(
                // From a real-estate map, land the guest on the booking widget if
                // the listing is a furnished/daily rental (harmless no-op otherwise).
                criteria.category === "real_estate"
                  ? `/listing/${id}?focus=booking`
                  : `/listing/${id}`,
              )
            }
            onSave={toggleSave}
            isSaved={isSaved}
          />
        ) : null}

        {showMapChrome ? (
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
                {mapMode
                  ? t("search.viewList")
                  : hasPagePins
                    ? `${t("search.viewMap")} (${mappableItems.length})`
                    : t("search.viewMap")}
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

      <MarketCountryPicker
        visible={marketPickerOpen}
        selected={criteria.marketCountry}
        onClose={() => setMarketPickerOpen(false)}
        onSelect={(iso) => {
          selectMarketCountry(iso);
          setMarketPickerOpen(false);
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
  resultsCount: { fontSize: 12.5, paddingHorizontal: 16, paddingTop: 8 },
  secondaryChrome: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
    minHeight: 0,
  },
  secondaryChromeFlex: {
    flex: 1,
    minWidth: 0,
  },
  rentalChrome: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
  },
  originRow: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  originChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
  },
  originChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
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
