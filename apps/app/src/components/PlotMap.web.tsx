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

const measureFc = (pts: [number, number][], area: boolean) => ({
  type: "FeatureCollection" as const,
  features: [
    ...(pts.length >= 2 ? [{ type: "Feature" as const, properties: {}, geometry: area && pts.length >= 3 ? { type: "Polygon" as const, coordinates: [[...pts, pts[0]!]] } : { type: "LineString" as const, coordinates: pts } }] : []),
    ...pts.map((c) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: c } })),
  ],
});

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
  }));
  const measurePts = useRef<[number, number][]>([]);

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
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
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
      m.addSource("measure", { type: "geojson", data: measureFc([], false) });
      m.addLayer({ id: "measure-fill", type: "fill", source: "measure", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#7B2FF7", "fill-opacity": 0.15 } });
      m.addLayer({ id: "measure-line", type: "line", source: "measure", filter: ["!=", "$type", "Point"], paint: { "line-color": "#7B2FF7", "line-width": 2.5, "line-dasharray": [3, 1.5] } });
      m.addLayer({ id: "measure-pts", type: "circle", source: "measure", filter: ["==", "$type", "Point"], paint: { "circle-radius": 4.5, "circle-color": "#fff", "circle-stroke-color": "#7B2FF7", "circle-stroke-width": 2 } });
      loaded.current = true;
      sync();
    });
    m.on("moveend", () => {
      const c = m.getCenter();
      latest.current.onMove?.({ lng: c.lng, lat: c.lat, zoom: m.getZoom() });
      refreshContours();
    });
    m.on("click", (e) => {
      const tool = latest.current.measure;
      if (tool !== "none") {
        measurePts.current = [...measurePts.current, [e.lngLat.lng, e.lngLat.lat]];
        drawMeasure();
        return;
      }
      const hit = m.queryRenderedFeatures(e.point, { layers: ["neighbours-fill"] })[0];
      const id = hit?.properties?.["id"] as string | undefined;
      if (id && latest.current.onSelectNeighbour) latest.current.onSelectNeighbour(id);
      else latest.current.onTap({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
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
    const tool = latest.current.measure;
    const pts = measurePts.current;
    (m.getSource("measure") as GeoJSONSource).setData(measureFc(pts, tool === "area"));
    if (tool === "none" || pts.length === 0) return latest.current.onMeasure?.(null);
    latest.current.onMeasure?.({ tool, points: pts.length, lengthM: pathLengthM(pts, tool === "area"), areaM2: tool === "area" ? ringAreaM2(pts) : 0 });
  }

  useEffect(sync, [props.selected, props.neighbours, props.footprint, props.basemap, props.overlays, props.tapped, props.measure]);
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

  return <div ref={el} style={{ position: "absolute", inset: 0 }} data-testid="plot-map" />;
});
