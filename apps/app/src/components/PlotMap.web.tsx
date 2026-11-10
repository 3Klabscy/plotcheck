import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PolygonGeometry } from "@plotcheck/core";
import type { MapLayerDef } from "../lib/api";
import { pathLengthM, ringAreaM2 } from "../lib/geo";
import type { PlotMapHandle, PlotMapProps } from "./PlotMap.types";
import { colors } from "../theme";

const STREETS = {
  // OSM standard tiles: fine for a prototype, NOT for production traffic (OSMF tile usage policy).
  // Phase 3: switch to a hosted vector tile provider.
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
};

const fc = (features: { geometry: PolygonGeometry; id?: string }[]) => ({
  type: "FeatureCollection" as const,
  features: features.map((f) => ({ type: "Feature" as const, properties: { id: f.id ?? "" }, geometry: f.geometry })),
});

function wmsTiles(url: string, layers: string) {
  return `${url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(layers)}&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=512&HEIGHT=512&BBOX={bbox-epsg-3857}`;
}

function arcgisTiles(url: string, layers?: string) {
  return `${url}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&f=image${layers ? `&layers=${encodeURIComponent(layers)}` : ""}`;
}

function sourceFor(l: Exclude<MapLayerDef, { kind: "contours" }>): StyleSpecification["sources"][string] {
  const common = { type: "raster" as const, minzoom: l.minzoom ?? 0, ...(l.maxzoom ? { maxzoom: l.maxzoom } : {}) };
  if (l.kind === "xyz") return { ...common, tiles: [l.url], tileSize: 256 };
  if (l.kind === "wms") return { ...common, tiles: [wmsTiles(l.url, l.layers)], tileSize: 512 };
  return { ...common, tiles: [arcgisTiles(l.url, l.layers)], tileSize: 512 };
}

const PURPLE = "#7B2FF7";
type Pt = [number, number];
const segLen = (a: Pt, b: Pt) => pathLengthM([a, b], false);

/** The measurement drawn on the map: line or polygon, numbered vertices and a label on every segment. */
function measureFc(pts: Pt[], tool: string, fmtLen: (m: number) => string, fmtArea: (m2: number) => string) {
  const area = tool === "area";
  const feats: GeoJSON.Feature[] = [];
  if (pts.length >= 2 && tool !== "point")
    feats.push({ type: "Feature", properties: {}, geometry: area && pts.length >= 3 ? { type: "Polygon", coordinates: [[...pts, pts[0]!]] } : { type: "LineString", coordinates: pts } });
  pts.forEach((c, i) => feats.push({ type: "Feature", properties: { kind: "vertex", i }, geometry: { type: "Point", coordinates: c } }));
  if (tool !== "point") {
    const segs: [Pt, Pt][] = pts.slice(1).map((c, i) => [pts[i]!, c]);
    if (area && pts.length >= 3) segs.push([pts[pts.length - 1]!, pts[0]!]);
    for (const [a, b] of segs)
      feats.push({ type: "Feature", properties: { kind: "label", text: fmtLen(segLen(a, b)) }, geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] } });
    if (area && pts.length >= 3) {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      feats.push({ type: "Feature", properties: { kind: "total", text: fmtArea(ringAreaM2(pts)) }, geometry: { type: "Point", coordinates: [cx, cy] } });
    } else if (pts.length >= 3)
      feats.push({ type: "Feature", properties: { kind: "total", text: `Σ ${fmtLen(pathLengthM(pts, false))}` }, geometry: { type: "Point", coordinates: pts[pts.length - 1]! } });
  }
  return { type: "FeatureCollection" as const, features: feats };
}

function bounds(g: PolygonGeometry): [[number, number], [number, number]] {
  const pts = (g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2)) as number[][];
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

export const PlotMap = forwardRef<PlotMapHandle, PlotMapProps>(function PlotMap(props, ref) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const loaded = useRef(false);
  const marker = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    flyTo: (p, zoom = 18) => map.current?.flyTo({ center: [p.lng, p.lat], zoom, speed: 1.6 }),
    fitBounds: (b) => map.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 18, duration: 600 }),
    zoomIn: () => map.current?.zoomIn({ duration: 250 }),
    zoomOut: () => map.current?.zoomOut({ duration: 250 }),
    undoMeasure: () => {
      measurePts.current = measurePts.current.slice(0, -1);
      drawMeasure();
    },
    view: () => {
      const m = map.current;
      if (!m) return undefined;
      const c = m.getCenter();
      return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
    },
  }));
  const measurePts = useRef<Pt[]>([]);
  const dragging = useRef<number | null>(null);
  const justDragged = useRef(false);
  // phones send mouse events after a tap: no cursor readout or live line for those
  const lastTouch = useRef(0);
  const touchRecently = () => Date.now() - lastTouch.current < 1500;
  const cursorBox = useRef<HTMLDivElement | null>(null);

  // create once
  useEffect(() => {
    if (!el.current) return;
    const sources: StyleSpecification["sources"] = {
      streets: { type: "raster", tiles: [STREETS.url], tileSize: 256, attribution: STREETS.attribution, maxzoom: 19 },
    };
    for (const l of props.layers)
      sources[l.id] = l.kind === "contours"
        ? { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: props.attribution(l.attributionKey) }
        : ({ ...sourceFor(l), attribution: props.attribution(l.attributionKey, l.date) } as StyleSpecification["sources"][string]);
    const style: StyleSpecification = {
      version: 8,
      sources,
      layers: [
        { id: "blank", type: "background", paint: { "background-color": "#F4F3EE" } },
        { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } },
        // basemaps first, then overlays in catalogue order
        ...[...props.layers.filter((l) => l.role === "basemap"), ...props.layers.filter((l) => l.role === "overlay" && l.kind !== "contours")].map((l) => ({
          id: l.id,
          type: "raster" as const,
          source: l.id,
          minzoom: l.minzoom ?? 0,
          paint: { "raster-opacity": l.opacity ?? 1, "raster-fade-duration": 150 },
          layout: { visibility: "none" as "none" | "visible" },
        })),
        ...props.layers.filter((l) => l.kind === "contours").flatMap((l) => [
          { id: l.id, type: "line" as const, source: l.id, minzoom: l.minzoom ?? 0, layout: { visibility: "none" as const },
            paint: { "line-color": "#C65D00", "line-opacity": 0.85, "line-width": ["case", ["get", "major"], 1.6, 0.7] as unknown as number } },
          { id: `${l.id}-labels`, type: "symbol" as const, source: l.id, minzoom: (l.minzoom ?? 0) + 1, filter: ["==", ["get", "major"], true] as never,
            layout: { visibility: "none" as const, "symbol-placement": "line" as const, "text-field": ["concat", ["to-string", ["get", "elevation"]], " m"] as never, "text-size": 11, "text-font": ["Noto Sans Regular"] },
            paint: { "text-color": "#7A3A00", "text-halo-color": "#FFFFFF", "text-halo-width": 1.5 } },
        ]),
      ],
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    };
    const m = new maplibregl.Map({
      container: el.current,
      style,
      center: [props.initialView.center.lng, props.initialView.center.lat],
      zoom: props.initialView.zoom,
      maxZoom: 20,
      attributionControl: { compact: true },
    });
    // zoom buttons are the app's own big floating buttons (MapFabs); pinch and double-tap still zoom
    m.on("load", () => {
      m.addSource("neighbours", { type: "geojson", data: fc([]) });
      m.addSource("selected", { type: "geojson", data: fc([]) });
      m.addSource("footprint", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "neighbours-fill", type: "fill", source: "neighbours", paint: { "fill-color": colors.neighbour, "fill-opacity": 0.15 } });
      m.addLayer({ id: "neighbours-line", type: "line", source: "neighbours", paint: { "line-color": colors.neighbour, "line-width": 2, "line-dasharray": [2, 2] } });
      m.addLayer({ id: "selected-fill", type: "fill", source: "selected", paint: { "fill-color": colors.plot, "fill-opacity": 0.18 } });
      m.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": colors.plot, "line-width": 3 } });
      m.addLayer({ id: "footprint-fill", type: "fill", source: "footprint", paint: { "fill-color": colors.footprint, "fill-opacity": 0.45 } });
      m.addLayer({ id: "footprint-line", type: "line", source: "footprint", paint: { "line-color": colors.footprint, "line-width": 2 } });
      m.addSource("user", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "user-fill", type: "fill", source: "user", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#0284C7", "fill-opacity": 0.12 } });
      m.addLayer({ id: "user-line", type: "line", source: "user", filter: ["!=", "$type", "Point"], paint: { "line-color": "#0284C7", "line-width": 2.2 } });
      m.addLayer({ id: "user-pts", type: "circle", source: "user", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#0284C7", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      m.addSource("measure", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("measure-live", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "measure-fill", type: "fill", source: "measure", filter: ["==", "$type", "Polygon"], paint: { "fill-color": PURPLE, "fill-opacity": 0.15 } });
      m.addLayer({ id: "measure-line", type: "line", source: "measure", filter: ["!=", "$type", "Point"], paint: { "line-color": PURPLE, "line-width": 3 } });
      m.addLayer({ id: "measure-live-line", type: "line", source: "measure-live", filter: ["==", "$type", "LineString"], paint: { "line-color": PURPLE, "line-width": 2, "line-dasharray": [2, 2] } });
      m.addLayer({ id: "measure-pts", type: "circle", source: "measure", filter: ["==", ["get", "kind"], "vertex"], paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": PURPLE, "circle-stroke-width": 3 } });
      const label = (id: string, source: string, kind: string, size: number) =>
        m.addLayer({ id, type: "symbol", source, filter: ["==", ["get", "kind"], kind],
          layout: { "text-field": ["get", "text"], "text-size": size, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true, "text-ignore-placement": true, "text-offset": [0, kind === "total" ? 0 : -0.9] },
          paint: { "text-color": kind === "total" ? "#fff" : PURPLE, "text-halo-color": kind === "total" ? PURPLE : "#fff", "text-halo-width": kind === "total" ? 3 : 2 } });
      label("measure-labels", "measure", "label", 13);
      label("measure-total", "measure", "total", 15);
      label("measure-live-label", "measure-live", "label", 13);
      loaded.current = true;
      sync();
    });
    const reportView = () => {
      const c = m.getCenter();
      const bb = m.getBounds();
      latest.current.onMove?.({ lng: c.lng, lat: c.lat, zoom: m.getZoom(), bbox: [bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()] });
    };
    m.once("load", () => {
      reportView();
    });
    // start with the credits folded behind the (i) button (MapLibre opens them while loading); they open on tap
    m.once("idle", () => el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    m.on("moveend", () => {
      reportView();
      refreshContours();
    });
    m.on("click", (e) => {
      const tool = latest.current.measure;
      if (tool !== "none") {
        if (justDragged.current) { justDragged.current = false; return; }
        const pt: Pt = [e.lngLat.lng, e.lngLat.lat];
        measurePts.current = tool === "point" ? [pt] : [...measurePts.current, pt];
        drawMeasure();
        return;
      }
      const hit = m.queryRenderedFeatures(e.point, { layers: ["neighbours-fill"] })[0];
      const id = hit?.properties?.["id"] as string | undefined;
      if (id && latest.current.onSelectNeighbour) latest.current.onSelectNeighbour(id);
      else latest.current.onTap({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    // drag a measured point to move it (mouse and touch)
    // a finger is not precise: grab a measured point within ~24 px of the touch (10 px for a mouse)
    const startDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (latest.current.measure === "none" || measurePts.current.length === 0) return;
      const touch = "points" in e;
      if (touch && (e.originalEvent as TouchEvent).touches.length > 1) return; // pinch zoom
      const r = touch ? 24 : 10;
      // nearest measured point on screen (projected directly: does not wait for the map to redraw)
      let best = -1, bestD = r * r;
      measurePts.current.forEach((c, i) => {
        const q = m.project(c);
        const d = (q.x - e.point.x) ** 2 + (q.y - e.point.y) ** 2;
        if (d <= bestD) { bestD = d; best = i; }
      });
      if (best < 0) return;
      e.preventDefault();
      dragging.current = best;
      m.dragPan.disable();
      m.getCanvas().style.cursor = "grabbing";
    };
    const moveDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const i = dragging.current;
      if (i === null) return;
      measurePts.current = measurePts.current.map((c, k) => (k === i ? [e.lngLat.lng, e.lngLat.lat] : c));
      drawMeasure();
    };
    const endDrag = () => {
      if (dragging.current === null) return;
      dragging.current = null;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 350);
      m.dragPan.enable();
      m.getCanvas().style.cursor = "crosshair";
    };
    el.current.addEventListener("touchstart", () => (lastTouch.current = Date.now()), { capture: true, passive: true });
    m.on("mousedown", startDrag);
    m.on("touchstart", startDrag);
    m.on("mousemove", moveDrag);
    m.on("touchmove", moveDrag);
    m.on("mouseup", endDrag);
    m.on("touchend", endDrag);
    m.on("mouseenter", "measure-pts", () => { if (latest.current.measure !== "none") m.getCanvas().style.cursor = "grab"; });
    m.on("mouseleave", "measure-pts", () => { if (latest.current.measure !== "none" && dragging.current === null) m.getCanvas().style.cursor = "crosshair"; });
    // live line from the last point to the cursor
    m.on("mousemove", (e) => {
      const p = latest.current, pts = measurePts.current, src = m.getSource("measure-live") as GeoJSONSource | undefined;
      if (!src) return;
      if (touchRecently() || p.measure === "none" || p.measure === "point" || pts.length === 0 || dragging.current !== null) return src.setData({ type: "FeatureCollection", features: [] });
      const last = pts[pts.length - 1]!, cur: Pt = [e.lngLat.lng, e.lngLat.lat];
      const fmtLen = p.fmtLength ?? ((x: number) => `${x.toFixed(1)} m`);
      src.setData({ type: "FeatureCollection", features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [last, cur] } },
        { type: "Feature", properties: { kind: "label", text: fmtLen(segLen(last, cur)) }, geometry: { type: "Point", coordinates: [(last[0] + cur[0]) / 2, (last[1] + cur[1]) / 2] } },
      ] });
    });
    m.on("mouseout", () => (m.getSource("measure-live") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] }));
    m.on("mousemove", (e) => {
      const fmt = latest.current.formatCursor, box = cursorBox.current;
      if (!box) return;
      if (!fmt || touchRecently()) { box.style.display = "none"; return; }
      box.style.display = "block";
      box.textContent = fmt(e.lngLat.lng, e.lngLat.lat);
    });
    m.on("mouseout", () => { if (cursorBox.current) cursorBox.current.style.display = "none"; });
    m.on("mouseenter", "neighbours-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "neighbours-fill", () => (m.getCanvas().style.cursor = ""));
    map.current = m;
    return () => {
      loaded.current = false;
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const p = latest.current;
    (m.getSource("selected") as GeoJSONSource).setData(fc(p.selected ? [{ geometry: p.selected }] : []));
    (m.getSource("neighbours") as GeoJSONSource).setData(fc(p.neighbours ?? []));
    (m.getSource("footprint") as GeoJSONSource).setData(fc(p.footprint ? [{ geometry: p.footprint }] : []));
    (m.getSource("user") as GeoJSONSource).setData((p.drawings ?? { type: "FeatureCollection", features: [] }) as never);
    const base = p.basemap;
    m.setLayoutProperty("streets", "visibility", base === "streets" ? "visible" : "none");
    for (const l of p.layers) {
      if (!m.getLayer(l.id)) continue;
      const on = l.role === "basemap" ? l.id === base : p.overlays.includes(l.id);
      m.setLayoutProperty(l.id, "visibility", on ? "visible" : "none");
    }
    m.getCanvas().style.cursor = p.measure !== "none" ? "crosshair" : "";
    if (p.tapped) {
      marker.current ??= new maplibregl.Marker({ color: colors.accent, scale: 0.7 });
      marker.current.setLngLat([p.tapped.lng, p.tapped.lat]).addTo(m);
    } else marker.current?.remove();
  }

  const contourAbort = useRef<AbortController | null>(null);
  function refreshContours() {
    const m = map.current, p = latest.current;
    const layer = p.layers.find((l) => l.kind === "contours");
    if (!m || !loaded.current || !layer || !p.loadContours) return;
    const on = p.overlays.includes(layer.id) && m.getZoom() >= (layer.minzoom ?? 0);
    m.setLayoutProperty(`${layer.id}-labels`, "visibility", on ? "visible" : "none");
    if (!on) return;
    const b = m.getBounds();
    // the API serves at most ~1 km: take the middle of the view when zoomed out further
    const cx = (b.getWest() + b.getEast()) / 2, cy = (b.getSouth() + b.getNorth()) / 2;
    const hw = Math.min((b.getEast() - b.getWest()) / 2, 0.0055), hh = Math.min((b.getNorth() - b.getSouth()) / 2, 0.0045);
    contourAbort.current?.abort();
    const ac = new AbortController();
    contourAbort.current = ac;
    p.loadContours([cx - hw, cy - hh, cx + hw, cy + hh], ac.signal)
      .then((fc) => { if (!ac.signal.aborted) (m.getSource(layer.id) as GeoJSONSource | undefined)?.setData(fc); })
      .catch(() => undefined);
  }

  function drawMeasure() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const p = latest.current, tool = p.measure, pts = measurePts.current;
    const fmtLen = p.fmtLength ?? ((x: number) => `${x.toFixed(1)} m`), fmtA = p.fmtArea ?? ((x: number) => `${x.toFixed(1)} m²`);
    (m.getSource("measure") as GeoJSONSource).setData(measureFc(pts, tool, fmtLen, fmtA) as never);
    (m.getSource("measure-live") as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
    if (tool === "none" || pts.length === 0) return p.onMeasure?.(null);
    const segmentsM = pts.slice(1).map((c, i) => segLen(pts[i]!, c));
    if (tool === "area" && pts.length >= 3) segmentsM.push(segLen(pts[pts.length - 1]!, pts[0]!));
    p.onMeasure?.({ tool, points: pts.length, coords: [...pts], lengthM: tool === "point" ? 0 : pathLengthM(pts, tool === "area"), areaM2: tool === "area" ? ringAreaM2(pts) : 0, segmentsM });
  }

  useEffect(sync, [props.selected, props.neighbours, props.footprint, props.basemap, props.overlays, props.tapped, props.measure, props.drawings]);
  useEffect(refreshContours, [props.overlays]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    measurePts.current = [];
    drawMeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.measure, props.measureReset]);

  // frame the selected plot
  useEffect(() => {
    if (props.selected && map.current) map.current.fitBounds(bounds(props.selected), { padding: 80, maxZoom: 19, duration: 600 });
  }, [props.selected]);

  return (
    <>
      <div ref={el} style={{ position: "absolute", inset: 0 }} data-testid="plot-map" />
      <div
        ref={cursorBox}
        data-testid="cursor-coords"
        style={{ position: "absolute", right: 10, bottom: 34, display: "none", pointerEvents: "none", background: "rgba(255,255,255,0.92)", borderRadius: 6, padding: "3px 7px", fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace", color: colors.ink }}
      />
    </>
  );
});
