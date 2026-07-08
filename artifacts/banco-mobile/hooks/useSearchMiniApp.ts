import { useCallback, useMemo, useRef, useState } from "react";
import { searchListings, FeedItem } from "@workspace/api-client-react";

import {
  SearchCriteria,
  DEFAULT_CRITERIA,
  buildSearchParams,
  hasActiveCriteria,
} from "@/lib/searchParams";

/** Network phase of the results surface. */
export type ResultsPhase =
  | "idle"
  | "loading" // first page, nothing on screen yet → blocking skeletons
  | "refreshing" // re-query while previous results stay visible
  | "loadingMore" // appending the next page
  | "error";

/** Derived, render-ready state of the whole surface. */
export type SearchViewState =
  | "discover" // no active criteria → discover surface
  | "loading" // blocking first-page load
  | "error" // failed first-page load (nothing to show)
  | "empty" // succeeded with zero results
  | "results"; // at least one result (incl. while refreshing/appending)

export interface UseSearchMiniApp {
  criteria: SearchCriteria;
  items: FeedItem[];
  phase: ResultsPhase;
  hasNext: boolean;
  viewState: SearchViewState;
  /** Replace the whole criteria object and re-query from page 1. */
  commit: (next: SearchCriteria) => void;
  /** Merge a partial change into the current criteria and re-query from page 1. */
  update: (partial: Partial<SearchCriteria>) => void;
  /** Merge criteria without triggering a fetch (e.g. facet normalization). */
  applyPatch: (partial: Partial<SearchCriteria>) => void;
  /** Append the next page for the current criteria. */
  loadMore: () => void;
  /** Re-run the current criteria from page 1 (after an error). */
  retry: () => void;
  /** Return to the idle Discover surface. */
  reset: () => void;
}

/**
 * Data layer for the Search mini-app. Owns the committed criteria, the result
 * list, sort-aware cursor pagination, and a monotonic request-sequence guard so
 * a slow earlier query can never overwrite a newer one (the core "live typing,
 * no flicker" guarantee). Previous results are preserved during a refresh, so
 * the list never unmounts or blanks between keystrokes.
 */
export function useSearchMiniApp(
  onCommitted?: (c: SearchCriteria) => void,
): UseSearchMiniApp {
  const [criteria, setCriteria] = useState<SearchCriteria>(DEFAULT_CRITERIA);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [phase, setPhase] = useState<ResultsPhase>("idle");
  const [hasNext, setHasNext] = useState(false);

  // Refs mirror state so runFetch stays a stable callback and never reads a
  // stale closure (critical for the pagination guard and the seq comparison).
  const itemsRef = useRef<FeedItem[]>([]);
  const hasNextRef = useRef(false);
  const phaseRef = useRef<ResultsPhase>("idle");
  const cursorRef = useRef<string | undefined>(undefined);
  const criteriaRef = useRef<SearchCriteria>(DEFAULT_CRITERIA);
  const seqRef = useRef(0);

  const setItemsT = (next: FeedItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const setPhaseT = (next: ResultsPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const setHasNextT = (next: boolean) => {
    hasNextRef.current = next;
    setHasNext(next);
  };

  const goIdle = useCallback(() => {
    seqRef.current++; // invalidate any in-flight response
    cursorRef.current = undefined;
    setItemsT([]);
    setHasNextT(false);
    setPhaseT("idle");
  }, []);

  const runFetch = useCallback(
    async (c: SearchCriteria, mode: "reset" | "more") => {
      if (!hasActiveCriteria(c)) {
        goIdle();
        return;
      }

      if (mode === "more") {
        // Guard: no next page, no cursor, or already appending.
        if (
          !hasNextRef.current ||
          !cursorRef.current ||
          phaseRef.current === "loadingMore"
        ) {
          return;
        }
      }

      const seq = ++seqRef.current;
      const appendCursor = mode === "more" ? cursorRef.current : undefined;
      if (mode === "more") {
        setPhaseT("loadingMore");
      } else {
        cursorRef.current = undefined;
        // Keep previous results on screen while refreshing; only block when the
        // surface is currently empty.
        setPhaseT(itemsRef.current.length > 0 ? "refreshing" : "loading");
      }

      try {
        const res = await searchListings(buildSearchParams(c, appendCursor));
        if (seq !== seqRef.current) return; // a newer request superseded this one
        const data = res.data ?? [];
        setItemsT(mode === "more" ? [...itemsRef.current, ...data] : data);
        cursorRef.current = res.meta?.cursor;
        setHasNextT(res.meta?.has_next ?? false);
        setPhaseT("idle");
        if (mode === "reset") onCommitted?.(c);
      } catch {
        if (seq !== seqRef.current) return;
        // A failed "load more" keeps the existing list; only a first-page
        // failure surfaces the full error state.
        setPhaseT(mode === "more" ? "idle" : "error");
      }
    },
    [goIdle, onCommitted],
  );

  const commit = useCallback(
    (next: SearchCriteria) => {
      criteriaRef.current = next;
      setCriteria(next);
      void runFetch(next, "reset");
    },
    [runFetch],
  );

  const update = useCallback(
    (partial: Partial<SearchCriteria>) => {
      const next = { ...criteriaRef.current, ...partial };
      criteriaRef.current = next;
      setCriteria(next);
      void runFetch(next, "reset");
    },
    [runFetch],
  );

  const applyPatch = useCallback((partial: Partial<SearchCriteria>) => {
    const next = { ...criteriaRef.current, ...partial };
    criteriaRef.current = next;
    setCriteria(next);
  }, []);

  const loadMore = useCallback(() => {
    void runFetch(criteriaRef.current, "more");
  }, [runFetch]);

  const retry = useCallback(() => {
    void runFetch(criteriaRef.current, "reset");
  }, [runFetch]);

  const reset = useCallback(() => {
    criteriaRef.current = DEFAULT_CRITERIA;
    setCriteria(DEFAULT_CRITERIA);
    goIdle();
  }, [goIdle]);

  const viewState = useMemo<SearchViewState>(() => {
    if (!hasActiveCriteria(criteria)) return "discover";
    if (phase === "loading") return "loading";
    if (items.length > 0) return "results";
    if (phase === "error") return "error";
    return "empty";
  }, [criteria, phase, items.length]);

  return {
    criteria,
    items,
    phase,
    hasNext,
    viewState,
    commit,
    update,
    applyPatch,
    loadMore,
    retry,
    reset,
  };
}
