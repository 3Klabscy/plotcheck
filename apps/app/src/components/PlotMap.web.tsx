import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PolygonGeometry } from "@plotcheck/core";
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
  }));

  // create once
  useEffect(() => {
    if (!el.current) return;
    const basemap = props.layers.find((l) => l.role === "basemap");
    const sources: StyleSpecification["sources"] = {
      streets: { type: "raster", tiles: [STREETS.url], tileSize: 256, attribution: STREETS.attribution, maxzoom: 19 },
    };
    if (basemap?.kind === "xyz") sources.aerial = { type: "raster", tiles: [basemap.url], tileSize: 256, maxzoom: basemap.maxzoom ?? 19, attribution: props.attribution };
    for (const o of props.layers) {
      if (o.kind === "wms") sources[o.id] = { type: "raster", tiles: [wmsTiles(o.url, o.layers)], tileSize: 512, minzoom: o.minzoom ?? 0 };
    }
    const style: StyleSpecification = {
      version: 8,
      sources,
      layers: [
        { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } },
        ...(sources.aerial ? [{ id: "aerial", type: "raster" as const, source: "aerial" }] : []),
        ...props.layers
          .filter((o) => o.kind === "wms")
          .map((o) => ({
            id: o.id,
            type: "raster" as const,
            source: o.id,
            minzoom: o.kind === "wms" ? o.minzoom ?? 0 : 0,
            paint: { "raster-opacity": o.kind === "wms" ? o.opacity ?? 0.8 : 1 },
            layout: { visibility: (o.id.includes("zone") ? "none" : "visible") as "none" | "visible" },
          })),
      ],
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
      loaded.current = true;
      sync();
    });
    m.on("click", (e) => {
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
    const hasAerial = !!m.getLayer("aerial");
    m.setLayoutProperty("streets", "visibility", p.basemap === "streets" || !hasAerial ? "visible" : "none");
    if (hasAerial) m.setLayoutProperty("aerial", "visibility", p.basemap === "aerial" ? "visible" : "none");
    for (const l of p.layers) if (l.kind === "wms" && l.id.includes("zone") && m.getLayer(l.id)) m.setLayoutProperty(l.id, "visibility", p.showZones ? "visible" : "none");
    if (p.tapped) {
      marker.current ??= new maplibregl.Marker({ color: colors.accent, scale: 0.7 });
      marker.current.setLngLat([p.tapped.lng, p.tapped.lat]).addTo(m);
    } else marker.current?.remove();
  }

  useEffect(sync, [props.selected, props.neighbours, props.footprint, props.basemap, props.showZones, props.tapped]);

  // frame the selected plot
  useEffect(() => {
    if (props.selected && map.current) map.current.fitBounds(bounds(props.selected), { padding: 80, maxZoom: 19, duration: 600 });
  }, [props.selected]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} data-testid="plot-map" />;
});
