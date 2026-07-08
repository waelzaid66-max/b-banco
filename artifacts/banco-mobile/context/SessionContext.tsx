import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/expo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FeedItem,
  getListing,
  getSavedListings,
  toggleSaveListing,
} from "@workspace/api-client-react";

import { useAuthGate } from "@/hooks/useAuthGate";

const SESSION_ID =
  Date.now().toString() + Math.random().toString(36).substr(2, 9);
const SAVES_KEY = "banco_saved_v1";
const SEARCHES_KEY = "banco_saved_searches_v1";
const RECENT_KEY = "banco_recently_viewed_v1";
const RECENT_QUERIES_KEY = "banco_recent_queries_v1";
const RECENT_QUERIES_MAX = 8;
const RECENT_MAX = 20;
const STORAGE_DEBOUNCE_MS = 400;

export type SavedItem = FeedItem & { savedAt: number };

export type ListingDetailData = NonNullable<
  Awaited<ReturnType<typeof getListing>>["data"]
>;

function feedItemFromDetail(d: ListingDetailData): FeedItem {
  return {
    id: d.id,
    media_preview: d.media?.[0]?.url ?? "",
    price_display: d.price_display,
    installment_badge: d.payment?.badge ?? null,
    title: d.title,
    location: d.location,
    urgency_signal: null,
    trust_signal: d.seller?.is_verified ? "Verified" : d.seller?.name ?? "",
    smart_badge: null,
    has_video: (d.media ?? []).some((m) => m.type === "video"),
    is_sponsored: false,
  };
}

function detailToFeedItem(d: ListingDetailData): SavedItem {
  return { ...feedItemFromDetail(d), savedAt: Date.now() };
}

export type SavedSearch = {
  id: string;
  q: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  location: string;
  paymentType: "any" | "installment";
  savedAt: number;
};

type SavedSearchInput = Omit<SavedSearch, "id" | "savedAt">;

function searchSignature(s: SavedSearchInput): string {
  return [
    s.q.trim().toLowerCase(),
    s.category,
    s.minPrice,
    s.maxPrice,
    s.location.trim().toLowerCase(),
    s.paymentType,
  ].join("|");
}

interface SessionContextValue {
  sessionId: string;
  savedItems: SavedItem[];
  isSaved: (id: string) => boolean;
  toggleSave: (item: FeedItem) => void;
  savedSearches: SavedSearch[];
  isSearchSaved: (input: SavedSearchInput) => boolean;
  saveSearch: (input: SavedSearchInput) => void;
  removeSearch: (id: string) => void;
  recentlyViewed: FeedItem[];
  recordView: (detail: ListingDetailData) => void;
  /** Last few committed text searches (newest first) — powers the "بحثت مؤخراً" chips. */
  recentQueries: string[];
  /** Record a committed text search (deduped, capped, persisted locally). */
  recordQuery: (query: string) => void;
  /**
   * Cache-first lookup of a FeedItem already known to this session (saved or
   * recently viewed). Lets the listing detail screen paint the above-fold
   * preview instantly while the full record is fetched in the background.
   */
  getCachedItem: (id: string) => FeedItem | null;
  /**
   * Seed the cache-first lookup with a FeedItem the user is about to open from a
   * feed/rail/search/storefront list. Call this synchronously on card press,
   * just before navigating, so the detail screen can paint from list data.
   */
  cacheFeedItem: (item: FeedItem) => void;
  /**
   * Monotonic counter bumped whenever the caller publishes (or mutates) one of
   * their own listings. Persistent surfaces that cache listings — the home feed
   * (manual state) and the profile grid (react-query) — watch this and refetch
   * when it changes, so a freshly published listing appears without a manual
   * pull-to-refresh. Pushed screens (e.g. "my listings") already reload on mount
   * and search refetches per query, so they don't need to watch it.
   */
  listingsVersion: number;
  /** Signal that the caller's listings changed; triggers the refetch above. */
  bumpListings: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { requireAuth } = useAuthGate();
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<FeedItem[]>([]);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  // Bumped on publish so the home feed + profile grid refetch (see type docs).
  const [listingsVersion, setListingsVersion] = useState(0);
  const bumpListings = useCallback(() => setListingsVersion((v) => v + 1), []);

  // Mirror of savedItems for use inside async callbacks without stale closures.
  const savedItemsRef = useRef<SavedItem[]>([]);
  useEffect(() => {
    savedItemsRef.current = savedItems;
  }, [savedItems]);

  // Short-lived, in-memory cache of FeedItems the user has actually seen in a
  // feed/rail/search/storefront list. Seeded synchronously right before opening
  // a detail screen so the detail page can paint cache-first from the SAME data
  // the list was rendering. Ref-backed: it must not trigger re-renders, and the
  // read always reflects the latest write made just before navigation.
  const feedCacheRef = useRef<Map<string, FeedItem>>(new Map());
  const FEED_CACHE_MAX = 60;

  const cacheFeedItem = useCallback((item: FeedItem) => {
    const cache = feedCacheRef.current;
    cache.delete(item.id);
    cache.set(item.id, item);
    if (cache.size > FEED_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }, []);

  const storageTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const scheduleStorageWrite = useCallback((key: string, json: string) => {
    const timers = storageTimersRef.current;
    const prev = timers.get(key);
    if (prev) clearTimeout(prev);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        AsyncStorage.setItem(key, json).catch(() => {});
      }, STORAGE_DEBOUNCE_MS),
    );
  }, []);

  useEffect(
    () => () => {
      for (const timer of storageTimersRef.current.values()) {
        clearTimeout(timer);
      }
      storageTimersRef.current.clear();
    },
    [],
  );

  const persistSaves = useCallback(
    (items: SavedItem[]) => {
      scheduleStorageWrite(SAVES_KEY, JSON.stringify(items));
    },
    [scheduleStorageWrite],
  );

  // Initial load from the local cache (instant, works offline / for guests).
  useEffect(() => {
    AsyncStorage.getItem(SAVES_KEY)
      .then((raw) => {
        if (raw) setSavedItems(JSON.parse(raw) as SavedItem[]);
      })
      .catch(() => {});
    AsyncStorage.getItem(SEARCHES_KEY)
      .then((raw) => {
        if (raw) setSavedSearches(JSON.parse(raw) as SavedSearch[]);
      })
      .catch(() => {});
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (raw) setRecentlyViewed(JSON.parse(raw) as FeedItem[]);
      })
      .catch(() => {});
    AsyncStorage.getItem(RECENT_QUERIES_KEY)
      .then((raw) => {
        if (raw) setRecentQueries(JSON.parse(raw) as string[]);
      })
      .catch(() => {});
  }, []);

  // Committed text searches, newest first. Deduped case-insensitively so
  // re-searching "BMW" just moves it to the front instead of duplicating it.
  const recordQuery = useCallback((query: string) => {
    const q = query.trim();
    if (q.length < 2) return;
    setRecentQueries((prev) => {
      const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(
        0,
        RECENT_QUERIES_MAX,
      );
      scheduleStorageWrite(RECENT_QUERIES_KEY, JSON.stringify(next));
      return next;
    });
  }, [scheduleStorageWrite]);

  // When signed in, reconcile the local cache with the server-side saves.
  // Union semantics: push local-only saves up, pull (and enrich) server-only
  // saves down. Never silently drop a save.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;

    (async () => {
      let serverIds: string[];
      try {
        const res = await getSavedListings();
        serverIds = res.data ?? [];
      } catch {
        return; // best-effort — keep the local cache as-is
      }
      if (cancelled) return;

      const current = savedItemsRef.current;
      const currentIds = new Set(current.map((i) => i.id));
      const serverSet = new Set(serverIds);

      // 1) Local-only saves (made while signed out) → persist them server-side.
      for (const item of current) {
        if (!serverSet.has(item.id)) {
          toggleSaveListing({ listing_id: item.id }).catch(() => {});
        }
      }

      // 2) Server-only saves (made on another device) → fetch & map for display.
      const missingIds = serverIds.filter((id) => !currentIds.has(id));
      const enriched: SavedItem[] = [];
      await Promise.all(
        missingIds.map(async (sid) => {
          try {
            const res = await getListing(sid);
            if (res.data) enriched.push(detailToFeedItem(res.data));
          } catch {
            // skip listings that can no longer be fetched
          }
        })
      );
      if (cancelled || enriched.length === 0) return;

      // 3) Merge (dedupe by id) and persist.
      setSavedItems((prev) => {
        const map = new Map<string, SavedItem>();
        for (const i of prev) map.set(i.id, i);
        for (const i of enriched) if (!map.has(i.id)) map.set(i.id, i);
        const next = Array.from(map.values());
        persistSaves(next);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, persistSaves]);

  const isSaved = useCallback(
    (id: string) => savedItems.some((i) => i.id === id),
    [savedItems]
  );

  const toggleSave = useCallback(
    (item: FeedItem) => {
      // Task #101: guests are funneled into creating an account on every
      // meaningful action — no silent local-only save. requireAuth() opens the
      // marketing modal and the save is skipped until the user signs in.
      if (!isSignedIn) {
        requireAuth();
        return;
      }

      const wasSaved = savedItemsRef.current.some((i) => i.id === item.id);

      // Optimistic local update (instant + offline-friendly for signed-in users).
      setSavedItems((prev) => {
        const next = wasSaved
          ? prev.filter((i) => i.id !== item.id)
          : [...prev, { ...item, savedAt: Date.now() }];
        persistSaves(next);
        return next;
      });

      // Persist to the backend; revert on failure.
      toggleSaveListing({ listing_id: item.id }).catch(() => {
        setSavedItems((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          let next = prev;
          if (!wasSaved && exists) {
            next = prev.filter((i) => i.id !== item.id);
          } else if (wasSaved && !exists) {
            next = [...prev, { ...item, savedAt: Date.now() }];
          }
          persistSaves(next);
          return next;
        });
      });
    },
    [isSignedIn, persistSaves, requireAuth]
  );

  const isSearchSaved = useCallback(
    (input: SavedSearchInput) => {
      const sig = searchSignature(input);
      return savedSearches.some((s) => s.id === sig);
    },
    [savedSearches]
  );

  const saveSearch = useCallback(
    (input: SavedSearchInput) => {
      // Task #101: saving a search is a meaningful action — funnel guests into
      // sign-up (marketing modal) rather than persisting a guest-only local
      // search, exactly like toggleSave gates the listing heart.
      if (!isSignedIn) {
        requireAuth();
        return;
      }
      const id = searchSignature(input);
      setSavedSearches((prev) => {
        if (prev.some((s) => s.id === id)) return prev;
        const next = [...prev, { ...input, id, savedAt: Date.now() }];
        scheduleStorageWrite(SEARCHES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [isSignedIn, requireAuth, scheduleStorageWrite],
  );

  const removeSearch = useCallback((id: string) => {
    setSavedSearches((prev) => {
      const next = prev.filter((s) => s.id !== id);
      scheduleStorageWrite(SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }, [scheduleStorageWrite]);

  const recordView = useCallback((detail: ListingDetailData) => {
    const item = feedItemFromDetail(detail);
    setRecentlyViewed((prev) => {
      const next = [item, ...prev.filter((i) => i.id !== item.id)].slice(
        0,
        RECENT_MAX
      );
      scheduleStorageWrite(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, [scheduleStorageWrite]);

  const getCachedItem = useCallback(
    (id: string): FeedItem | null =>
      feedCacheRef.current.get(id) ??
      recentlyViewed.find((i) => i.id === id) ??
      savedItems.find((i) => i.id === id) ??
      null,
    [recentlyViewed, savedItems]
  );

  const contextValue = useMemo(
    () => ({
      sessionId: SESSION_ID,
      savedItems,
      isSaved,
      toggleSave,
      savedSearches,
      isSearchSaved,
      saveSearch,
      removeSearch,
      recentlyViewed,
      recordView,
      recentQueries,
      recordQuery,
      getCachedItem,
      cacheFeedItem,
      listingsVersion,
      bumpListings,
    }),
    [
      savedItems,
      isSaved,
      toggleSave,
      savedSearches,
      isSearchSaved,
      saveSearch,
      removeSearch,
      recentlyViewed,
      recordView,
      recentQueries,
      recordQuery,
      getCachedItem,
      cacheFeedItem,
      listingsVersion,
      bumpListings,
    ],
  );

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
