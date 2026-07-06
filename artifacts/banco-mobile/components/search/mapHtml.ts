import type { FeedItem } from "@workspace/api-client-react";

/** A single price pin on the map. */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Pre-formatted, already-localized price (FeedItem.price_display). */
  label: string;
  /** Furnished/daily rental → the pin gets a 📅 "bookable" prefix. */
  bookable?: boolean;
}

/**
 * A server-clustered point for a viewport. `count > 1` renders a count bubble
 * (tap drills in); `count === 1` renders a single pin (tap selects the listing).
 * `label` is an optional, best-effort price the host attaches when the single
 * listing happens to be on the loaded page.
 */
export interface MapClusterMarker {
  lat: number;
  lng: number;
  count: number;
  listing_id: string | null;
  label?: string;
  /** Single-listing furnished/daily rental → 📅 "bookable" prefix on the pin. */
  bookable?: boolean;
}

/** Brand colors threaded into the Leaflet page so pins match the app theme. */
export interface MapTheme {
  primary: string;
  primaryForeground: string;
  card: string;
  foreground: string;
  border: string;
}

/** The visible bounding box + zoom the page reports back so the host can query. */
export interface MapViewportBounds {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}

/** Bridge message posted from the Leaflet page back to React Native / the web host. */
export type MapBridgeMessage =
  | { type: "ready" }
  | { type: "error" }
  | { type: "select"; id: string }
  | { type: "viewport"; bounds: MapViewportBounds; zoom: number };

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist";
const CLUSTER = "https://unpkg.com/leaflet.markercluster@1.5.3/dist";

/**
 * Project the feed onto map pins. Only items that carry valid coordinates are
 * mappable, so the map (and its honest "N on the map" caption) never overstates
 * how many results have a real location.
 */
export function feedItemsToMarkers(items: FeedItem[]): MapMarker[] {
  const out: MapMarker[] = [];
  for (const item of items) {
    const c = item.coordinates;
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
      out.push({
        id: item.id,
        lat: c.lat,
        lng: c.lng,
        label: item.price_display,
        bookable: item.is_bookable === true,
      });
    }
  }
  return out;
}

/**
 * Build a fully self-contained Leaflet + OpenStreetMap page. No API key and no
 * Google dependency — it works inside Expo Go's WebView (native) and in an
 * <iframe> (web).
 *
 * Two-layer design:
 *  - The embedded `markers` render instantly as price pills (the loaded page),
 *    so the map is never blank while the first viewport query is in flight.
 *  - `window.BANCO_MAP.setClusters(...)` replaces them with authoritative,
 *    viewport-wide clusters from GET /search/map. The page reports its bounds
 *    on load and after every pan/zoom via {type:"viewport"}, and the host injects
 *    fresh clusters back in — no page reload, so panning stays smooth.
 *
 * Tapping a count bubble drills in; tapping a single pin posts
 * {type:"select", id} so the host can reveal the listing card.
 */
export function buildMapHtml(markers: MapMarker[], theme: MapTheme): string {
  // JSON is safe inside a <script> except for a literal "</script>"; escaping
  // "<" to its unicode form neutralizes that without changing the parsed data.
  const json = JSON.stringify(markers).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET}/leaflet.css" />
<link rel="stylesheet" href="${CLUSTER}/MarkerCluster.css" />
<link rel="stylesheet" href="${CLUSTER}/MarkerCluster.Default.css" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; }
  body { background: ${theme.card}; }
  .leaflet-container {
    background: ${theme.card};
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
  }
  .pin .pill {
    position: absolute;
    transform: translate(-50%, -50%);
    background: ${theme.primary};
    color: ${theme.primaryForeground};
    font-weight: 700;
    font-size: 12px;
    line-height: 1;
    padding: 6px 9px;
    border-radius: 16px;
    white-space: nowrap;
    border: 1.5px solid ${theme.primaryForeground};
    box-shadow: 0 1px 5px rgba(0,0,0,0.35);
    cursor: pointer;
  }
  .cpin .cbubble {
    position: absolute;
    transform: translate(-50%, -50%);
    min-width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 7px;
    background: ${theme.primary};
    color: ${theme.primaryForeground};
    font-weight: 700;
    font-size: 13px;
    line-height: 1;
    border-radius: 999px;
    border: 2px solid ${theme.primaryForeground};
    box-shadow: 0 1px 6px rgba(0,0,0,0.4);
    cursor: pointer;
  }
  .cpin .sdot {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    background: ${theme.primary};
    border: 2.5px solid ${theme.primaryForeground};
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    cursor: pointer;
  }
  .marker-cluster-small div,
  .marker-cluster-medium div,
  .marker-cluster-large div {
    background: ${theme.primary};
    color: ${theme.primaryForeground};
    font-weight: 700;
  }
  .marker-cluster-small,
  .marker-cluster-medium,
  .marker-cluster-large { background: rgba(0,0,0,0.18); }
</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET}/leaflet.js"></script>
<script src="${CLUSTER}/leaflet.markercluster.js"></script>
<script>
  (function () {
    var DATA = ${json};
    function post(msg) {
      try {
        var s = JSON.stringify(msg);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(s);
        } else if (window.parent) {
          window.parent.postMessage(s, "*");
        }
      } catch (e) {}
    }
    function esc(t) {
      return String(t)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    if (!window.L) { post({ type: "error" }); return; }
    var map = L.map("map", { zoomControl: false, attributionControl: true })
      .setView([26.8, 30.8], 6);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    // Layer 1 — the loaded page, shown instantly so the map is never blank.
    var group = L.markerClusterGroup
      ? L.markerClusterGroup({ maxClusterRadius: 48, showCoverageOnHover: false, spiderfyOnMaxZoom: true })
      : L.layerGroup();
    var pts = [];
    DATA.forEach(function (d) {
      if (typeof d.lat !== "number" || typeof d.lng !== "number") return;
      var icon = L.divIcon({
        className: "pin",
        html: '<div class="pill">' + (d.bookable ? "📅 " : "") + esc(d.label) + "</div>",
        iconSize: [0, 0]
      });
      var m = L.marker([d.lat, d.lng], { icon: icon });
      m.on("click", (function (id) {
        return function () { post({ type: "select", id: id }); };
      })(d.id));
      group.addLayer(m);
      pts.push([d.lat, d.lng]);
    });
    map.addLayer(group);

    // Layer 2 — authoritative, viewport-wide server clusters. Once the host
    // injects the first response the loaded-page layer is removed so counts and
    // pins reflect the WHOLE visible area, not just the current result page.
    var serverLayer = L.layerGroup();
    var initialShown = true;
    window.BANCO_MAP = {
      setClusters: function (clusters) {
        if (initialShown) { map.removeLayer(group); initialShown = false; }
        serverLayer.clearLayers();
        if (!map.hasLayer(serverLayer)) map.addLayer(serverLayer);
        (clusters || []).forEach(function (c) {
          if (typeof c.lat !== "number" || typeof c.lng !== "number") return;
          var marker;
          if (c.count > 1) {
            marker = L.marker([c.lat, c.lng], {
              icon: L.divIcon({
                className: "cpin",
                html: '<div class="cbubble">' + (c.count > 99 ? "99+" : c.count) + "</div>",
                iconSize: [0, 0]
              })
            });
            (function (lat, lng) {
              marker.on("click", function () {
                map.setView([lat, lng], Math.min(map.getZoom() + 2, 16));
              });
            })(c.lat, c.lng);
          } else {
            var inner = c.label
              ? '<div class="pill">' + (c.bookable ? "📅 " : "") + esc(c.label) + "</div>"
              : '<div class="sdot"></div>';
            marker = L.marker([c.lat, c.lng], {
              icon: L.divIcon({
                className: c.label ? "pin" : "cpin",
                html: inner,
                iconSize: [0, 0]
              })
            });
            (function (id) {
              marker.on("click", function () { if (id) post({ type: "select", id: id }); });
            })(c.listing_id);
          }
          serverLayer.addLayer(marker);
        });
      }
    };

    // Report the visible bounds so the host can query /search/map for it.
    var vpTimer = null;
    function postViewport() {
      var b = map.getBounds();
      post({
        type: "viewport",
        bounds: {
          min_lat: b.getSouth(),
          max_lat: b.getNorth(),
          min_lng: b.getWest(),
          max_lng: b.getEast()
        },
        zoom: map.getZoom()
      });
    }
    map.on("moveend", function () {
      if (vpTimer) clearTimeout(vpTimer);
      vpTimer = setTimeout(postViewport, 300);
    });

    // Frame the loaded page, then hand off to server clustering for the viewport.
    if (pts.length === 1) {
      map.setView(pts[0], 13);
    } else if (pts.length > 1) {
      map.fitBounds(pts, { padding: [48, 48], maxZoom: 15 });
    }
    post({ type: "ready" });
    postViewport();
  })();
</script>
</body>
</html>`;
}
