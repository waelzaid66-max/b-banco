import { FeedItem, getMapClusters } from "@workspace/api-client-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import { useColors } from "@/hooks/useColors";
import {
  buildMapClusterParams,
  type MapViewport,
  type SearchCriteria,
} from "@/lib/searchParams";
import {
  buildMapHtml,
  feedItemsToMarkers,
  type MapBridgeMessage,
  type MapClusterMarker,
} from "./mapHtml";
import { MapOverlayChrome } from "./MapOverlayChrome";

export interface SearchResultsMapProps {
  /** The loaded result page (callers filter to items with coordinates). */
  items: FeedItem[];
  /** Committed search criteria — the map queries the SAME filter set as the list. */
  criteria: SearchCriteria;
  onOpenListing: (item: FeedItem) => void;
  /** Open a listing that isn't on the loaded page (an off-page single pin). */
  onOpenListingId?: (id: string) => void;
  onSave?: (item: FeedItem) => void;
  isSaved: (id: string) => boolean;
}

/**
 * Native map surface: a self-contained Leaflet/OpenStreetMap page rendered in a
 * WebView (Expo Go friendly, no native map module, no API key). The loaded page
 * renders instantly as price pins; then the map reports its viewport and we query
 * GET /search/map for authoritative, viewport-wide clusters (respecting the exact
 * search filters) and inject them back in — no reload, so panning stays smooth.
 * Tapping a single pin selects it; MapOverlayChrome shows the listing preview.
 */
export function SearchResultsMap({
  items,
  criteria,
  onOpenListing,
  onOpenListingId,
  onSave,
  isSaved,
}: SearchResultsMapProps) {
  const colors = useColors();
  const webRef = useRef<WebView>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Total in the visible viewport per the last server response (honest count);
  // null until the first response, when we fall back to the loaded-page count.
  const [serverTotal, setServerTotal] = useState<number | null>(null);

  const markers = useMemo(() => feedItemsToMarkers(items), [items]);
  const sig = useMemo(
    () => markers.map((m) => `${m.id}:${m.lat}:${m.lng}:${m.label}`).join("|"),
    [markers],
  );
  // Value signature of the committed filters, so a filter change is detectable
  // even when the object identity churns on every parent render.
  const criteriaSig = useMemo(() => JSON.stringify(criteria), [criteria]);
  const html = useMemo(
    () =>
      buildMapHtml(markers, {
        primary: colors.primary,
        primaryForeground: colors.primaryForeground,
        card: colors.card,
        foreground: colors.foreground,
        border: colors.border,
      }),
    // Rebuild only when the plotted set or the themed colors change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, colors.primary, colors.primaryForeground, colors.card, colors.foreground, colors.border],
  );

  // Latest items, read inside the message handler without re-subscribing.
  const itemsRef = useRef<FeedItem[]>(items);
  itemsRef.current = items;
  // Monotonic guard: a slow cluster response can never overwrite a newer viewport.
  const vpSeqRef = useRef(0);
  // The last viewport the map reported, so a pure criteria change (same mapped
  // set → no WebView reload) can re-query clusters for the current view.
  const lastViewportRef = useRef<MapViewport | null>(null);
  // Previous mapped-set signature, to tell a pure filter change (map not reloaded)
  // apart from a result change (WebView re-keyed, which re-posts its viewport).
  const prevSigRef = useRef(sig);

  // The WebView is keyed by `sig`, so a changed mapped-set reloads it — but this
  // component does not remount, so reset load/selection/count ourselves and
  // invalidate any in-flight cluster fetch from the previous page.
  useEffect(() => {
    setReady(false);
    setSelectedId(null);
    setServerTotal(null);
    vpSeqRef.current++;
  }, [sig]);

  const fetchClusters = useCallback(
    async (viewport: MapViewport) => {
      const seq = ++vpSeqRef.current;
      try {
        const res = await getMapClusters(buildMapClusterParams(criteria, viewport));
        if (seq !== vpSeqRef.current) return;
        const clusters = res.data ?? [];
        // Enrich single-listing pins with a price label when the listing is on
        // the loaded page (best-effort; off-page singles fall back to a dot).
        const priceById = new Map(
          itemsRef.current.map((i) => [i.id, i.price_display]),
        );
        const bookableById = new Set(
          itemsRef.current.filter((i) => i.is_bookable === true).map((i) => i.id),
        );
        const enriched: MapClusterMarker[] = clusters.map((c) => ({
          lat: c.lat,
          lng: c.lng,
          count: c.count,
          listing_id: c.listing_id,
          label:
            c.count === 1 && c.listing_id ? priceById.get(c.listing_id) : undefined,
          bookable:
            c.count === 1 && c.listing_id ? bookableById.has(c.listing_id) : false,
        }));
        setServerTotal(clusters.reduce((sum, c) => sum + c.count, 0));
        webRef.current?.injectJavaScript(
          `window.BANCO_MAP && window.BANCO_MAP.setClusters(${JSON.stringify(
            enriched,
          )}); true;`,
        );
      } catch {
        // Leave the current markers in place; the map degrades to the loaded page.
      }
    },
    [criteria],
  );

  // A pure filter change (values differ but the mapped set is byte-identical, so
  // the sig-keyed WebView is NOT reloaded) must still refresh clusters/count. When
  // the mapped set also changed, the reload re-posts the viewport on ready, so we
  // skip here to avoid a duplicate /search/map request.
  useEffect(() => {
    const sigChanged = prevSigRef.current !== sig;
    prevSigRef.current = sig;
    if (sigChanged) return;
    if (lastViewportRef.current) {
      setServerTotal(null);
      void fetchClusters(lastViewportRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, criteriaSig]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data) as MapBridgeMessage;
        if (msg.type === "ready" || msg.type === "error") {
          setReady(true);
        } else if (msg.type === "viewport") {
          const vp = { ...msg.bounds, zoom: msg.zoom };
          lastViewportRef.current = vp;
          void fetchClusters(vp);
        } else if (msg.type === "select" && typeof msg.id === "string") {
          const hit = itemsRef.current.find((i) => i.id === msg.id);
          if (hit) setSelectedId(msg.id);
          else onOpenListingId?.(msg.id);
        }
      } catch {
        // Ignore malformed bridge messages.
      }
    },
    [fetchClusters, onOpenListingId],
  );

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]}>
      <WebView
        ref={webRef}
        key={sig}
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        style={styles.web}
      />

      {!ready ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      <MapOverlayChrome
        count={serverTotal ?? markers.length}
        selected={selected}
        onClose={() => setSelectedId(null)}
        onOpenListing={onOpenListing}
        onSave={onSave}
        isSaved={isSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: "transparent" },
  center: { alignItems: "center", justifyContent: "center" },
});
