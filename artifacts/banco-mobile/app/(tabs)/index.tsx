import { Feather, Ionicons } from "@/components/icons";
import {
  getFeed,
  getTrending,
  getRecommendations,
  sendBehaviorSignal,
  useListNotifications,
  getListNotificationsQueryKey,
  FeedItem,
  GetFeedCategory,
  SendBehaviorSignalBodyAction,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import { Image } from "expo-image";
import { FlashList, FlashListRef, ViewToken } from "@shopify/flash-list";
import { BancoLogo } from "@/components/BancoLogo";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AppText } from "@/components/AppText";
import {
  CategoryTabs,
  CATEGORY_ORDER,
  Category,
  EngineChips,
  IndustrialSubChips,
  IndustrialType,
  IndustrialSubtype,
  apiCategoryFor,
  industrialGroupForCategory,
} from "@/components/CategoryTabs";
import { PromoBanner } from "@/components/PromoBanner";
import { engineByKey } from "@/constants/engines";
import {
  useInventoryFacets,
  visibleCategories,
  visibleEngines,
  visibleIndustrialTypes,
} from "@/lib/facets";
import { SkeletonCard } from "@/components/SkeletonCard";
import { SmartAssetCard } from "@/components/SmartAssetCard";
import {
  isVerifiedSignal,
  parsePriceValue,
  locationMatchesCity,
  mostCommonLocation,
} from "@/constants/feed";
import { useI18n } from "@/context/LanguageContext";
import { useSession } from "@/context/SessionContext";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useColors } from "@/hooks/useColors";

const PAGE_SIZE = 20;
const SCROLL_SIGNAL_THROTTLE_MS = 3000;
const RAIL_CARD_WIDTH = 260;
const MIN_INSTALLMENT_ITEMS = 3;

/**
 * Resolves the user's city from device GPS, but ONLY when location permission
 * has already been granted — we never trigger a permission prompt on launch
 * (poor conversion UX). Returns null on web, when not yet granted, or on any
 * error, so the caller falls back to the dominant market city. We never invent
 * a real-proximity claim: the fallback is relabeled with the city name.
 */
async function detectCity(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const Location = await import("expo-location");
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    const places = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });
    const place = places[0];
    return place?.city || place?.subregion || place?.region || null;
  } catch {
    return null;
  }
}

interface RailProps {
  title: string;
  items: FeedItem[];
  onCardPress: (item: FeedItem) => void;
  onSave: (item: FeedItem) => void;
  isSaved: (id: string) => boolean;
}

// Defined BEFORE Rail: the React Compiler rewrites component declarations into
// const bindings at their textual position, so a component referenced before its
// definition (here, via Rail's ItemSeparatorComponent prop) throws a runtime
// ReferenceError that typecheck/Metro do not catch.
function RailSeparator() {
  return <View style={{ width: 12 }} />;
}

function Rail({ title, items, onCardPress, onSave, isSaved }: RailProps) {
  const { isRTL } = useI18n();
  const colors = useColors();

  const renderRailItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <View style={{ width: RAIL_CARD_WIDTH }}>
        <SmartAssetCard
          item={item}
          onPress={onCardPress}
          onSave={onSave}
          isSaved={isSaved(item.id)}
          compact
        />
      </View>
    ),
    [onCardPress, onSave, isSaved]
  );

  if (!items.length) return null;
  const ordered = isRTL ? [...items].reverse() : items;
  return (
    <View style={styles.rail}>
      <View
        style={[
          styles.railHeader,
          { flexDirection: isRTL ? "row-reverse" : "row" },
        ]}
      >
        <AppText
          style={[styles.railTitle, { color: colors.foreground }]}
        >
          {title}
        </AppText>
      </View>
      {/* Horizontal FlashList virtualizes the rail so only on-screen cards are
          mounted — long discovery rails no longer render every card up front. */}
      <FlashList
        horizontal
        data={ordered}
        keyExtractor={(item) => item.id}
        renderItem={renderRailItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
        ItemSeparatorComponent={RailSeparator}
      />
    </View>
  );
}

// B-OOM sub-brand accent (BANCO Opportunity — Open Market). It occupies ONLY the
// small header gap between the BANCO wordmark and the action cluster — it never
// touches, resizes, recolors, or competes with the BANCO logo.
//
// Behaviour (one calm pass every 30s, like a branded car driving through):
//   • 0s → 26s   : fully hidden (opacity 0), no movement.
//   • 26.0s      : fade in over 250ms only.
//   • 26.25s →   : glide ONCE across the gap at a constant, calm speed (~3.75s).
//   • ~28.5s     : begin fading out WHILE still moving, gone before the far edge.
//   • then       : back to opacity 0 until the next 30s cycle.
// Only translateX + opacity animate (GPU thread, no layout, no scale/zoom/rotate).
// Uses the official B-OOM asset as-is (only its flat black backdrop was made
// transparent so it sits cleanly on both the dark and light header). Respects
// prefers-reduced-motion by showing the mark static instead of animating.
//
// NOTE: must be declared BEFORE FeedScreen — the React Compiler rewrites
// component declarations into const bindings at their textual position, so a
// component used before its definition throws a ReferenceError at runtime.
const BOOM_LOGO = require("../../assets/images/boom-logo.png");
const BOOM_ASPECT = 2045 / 769; // native px of the official B-OOM asset
const BOOM_H = 16; // fixed, smaller than the 26px BANCO wordmark (never competes)
const BOOM_W = Math.round(BOOM_H * BOOM_ASPECT);

function HeaderSpark() {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  const boxW = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    t.value = withRepeat(
      withTiming(1, { duration: 30000, easing: Easing.linear }),
      -1,
      false
    );
  }, [t, reduceMotion]);

  const logoStyle = useAnimatedStyle(() => {
    // Keep the whole mark inside the gap at both extremes (overflow:hidden also
    // guards it). span = half the free horizontal room.
    const span = Math.max(0, (boxW.value - BOOM_W) / 2);
    return {
      opacity: interpolate(
        t.value,
        [0.8667, 0.875, 0.95, 0.98, 1],
        [0, 1, 1, 0, 0],
        Extrapolation.CLAMP
      ),
      transform: [
        {
          translateX: interpolate(
            t.value,
            [0.875, 1],
            [-span, span],
            Extrapolation.CLAMP
          ),
        },
      ],
    };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    boxW.value = e.nativeEvent.layout.width;
  };

  if (reduceMotion) {
    return (
      <View style={styles.spark} pointerEvents="none">
        <Image
          source={BOOM_LOGO}
          style={{ width: BOOM_W, height: BOOM_H }}
          contentFit="contain"
        />
      </View>
    );
  }

  return (
    <View style={styles.spark} pointerEvents="none" onLayout={onLayout}>
      <Animated.View style={logoStyle}>
        <Image
          source={BOOM_LOGO}
          style={{ width: BOOM_W, height: BOOM_H }}
          contentFit="contain"
        />
      </Animated.View>
    </View>
  );
}

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const { width: windowWidth } = useWindowDimensions();
  // Responsive grid (web only): native stays single-column full-width cards.
  // Wide screens fan the feed into 2–3 columns and cap+center the content so
  // it reads like an industrial catalogue instead of a stretched phone feed.
  const isWeb = Platform.OS === "web";
  const MAX_CONTENT_WIDTH = 1180;
  const COLUMN_GUTTER = 14;
  const cappedWidth = Math.min(windowWidth, MAX_CONTENT_WIDTH);
  const numColumns = isWeb
    ? cappedWidth >= 1000
      ? 3
      : cappedWidth >= 680
        ? 2
        : 1
    : 1;
  const sidePad =
    isWeb && windowWidth > MAX_CONTENT_WIDTH
      ? (windowWidth - MAX_CONTENT_WIDTH) / 2
      : 16;
  const { sessionId, isSaved, toggleSave, recentlyViewed, listingsVersion } =
    useSession();
  const { requireAuth } = useAuthGate();
  const { isSignedIn, user } = useUser();
  const role = (user?.publicMetadata?.role as string) || "";
  const isBusiness = ["dealer", "company", "enterprise"].includes(role);
  const [showLogoMenu, setShowLogoMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const notifQuery = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      enabled: !!isSignedIn,
      refetchInterval: 20000,
      refetchOnWindowFocus: true,
    },
  });
  const unreadNotifs = (notifQuery.data?.data ?? []).filter(
    (n) => !n.read_at
  ).length;

  const [category, setCategory] = useState<Category>("all");
  const [industrialType, setIndustrialType] = useState<IndustrialType>("all");
  // Per-section engine filter (cars / real-estate). Key into constants/engines.
  const [engineKey, setEngineKey] = useState<string>("all");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const [trendingItems, setTrendingItems] = useState<FeedItem[]>([]);
  const [recommendedItems, setRecommendedItems] = useState<FeedItem[]>([]);
  const [installmentItems, setInstallmentItems] = useState<FeedItem[]>([]);
  const [verifiedItems, setVerifiedItems] = useState<FeedItem[]>([]);
  const [bestDealsItems, setBestDealsItems] = useState<FeedItem[]>([]);
  const [nearYouItems, setNearYouItems] = useState<FeedItem[]>([]);
  // When geo is unavailable we show listings from the dominant market city and
  // title the rail with that city name instead of falsely claiming proximity.
  const [nearbyCity, setNearbyCity] = useState<string | null>(null);
  const [recentlyAddedItems, setRecentlyAddedItems] = useState<FeedItem[]>([]);
  const [industrialItems, setIndustrialItems] = useState<FeedItem[]>([]);

  const lastScrollRef = useRef({ offset: 0, time: Date.now() });
  const lastSignalTimeRef = useRef(0);
  // Hide-on-scroll anchoring: the offset where scroll direction last reversed,
  // plus the current direction. The bar toggles only after a deliberate move
  // (>10px) past this anchor, so micro-jitter can't flip it — and any genuine
  // upward scroll reveals it, so it can never get "stuck" hidden.
  const scrollAnchorRef = useRef(0);
  const scrollDirRef = useRef<"up" | "down" | null>(null);
  const listRef = useRef<FlashListRef<FeedItem>>(null);

  // Per-category memory of the engine / industrial sub-type selection so moving
  // car → real_estate → car restores the car filter instead of resetting it.
  const filterMemoryRef = useRef<
    Partial<Record<Category, { engineKey: string; industrialType: IndustrialType }>>
  >({});

  // Hide-on-scroll: `compact` flips on scroll direction (once per flip, not per
  // event). It condenses the logo and collapses the engine bar via Reanimated —
  // the same nodes are restyled, never remounted.
  const reduceMotion = useReducedMotion();
  const [compact, setCompact] = useState(false);
  const [engineBarH, setEngineBarH] = useState(0);
  const barCollapse = useSharedValue(0);

  useEffect(() => {
    barCollapse.value = withTiming(compact ? 1 : 0, {
      duration: reduceMotion ? 0 : 220,
    });
  }, [compact, barCollapse, reduceMotion]);

  const engineBarStyle = useAnimatedStyle(() => ({
    height: engineBarH === 0 ? undefined : engineBarH * (1 - barCollapse.value),
    opacity: 1 - barCollapse.value,
  }));

  // Data-presence gating: chips only render for taxonomy that has live
  // inventory. Fails open while facets load (never hides real inventory on a
  // transient error); new taxonomy chips fail closed (see lib/facets).
  const { globalFacets, scopedFacets, loading: facetsLoading } =
    useInventoryFacets(category);
  const activeGroup = industrialGroupForCategory(category);
  const visibleCats = useMemo(
    () => visibleCategories(CATEGORY_ORDER, globalFacets),
    [globalFacets]
  );
  const engineList = useMemo(
    () => visibleEngines(category, scopedFacets),
    [category, scopedFacets]
  );
  const visibleIndTypes = useMemo(
    () => (activeGroup ? visibleIndustrialTypes(activeGroup, scopedFacets) : null),
    [activeGroup, scopedFacets]
  );
  // Gate on facets RESOLVED, not just on the fail-open engine set. While scoped
  // facets load, visibleEngines() fails open (returns the full core set), so
  // rendering during the load window shows the row and then collapses it once
  // real counts arrive — the "appears once then disappears" flicker. Waiting for
  // !facetsLoading shows the row exactly once, in its final state. On a genuine
  // facet error loading flips false with facets still undefined, so the row
  // still fails open (honest: never hide real, long-standing inventory).
  const showIndustrialChips =
    !facetsLoading && !!visibleIndTypes && visibleIndTypes.length > 1;
  const showEngineChips =
    !facetsLoading && !activeGroup && engineList.length > 1;
  const showEngineBar = showIndustrialChips || showEngineChips;

  // If facets reveal the active engine / sub-type no longer has inventory (or
  // its row is now hidden), fall back to "all" so we never query a dead filter.
  useEffect(() => {
    // Don't clear a remembered selection while facets are still loading —
    // requiresFacet chips (car automatic/manual/fuel) fail closed during the
    // load window, so resetting here would wipe the user's filter on every
    // return to the section. Only reset once facets have resolved.
    if (facetsLoading) return;
    if (engineKey !== "all" && !engineList.some((e) => e.key === engineKey)) {
      setEngineKey("all");
    }
  }, [engineList, engineKey, facetsLoading]);
  useEffect(() => {
    if (facetsLoading) return;
    if (
      industrialType !== "all" &&
      visibleIndTypes &&
      !visibleIndTypes.includes(industrialType as IndustrialSubtype)
    ) {
      setIndustrialType("all");
    }
  }, [visibleIndTypes, industrialType, facetsLoading]);
  const cursorRef = useRef<string | undefined>(undefined);
  cursorRef.current = cursor;
  const prefetchedRef = useRef<Set<string>>(new Set());

  const prefetchImages = useCallback((list: FeedItem[]) => {
    const urls: string[] = [];
    for (const it of list) {
      if (it.media_preview && !prefetchedRef.current.has(it.media_preview)) {
        prefetchedRef.current.add(it.media_preview);
        urls.push(it.media_preview);
      }
    }
    if (urls.length) {
      Image.prefetch(urls).catch(() => {});
    }
  }, []);

  const fetchFeed = useCallback(
    async (reset = false, overrideCursor?: string) => {
      try {
        // The two industrial groups ("facilities"/"materials") share the API
        // `industrial` category and are separated by industrial_type. We push
        // that filter to the server (the selected subtype, or the whole group's
        // subtypes) so paginated browsing never false-empties a filtered page.
        const group = industrialGroupForCategory(category);
        const apiCat = apiCategoryFor(category);
        const params: Parameters<typeof getFeed>[0] = {
          limit: PAGE_SIZE,
          session_id: sessionId,
        };
        if (apiCat) {
          params.category = apiCat;
        }
        if (group) {
          params.industrial_type =
            industrialType === "all" ? group.join(",") : industrialType;
        }
        // Per-section engine chip → real backend filter params (never faked).
        const engine = engineByKey(category, engineKey);
        if (engine) {
          Object.assign(params, engine.params);
        }
        if (!reset && (overrideCursor ?? cursorRef.current)) {
          params.cursor = overrideCursor ?? cursorRef.current;
        }

        const res = await getFeed(params);
        const data = res.data ?? [];
        const meta = res.meta;

        if (reset) {
          setItems(data);
        } else {
          setItems((prev) => [...prev, ...data]);
        }
        setCursor(meta?.cursor);
        setHasNext(meta?.has_next ?? false);
        setError(false);
        prefetchImages(data);
      } catch {
        if (reset) setError(true);
      }
    },
    [category, industrialType, engineKey, sessionId, prefetchImages]
  );

  // Discovery rails — fetched once; independent of the category filter below.
  // Trending, the shared pool, industrial slice, and geo city run in parallel
  // so home rails don't waterfall three feed round-trips on cold open.
  const loadRails = useCallback(async () => {
    const [trendingRes, poolRes, industrialRes, geoCity] = await Promise.all([
      getTrending().catch(() => ({ data: [] as FeedItem[] })),
      getFeed({ limit: 40, session_id: sessionId }).catch(() => ({
        data: [] as FeedItem[],
      })),
      getFeed({
        category: "industrial" as GetFeedCategory,
        limit: 20,
        session_id: sessionId,
      }).catch(() => ({ data: [] as FeedItem[] })),
      detectCity().catch(() => null as string | null),
    ]);

    setTrendingItems(trendingRes.data ?? []);

    const pool = poolRes.data ?? [];
    setInstallmentItems(pool.filter((it) => !!it.installment_badge));
    setVerifiedItems(pool.filter((it) => isVerifiedSignal(it.trust_signal)));

    const ranked = pool
      .map((it) => ({ it, value: parsePriceValue(it.price_display) }))
      .filter((x): x is { it: FeedItem; value: number } => x.value !== null)
      .sort((a, b) => a.value - b.value)
      .slice(0, 12)
      .map((x) => x.it);
    setBestDealsItems(ranked);

    const refCity = geoCity ?? mostCommonLocation(pool);
    setNearbyCity(geoCity ? null : refCity);
    setNearYouItems(
      refCity
        ? pool.filter((it) => locationMatchesCity(it.location, refCity))
        : []
    );
    setRecentlyAddedItems(pool.slice(0, 12));

    setIndustrialItems(industrialRes.data ?? []);
  }, [sessionId]);

  const loadRecommendations = useCallback(async () => {
    if (!isSignedIn) {
      setRecommendedItems([]);
      return;
    }
    try {
      const res = await getRecommendations();
      setRecommendedItems(res.data ?? []);
    } catch {
      setRecommendedItems([]);
    }
  }, [isSignedIn]);

  useEffect(() => {
    loadRails();
  }, [loadRails]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  // When the user publishes a listing (bumpListings()), refetch the feed + rails
  // so it shows on the home tab immediately. The ref guard ensures this fires
  // only on an actual version change, not when fetchFeed/loadRails identities
  // change (e.g. on category switch). The initial mount (version 0) is skipped —
  // the screen's own mount effects load first data.
  const lastListingsVersionRef = useRef(0);
  useEffect(() => {
    if (listingsVersion === lastListingsVersionRef.current) return;
    lastListingsVersionRef.current = listingsVersion;
    if (listingsVersion === 0) return;
    fetchFeed(true);
    loadRails();
    loadRecommendations();
  }, [listingsVersion, fetchFeed, loadRails, loadRecommendations]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setCursor(undefined);
    setHasNext(true);
    fetchFeed(true).then(() => setLoading(false));
  }, [category, industrialType, engineKey]);

  const handleRetry = async () => {
    setLoading(true);
    setError(false);
    setCursor(undefined);
    setHasNext(true);
    await Promise.all([fetchFeed(true), loadRails(), loadRecommendations()]);
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setCursor(undefined);
    await Promise.all([fetchFeed(true), loadRails(), loadRecommendations()]);
    setRefreshing(false);
  };

  const handleLoadMore = async () => {
    if (!hasNext || loadingMore || loading) return;
    setLoadingMore(true);
    await fetchFeed(false);
    setLoadingMore(false);
  };

  const handleCategoryChange = (cat: Category) => {
    // Re-tapping the already-active tab is a "reveal-on-retap": un-collapse the
    // engine bar (it auto-hides on scroll) and jump back to the top, without
    // disturbing the current filter selection.
    if (cat === category) {
      setCompact(false);
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }
    // Switching sections: stash the outgoing category's engine/sub-type so we
    // can restore it on return, then load the target category's remembered
    // selection (defaulting to "all"). This keeps a car fuel filter from
    // leaking into real-estate while still remembering it for next time.
    filterMemoryRef.current[category] = { engineKey, industrialType };
    const mem = filterMemoryRef.current[cat];
    setCategory(cat);
    setIndustrialType(mem?.industrialType ?? "all");
    setEngineKey(mem?.engineKey ?? "all");
    // New section → a new chip set with a different height. Expand the bar and
    // drop the cached pixel height so the next layout pass re-measures the
    // incoming content; otherwise a stale height reserves an empty gap.
    setCompact(false);
    setEngineBarH(0);
    sendBehaviorSignal({
      session_id: sessionId,
      action: "category_tap",
      category: apiCategoryFor(cat),
    }).catch(() => {});
  };

  const handleCardPress = useCallback(
    (item: FeedItem) => {
      // Guests are funneled into sign-up before any listing opens (Task #101).
      if (!requireAuth()) return;
      sendBehaviorSignal({
        session_id: sessionId,
        listing_id: item.id,
        action: "open_detail",
      }).catch(() => {});
      router.push(`/listing/${item.id}`);
    },
    [sessionId, requireAuth]
  );

  const itemsRef = useRef<FeedItem[]>(items);
  itemsRef.current = items;

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
      if (!viewableItems.length) return;
      const maxIndex = viewableItems.reduce(
        (max, v) => (v.index != null && v.index > max ? v.index : max),
        0
      );
      const upcoming = itemsRef.current.slice(maxIndex + 1, maxIndex + 6);
      prefetchImages(upcoming);
    },
    [prefetchImages]
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      const card = (
        <SmartAssetCard
          item={item}
          onPress={handleCardPress}
          onSave={toggleSave}
          isSaved={isSaved(item.id)}
        />
      );
      // In multi-column (wide web) layouts each cell gets a horizontal gutter
      // so the grid breathes; single-column keeps the card full-bleed.
      if (numColumns > 1) {
        return (
          <View style={{ flex: 1, paddingHorizontal: COLUMN_GUTTER / 2 }}>{card}</View>
        );
      }
      return card;
    },
    [handleCardPress, toggleSave, isSaved, numColumns]
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const now = Date.now();
      const currentOffset = e.nativeEvent.contentOffset.y;
      const prev = lastScrollRef.current;
      const elapsed = now - prev.time;
      const delta = Math.abs(currentOffset - prev.offset);

      // Near the top the bar is always shown. Otherwise toggle only after a
      // deliberate move (>10px) from the offset where direction last reversed,
      // so jitter can't flicker it and a real upward scroll always reveals it
      // (it can never get stuck hidden). The hide-on-scroll behavior is kept.
      if (currentOffset <= 90) {
        scrollDirRef.current = null;
        setCompact((c) => (c ? false : c));
      } else {
        const dir =
          currentOffset > prev.offset
            ? "down"
            : currentOffset < prev.offset
              ? "up"
              : scrollDirRef.current;
        if (dir && dir !== scrollDirRef.current) {
          scrollDirRef.current = dir;
          scrollAnchorRef.current = prev.offset;
        }
        const moved = currentOffset - scrollAnchorRef.current;
        if (dir === "down" && moved > 10) {
          setCompact((c) => (c ? c : true));
        } else if (dir === "up" && moved < -10) {
          setCompact((c) => (c ? false : c));
        }
      }

      lastScrollRef.current = { offset: currentOffset, time: now };

      if (now - lastSignalTimeRef.current < SCROLL_SIGNAL_THROTTLE_MS) return;
      if (elapsed <= 0 || delta < 30) return;

      const speed = delta / elapsed;
      const action: SendBehaviorSignalBodyAction =
        speed > 1.2 ? "scroll_fast" : "scroll_slow";

      lastSignalTimeRef.current = now;
      sendBehaviorSignal({ session_id: sessionId, action }).catch(() => {});
    },
    [sessionId]
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const showRails = category === "all";
  const hasRails =
    showRails &&
    (trendingItems.length > 0 ||
      recommendedItems.length > 0 ||
      bestDealsItems.length >= MIN_INSTALLMENT_ITEMS ||
      verifiedItems.length >= MIN_INSTALLMENT_ITEMS ||
      installmentItems.length >= MIN_INSTALLMENT_ITEMS ||
      nearYouItems.length >= MIN_INSTALLMENT_ITEMS ||
      recentlyAddedItems.length >= MIN_INSTALLMENT_ITEMS ||
      industrialItems.length >= MIN_INSTALLMENT_ITEMS ||
      recentlyViewed.length > 0);

  // B2B bridge (Task #154 T007): when the user browses an industrial group
  // (facilities / materials) we surface a non-deceptive shortcut into the
  // specs-first Industry Hub and the Business & Supply hub. Pure routing over
  // existing surfaces — no fabricated counts, offers, or quotes.
  const renderIndustrialBridge = () => {
    const rowDir = isRTL ? "row-reverse" : "row";
    const textAlign = isRTL ? "right" : "left";
    return (
      <View
        style={[
          styles.bridge,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <AppText
          style={[styles.bridgeTitle, { color: colors.foreground, textAlign }]}
        >
          {t("home.industrialBridge.title")}
        </AppText>
        <AppText
          style={[
            styles.bridgeSubtitle,
            { color: colors.mutedForeground, textAlign },
          ]}
        >
          {t("home.industrialBridge.subtitle")}
        </AppText>
        <View style={[styles.bridgeBtnRow, { flexDirection: rowDir }]}>
          <Pressable
            onPress={() => router.push("/industry")}
            style={[
              styles.bridgeBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                flexDirection: rowDir,
              },
            ]}
            testID="industrial-bridge-hub"
          >
            <Feather name="grid" size={15} color={colors.primaryForeground} />
            <AppText
              style={[styles.bridgeBtnText, { color: colors.primaryForeground }]}
            >
              {t("home.industrialBridge.hubCta")}
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => router.push("/business/supply-hub")}
            style={[
              styles.bridgeBtnOutline,
              {
                borderColor: colors.border,
                borderRadius: colors.radius,
                flexDirection: rowDir,
              },
            ]}
            testID="industrial-bridge-b2b"
          >
            <Feather name="briefcase" size={14} color={colors.foreground} />
            <AppText
              style={[styles.bridgeBtnText, { color: colors.foreground }]}
            >
              {t("home.industrialBridge.b2bCta")}
            </AppText>
          </Pressable>
        </View>
      </View>
    );
  };

  const ListHeader = useCallback(() => {
    if (activeGroup) return renderIndustrialBridge();
    if (!showRails) return null;
    return (
      <View>
        <PromoBanner
          onSelectCategory={handleCategoryChange}
          style={styles.homePromo}
        />
        {recentlyViewed.length > 0 && (
          <Rail
            title={t("home.sections.recentlyViewed")}
            items={recentlyViewed}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {recommendedItems.length > 0 && (
          <Rail
            title={t("home.sections.forYou")}
            items={recommendedItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {bestDealsItems.length >= MIN_INSTALLMENT_ITEMS && (
          <Rail
            title={t("home.sections.bestDeals")}
            items={bestDealsItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {installmentItems.length >= MIN_INSTALLMENT_ITEMS && (
          <Rail
            title={t("home.sections.installments")}
            items={installmentItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {verifiedItems.length >= MIN_INSTALLMENT_ITEMS && (
          <Rail
            title={t("home.sections.verifiedSellers")}
            items={verifiedItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {nearYouItems.length >= MIN_INSTALLMENT_ITEMS && (
          <Rail
            title={
              nearbyCity
                ? t("home.sections.inCity", { city: nearbyCity })
                : t("home.sections.nearYou")
            }
            items={nearYouItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {trendingItems.length > 0 && (
          <Rail
            title={t("home.sections.highDemand")}
            items={trendingItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {recentlyAddedItems.length >= MIN_INSTALLMENT_ITEMS && (
          <Rail
            title={t("home.sections.latest")}
            items={recentlyAddedItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {industrialItems.length >= MIN_INSTALLMENT_ITEMS && (
          <Rail
            title={t("home.sections.industrialOpportunities")}
            items={industrialItems}
            onCardPress={handleCardPress}
            onSave={toggleSave}
            isSaved={isSaved}
          />
        )}
        {hasRails && items.length > 0 && (
          <AppText
            style={[
              styles.feedTitle,
              {
                color: colors.foreground,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {t("home.feedTitle")}
          </AppText>
        )}
      </View>
    );
  }, [
    activeGroup,
    showRails,
    recentlyViewed,
    recommendedItems,
    bestDealsItems,
    installmentItems,
    verifiedItems,
    nearYouItems,
    nearbyCity,
    trendingItems,
    recentlyAddedItems,
    industrialItems,
    hasRails,
    items.length,
    handleCardPress,
    toggleSave,
    isSaved,
    handleCategoryChange,
    colors,
    isRTL,
    t,
  ]);

  const renderSkeletons = () => (
    <View style={{ paddingHorizontal: 16 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Feather name="inbox" size={48} color={colors.mutedForeground} />
      <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>
        {t("home.emptyTitle")}
      </AppText>
      <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
        {t("home.emptyHint")}
      </AppText>
    </View>
  );

  const renderError = () => (
    <View style={styles.empty}>
      <Feather name="wifi-off" size={48} color={colors.mutedForeground} />
      <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>
        {t("home.errorTitle")}
      </AppText>
      <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
        {t("home.errorHint")}
      </AppText>
      <Pressable
        onPress={handleRetry}
        style={[
          styles.retryBtn,
          { backgroundColor: colors.primary, borderRadius: colors.radius },
        ]}
        testID="feed-retry"
      >
        <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
        <AppText style={[styles.retryText, { color: colors.primaryForeground }]}>
          {t("common.retry")}
        </AppText>
      </Pressable>
    </View>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <SkeletonCard />
      </View>
    );
  };

  const logoMenuRows: {
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    route: Href;
  }[] = [
    { icon: "grid", label: t("home.menuMyListings"), route: "/listings/mine" },
    { icon: "bookmark", label: t("home.menuSaved"), route: "/(tabs)/saved" },
    { icon: "bell", label: t("home.menuAlerts"), route: "/notifications" },
    { icon: "user", label: t("home.menuProfile"), route: "/(tabs)/profile" },
    { icon: "briefcase", label: t("home.menuBusiness"), route: "/business/supply-hub" },
    { icon: "message-square", label: t("home.menuAssistant"), route: "/assistant" },
    { icon: "settings", label: t("home.menuSettings"), route: "/settings" },
  ];
  if (isBusiness) {
    logoMenuRows.push({
      icon: "users",
      label: t("home.menuLeads"),
      route: "/business/requests",
    });
  } else {
    // Prominent, always-visible path for individuals into the BANCO Business
    // company-account + verification (KYC) flow.
    logoMenuRows.unshift({
      icon: "shield",
      label: t("home.menuGetVerified"),
      route: "/business/onboarding",
    });
  }

  const handleSort = (key: string) => {
    Haptics.selectionAsync().catch(() => {});
    setShowSortMenu(false);
    // "Recommended" is the home feed's own default ordering — stay put.
    if (key === "recommended") return;
    // Every other option launches the real, server-sorted browse on the Search
    // tab (search.tsx reads `sort` and commits it as criteria.sort).
    router.push({
      pathname: "/(tabs)/search",
      params: { sort: key, ts: String(Date.now()) },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.background,
            // Header is fixed "furniture": logo leads, action cluster trails —
            // physically stable in both languages (no RTL mirroring of chrome).
            flexDirection: "row",
          },
        ]}
      >
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
              () => {}
            );
            setShowLogoMenu(true);
          }}
          hitSlop={10}
          testID="home-logo-menu"
        >
          <BancoLogo height={26} compact={compact} />
        </Pressable>
        <HeaderSpark />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
              () => {}
            );
            setShowSortMenu(true);
          }}
          style={[
            styles.sortBtn,
            { backgroundColor: colors.secondary, borderRadius: colors.radius },
          ]}
          hitSlop={8}
          testID="home-sort"
        >
          <Feather name="sliders" size={18} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
              () => {}
            );
            router.push("/assistant");
          }}
          style={styles.iconBtn}
          hitSlop={8}
          testID="home-ai"
        >
          <Ionicons name="sparkles" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => router.push("/notifications")}
          style={[
            styles.bellBtn,
            { backgroundColor: colors.secondary, borderRadius: colors.radius },
          ]}
          hitSlop={8}
          testID="feed-notifications"
        >
          <Feather name="bell" size={20} color={colors.foreground} />
          {isSignedIn && unreadNotifs > 0 && (
            <View
              style={[
                styles.bellBadge,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.background,
                  // Anchored to the bell's top-trailing corner (fixed chrome).
                  right: -4,
                },
              ]}
            >
              <AppText
                style={[styles.bellBadgeText, { color: colors.primaryForeground }]}
              >
                {unreadNotifs > 9 ? "9+" : unreadNotifs}
              </AppText>
            </View>
          )}
        </Pressable>
      </View>

      <CategoryTabs
        selected={category}
        onChange={handleCategoryChange}
        visible={visibleCats}
      />
      {showEngineBar ? (
        <Animated.View style={[styles.engineBar, engineBarStyle]}>
          <View
            onLayout={(e) => {
              // Measure on every content change (incl. while compact) so a
              // category switch never restores a stale height. The inner View
              // keeps its intrinsic height even when the outer animated wrapper
              // is clipped to height:0, so this stays accurate during collapse.
              const h = e.nativeEvent.layout.height;
              if (h > 0 && Math.abs(h - engineBarH) > 1) {
                setEngineBarH(h);
              }
            }}
          >
            {showIndustrialChips ? (
              <IndustrialSubChips
                types={visibleIndTypes!}
                selected={industrialType}
                onChange={setIndustrialType}
              />
            ) : (
              <EngineChips
                engines={engineList}
                selected={engineKey}
                onChange={setEngineKey}
              />
            )}
          </View>
        </Animated.View>
      ) : null}

      {loading ? (
        renderSkeletons()
      ) : error && items.length === 0 ? (
        renderError()
      ) : (
        <FlashList
          ref={listRef}
          key={`feed-cols-${numColumns}`}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={numColumns}
          contentContainerStyle={{
            paddingHorizontal: sidePad,
            paddingTop: 12,
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListHeaderComponent={ListHeader}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
        />
      )}

      <Modal
        visible={showLogoMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoMenu(false)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setShowLogoMenu(false)}
        >
          <View
            style={[
              styles.menuSheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.menuHandle} />
            <View
              style={[
                styles.menuHeader,
                isRTL && { flexDirection: "row-reverse" },
              ]}
            >
              <BancoLogo height={22} />
            </View>
            {logoMenuRows.map((row) => (
              <Pressable
                key={row.label}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setShowLogoMenu(false);
                  router.push(row.route);
                }}
                style={[
                  styles.menuRow,
                  isRTL && { flexDirection: "row-reverse" },
                ]}
                testID={`logo-menu-${row.icon}`}
              >
                <View
                  style={[
                    styles.menuIcon,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Feather name={row.icon} size={18} color={colors.foreground} />
                </View>
                <AppText
                  style={[
                    styles.menuLabel,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {row.label}
                </AppText>
                <Feather
                  name={isRTL ? "chevron-left" : "chevron-right"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showSortMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSortMenu(false)}
      >
        <Pressable
          style={styles.sortBackdrop}
          onPress={() => setShowSortMenu(false)}
        >
          <View
            style={[
              styles.sortSheet,
              {
                top: topPad + 60,
                backgroundColor: colors.card,
                borderColor: colors.border,
                [isRTL ? "left" : "right"]: 16,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <AppText
              style={[
                styles.sortHeader,
                {
                  color: colors.mutedForeground,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
            >
              {t("search.sortBy")}
            </AppText>
            {HOME_SORTS.map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => handleSort(opt.key)}
                style={[
                  styles.sortRow,
                  isRTL && { flexDirection: "row-reverse" },
                ]}
                testID={`home-sort-${opt.key}`}
              >
                <View
                  style={[
                    styles.sortIcon,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Feather name={opt.icon} size={15} color={colors.primary} />
                </View>
                <AppText
                  style={[
                    styles.sortLabel,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t(`search.sortOptions.${opt.key}`)}
                </AppText>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const HOME_SORTS: {
  key: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { key: "recommended", icon: "star" },
  { key: "newest", icon: "clock" },
  { key: "price_asc", icon: "chevron-up" },
  { key: "price_desc", icon: "chevron-down" },
  { key: "popular", icon: "trending-up" },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  homePromo: {
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  engineBar: {
    overflow: "hidden",
  },
  bridge: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
  },
  bridgeTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  bridgeSubtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 3,
  },
  bridgeBtnRow: {
    marginTop: 12,
    gap: 8,
  },
  bridgeBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  bridgeBtnOutline: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderWidth: 1,
  },
  bridgeBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  iconBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  sortBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  spark: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sortBackdrop: {
    flex: 1,
  },
  sortSheet: {
    position: "absolute",
    minWidth: 224,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  sortHeader: {
    fontSize: 11.5,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 6,
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  sortIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  sortLabel: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: "Inter_500Medium",
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  menuHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginBottom: 12,
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  bellBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    // Match the tab-bar badge: a soft lift so the count reads as a crisp pill.
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  bellBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
  },
  rail: {
    marginBottom: 20,
  },
  railHeader: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  railTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  railContent: {
    gap: 12,
  },
  feedTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 16,
  },
  retryText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
