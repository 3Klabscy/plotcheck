import { useState, type ReactNode } from "react";
import { toRoot } from "../lib/portal";
import { Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import type { NationalGrid, Parcel } from "@plotcheck/core";
import { allPositions, feature, toDxf, toGeoJson, toKml, type UserCollection, type UserFeature } from "../lib/userLayer";
import type { MapLayerDef, MapLayerGroup } from "../lib/api";
import { fmtArea, fmtNumber } from "../lib/format";
import { colors } from "../theme";
import type { MeasureResult, MeasureTool } from "./PlotMap.types";

/** One map panel open at a time. */
export type MapPanel = "layers" | "tools" | "find" | "export" | "drawings" | null;

/** Phones and narrow windows: bigger touch targets, panels as bottom sheets. */
export function useCompact() {
  const { width } = useWindowDimensions();
  return width < 700;
}

const shadow = { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } };
const chip = (on: boolean, compact: boolean) => ({
  backgroundColor: on ? colors.ink : "rgba(255,255,255,0.96)",
  paddingHorizontal: compact ? 14 : 10,
  paddingVertical: compact ? 11 : 7,
  minHeight: compact ? 44 : 32,
  justifyContent: "center" as const,
  borderRadius: compact ? 12 : 8,
  ...shadow,
});
const chipText = (on: boolean, compact: boolean) => ({ color: on ? "#fff" : colors.ink, fontSize: compact ? 15 : 13, fontWeight: "700" as const });

const fixed = (Platform.OS === "web" ? { position: "fixed" } : { position: "absolute" }) as unknown as ViewStyle;

/**
 * A panel: on phones a bottom sheet over the whole screen (dimmed backdrop, tap outside to close);
 * on wide screens a popover under the map toolbar.
 */
export function Sheet({ title, onClose, testID, closeTestID, children, footer, wideStyle }: { title: string; onClose(): void; testID: string; closeTestID?: string; children: ReactNode; footer?: ReactNode; wideStyle?: ViewStyle }) {
  const { t } = useTranslation();
  const compact = useCompact();
  const { height } = useWindowDimensions();
  const header = (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingLeft: 16, paddingRight: 6, paddingTop: compact ? 8 : 6, paddingBottom: 4 }}>
      <Text style={{ fontSize: compact ? 18 : 15, fontWeight: "700", color: colors.ink }}>{title}</Text>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("map.close")} testID={closeTestID} hitSlop={8}
        style={{ width: compact ? 48 : 36, height: compact ? 48 : 36, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: compact ? 24 : 18, color: colors.muted }}>✕</Text>
      </Pressable>
    </View>
  );
  if (!compact)
    return (
      <View testID={testID} style={[{ position: "absolute", left: 10, top: 52, width: 300, maxHeight: "80%", backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.line, ...shadow, zIndex: 20 }, wideStyle]}>
        {header}
        <ScrollView style={{ paddingHorizontal: 14 }} contentContainerStyle={{ paddingBottom: 12 }}>{children}</ScrollView>
        {footer}
      </View>
    );
  // rendered at the root of the page: nothing in the layout (side panel, cards) can cover it
  const sheet = (
    <View style={[fixed, { left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000, justifyContent: "flex-end" }]}>
      <Pressable style={[fixed, { left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)" }]} onPress={onClose} accessibilityLabel={t("map.close")} />
      <View testID={testID} style={{ backgroundColor: colors.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: Math.round(height * 0.85), paddingBottom: 12, ...shadow }}>
        <View style={{ alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: 8 }} />
        {header}
        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 8 }}>{children}</ScrollView>
        {footer}
      </View>
    </View>
  );
  return <>{toRoot(sheet)}</>;
}

const GROUPS: MapLayerGroup[] = ["cadastre", "terrain", "planning", "risk", "water", "environment", "infrastructure", "admin", "statistics"];

export function LayerPanel({ layers, basemap, overlays, onBasemap, onToggle, onClose }: { layers: MapLayerDef[]; basemap: string; overlays: string[]; onBasemap(id: string): void; onToggle(id: string): void; onClose(): void }) {
  const { t } = useTranslation();
  const compact = useCompact();
  const title = (l: MapLayerDef) => (l.date ? `${t(l.titleKey)} ${l.date}` : t(l.titleKey));
  const bases = [...layers.filter((l) => l.role === "basemap").map((l) => ({ id: l.id, label: title(l) })), { id: "streets", label: t("map.streets") }, { id: "blank", label: t("map.blank") }];
  const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, minHeight: compact ? 48 : 34 };
  const text = { fontSize: compact ? 16 : 13, color: colors.ink, flex: 1 };
  const box = compact ? 22 : 16;
  const [open, setOpen] = useState<string[]>(() => GROUPS.filter((g) => g === "cadastre" || layers.some((l) => l.group === g && overlays.includes(l.id))));
  return (
    <Sheet title={t("map.layers")} onClose={onClose} testID="layer-panel" closeTestID="layers-close">
      <Text style={groupTitle}>{t("map.group.basemap")}</Text>
      {bases.map((b) => (
        <Pressable key={b.id} testID={`base-${b.id}`} accessibilityRole="radio" accessibilityState={{ checked: basemap === b.id }} onPress={() => onBasemap(b.id)} style={row}>
          <View style={{ width: box, height: box, borderRadius: box / 2, borderWidth: 2, borderColor: basemap === b.id ? colors.accent : colors.line, alignItems: "center", justifyContent: "center" }}>
            {basemap === b.id && <View style={{ width: box / 2, height: box / 2, borderRadius: box / 4, backgroundColor: colors.accent }} />}
          </View>
          <Text style={text}>{b.label}</Text>
        </Pressable>
      ))}
      {GROUPS.map((g) => {
        const ls = layers.filter((l) => l.role === "overlay" && l.group === g);
        if (ls.length === 0) return null;
        const expanded = open.includes(g);
        const active = ls.filter((l) => overlays.includes(l.id)).length;
        return (
          <View key={g}>
            <Pressable testID={`group-${g}`} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen((o) => (expanded ? o.filter((x) => x !== g) : [...o, g]))}
              style={{ flexDirection: "row", alignItems: "center", minHeight: compact ? 44 : 30, marginTop: 6 }}>
              <Text style={[groupTitle, { flex: 1, marginTop: 0 }]}>{t(`map.group.${g}`)} · {ls.length}{active ? ` (${active} ✓)` : ""}</Text>
              <Text style={{ fontSize: compact ? 18 : 14, color: colors.muted }}>{expanded ? "▾" : "▸"}</Text>
            </Pressable>
            {expanded && ls.map((l) => {
              const on = overlays.includes(l.id);
              return (
                <Pressable key={l.id} testID={`overlay-${l.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onToggle(l.id)} style={row}>
                  <View style={{ width: box, height: box, borderRadius: 5, borderWidth: 2, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {on && <Text style={{ color: "#fff", fontSize: compact ? 14 : 10, fontWeight: "900", lineHeight: compact ? 16 : 12 }}>✓</Text>}
                  </View>
                  <Text style={text}>{title(l)}</Text>
                  {l.minzoom ? <Text style={{ fontSize: 11, color: colors.muted }}>{t("map.zoomIn")}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 10 }}>{t("map.layersSource")}</Text>
    </Sheet>
  );
}

const groupTitle = { fontSize: 12, fontWeight: "700" as const, color: colors.muted, letterSpacing: 0.5, marginTop: 12, marginBottom: 2, textTransform: "uppercase" as const };

/** Download a text file (web). On native this arrives with the store builds. */
export function download(name: string, mime: string, text: string | Uint8Array) {
  if (Platform.OS !== "web") return;
  const url = URL.createObjectURL(new Blob([text as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

export function plotKml(p: Parcel): string {
  const polys = p.geometry.type === "Polygon" ? [p.geometry.coordinates] : p.geometry.coordinates;
  const ring = (r: number[][]) => `<LinearRing><coordinates>${r.map((c) => `${c[0]},${c[1]},0`).join(" ")}</coordinates></LinearRing>`;
  const body = polys.map((rings) => `<Polygon><outerBoundaryIs>${ring(rings[0]!)}</outerBoundaryIs>${rings.slice(1).map((r) => `<innerBoundaryIs>${ring(r)}</innerBoundaryIs>`).join("")}</Polygon>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(p.nationalRef)}</name>
<Style id="plot"><LineStyle><color>ff0c59e8</color><width>3</width></LineStyle><PolyStyle><color>330c59e8</color></PolyStyle></Style>
<Placemark><name>${xml(p.label ?? p.nationalRef)}</name><description>${xml(`${p.nationalRef}${p.officialAreaM2 !== undefined ? ` · ${p.officialAreaM2} m²` : ""} · ${p.provenance.source}`)}</description><styleUrl>#plot</styleUrl>${polys.length > 1 ? `<MultiGeometry>${body}</MultiGeometry>` : body}</Placemark>
</Document></kml>`;
}

export function plotGeoJson(p: Parcel): string {
  return JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { nationalRef: p.nationalRef, label: p.label ?? null, officialAreaM2: p.officialAreaM2 ?? null, source: p.provenance.source }, geometry: p.geometry }] }, null, 1);
}

const plotFeature = (p: Parcel): UserFeature => {
  const g = p.geometry;
  const rings = (g.type === "Polygon" ? g.coordinates : g.coordinates[0] ?? []) as [number, number][][];
  return feature({ type: "Polygon", coordinates: rings }, p.label ?? p.nationalRef, "drawing", p.nationalRef);
};

/** Big floating map buttons (bottom right): zoom in, zoom out, my location. */
export function MapFabs({ onZoomIn, onZoomOut, onLocate }: { onZoomIn(): void; onZoomOut(): void; onLocate?(): void }) {
  const { t } = useTranslation();
  const compact = useCompact();
  const size = compact ? 52 : 42;
  const fab = (label: string, a11y: string, onPress: () => void, testID: string) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: "rgba(255,255,255,0.97)", alignItems: "center", justifyContent: "center", ...shadow }, pressed && { backgroundColor: colors.allowedBg }]}>
      <Text style={{ fontSize: compact ? 28 : 22, lineHeight: compact ? 32 : 26, color: colors.ink, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ position: "absolute", right: 12, bottom: compact ? 44 : 36, gap: 10, alignItems: "center", zIndex: 10 }} pointerEvents="box-none">
      {onLocate && fab("◎", t("btn.locate"), onLocate, "fab-locate")}
      {fab("+", t("map.zoomInBtn"), onZoomIn, "fab-zoom-in")}
      {fab("−", t("map.zoomOutBtn"), onZoomOut, "fab-zoom-out")}
    </View>
  );
}

export interface ToolbarProps {
  measure: MeasureTool;
  onMeasure(t: MeasureTool): void;
  onClear(): void;
  result: MeasureResult | null;
  plot?: Parcel;
  shareUrl(): string;
  panel: MapPanel;
  setPanel(p: MapPanel): void;
  grid?: NationalGrid;
  onImport(): void;
  drawingsCount: number;
  onSaveMeasure(): void;
  onFindInView(plot: string): Promise<string | undefined>;
}

export function MapToolbar({ measure, onMeasure, onClear, result, plot, shareUrl, panel, setPanel, grid, onImport, drawingsCount, onSaveMeasure, onFindInView }: ToolbarProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const compact = useCompact();
  const [copied, setCopied] = useState(false);
  const [findText, setFindText] = useState("");
  const [findMsg, setFindMsg] = useState<string>();
  const toggle = (p: Exclude<MapPanel, null>) => setPanel(panel === p ? null : p);
  const share = async () => {
    setPanel(null);
    const url = shareUrl();
    try {
      if (typeof navigator !== "undefined" && navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ url, title: plot?.label ?? "PlotCheck" });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user cancelled */
    }
  };
  const find = async () => {
    if (!findText.trim()) return;
    setFindMsg(t("loading.parcel"));
    const err = await onFindInView(findText.trim());
    setFindMsg(err ? t(`error.${err}`, { defaultValue: t("error.generic") }) : undefined);
    if (!err) setPanel(null);
  };
  const name = plot ? plot.nationalRef.replace(/[^\w-]+/g, "_") : "plot";
  const minPts = measure === "area" ? 3 : 1;

  // the tools: chips in a row on wide screens, big rows in a sheet on phones
  const tools: { id: string; icon: string; label: string; on: boolean; run(): void; show?: boolean }[] = [
    { id: "btn-find", icon: "🔎", label: t("map.findHere"), on: panel === "find", run: () => toggle("find") },
    { id: "tool-distance", icon: "📏", label: t("map.tool.distance"), on: measure === "distance", run: () => { setPanel(null); onMeasure(measure === "distance" ? "none" : "distance"); } },
    { id: "tool-area", icon: "▱", label: t("map.tool.area"), on: measure === "area", run: () => { setPanel(null); onMeasure(measure === "area" ? "none" : "area"); } },
    { id: "tool-import", icon: "⤒", label: t("map.import"), on: false, run: () => { setPanel(null); onImport(); } },
    { id: "btn-drawings", icon: "✎", label: t("map.drawings", { count: drawingsCount }), on: panel === "drawings", run: () => toggle("drawings"), show: drawingsCount > 0 },
    { id: "tool-share", icon: "🔗", label: copied ? t("map.copied") : t("map.share"), on: copied, run: share },
    { id: "tool-export", icon: "⤓", label: t("map.export"), on: panel === "export", run: () => toggle("export"), show: !!plot },
  ].filter((x) => x.show !== false);

  const exportItems = plot
    ? [
        { id: "kml", label: "KML (Google Earth)", run: () => download(`${name}.kml`, "application/vnd.google-earth.kml+xml", plotKml(plot)) },
        { id: "geojson", label: "GeoJSON", run: () => download(`${name}.geojson`, "application/geo+json", plotGeoJson(plot)) },
        ...(grid ? [{ id: "dxf", label: `DXF (${grid.name})`, run: () => download(`${name}.dxf`, "application/dxf", toDxf({ type: "FeatureCollection", features: [plotFeature(plot)] }, grid)) }] : []),
      ]
    : [];
  const sheetRow = { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, minHeight: 52, borderBottomWidth: 1, borderColor: colors.line };

  return (
    <>
      <View style={{ position: "absolute", left: 10, top: 10, right: compact ? 10 : 12, flexDirection: "row", flexWrap: "wrap", gap: compact ? 8 : 6, zIndex: 10 }} pointerEvents="box-none">
        <Pressable testID="btn-layers" onPress={() => toggle("layers")} style={chip(panel === "layers", compact)}><Text style={chipText(panel === "layers", compact)}>☰ {t("map.layers")}</Text></Pressable>
        {compact ? (
          <Pressable testID="btn-tools" onPress={() => toggle("tools")} style={chip(panel === "tools", compact)}><Text style={chipText(panel === "tools", compact)}>🛠 {t("map.tools")}</Text></Pressable>
        ) : (
          tools.map((x) => (
            <Pressable key={x.id} testID={x.id} onPress={x.run} style={chip(x.on, compact)}><Text style={chipText(x.on, compact)}>{x.icon} {x.label}</Text></Pressable>
          ))
        )}
        {compact && measure !== "none" && <View style={chip(true, compact)}><Text style={chipText(true, compact)}>{t(`map.tool.${measure}`)}</Text></View>}
      </View>

      {compact && panel === "tools" && (
        <Sheet title={t("map.tools")} onClose={() => setPanel(null)} testID="tools-menu">
          {tools.map((x) => (
            <Pressable key={x.id} testID={x.id} onPress={x.run} style={({ pressed }) => [sheetRow, pressed && { backgroundColor: colors.allowedBg }]}>
              <Text style={{ fontSize: 22, width: 30, textAlign: "center" }}>{x.icon}</Text>
              <Text style={{ fontSize: 17, color: colors.ink, flex: 1, fontWeight: x.on ? "700" : "400" }}>{x.label}</Text>
            </Pressable>
          ))}
        </Sheet>
      )}

      {panel === "find" && (
        <Sheet title={t("map.findHere")} onClose={() => setPanel(null)} testID="find-box" wideStyle={{ width: 280 }}>
          <Text style={{ fontSize: compact ? 15 : 12, color: colors.muted, marginBottom: 8 }}>{t("map.findHereHint")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput testID="find-plot" value={findText} onChangeText={setFindText} onSubmitEditing={find} inputMode="numeric" placeholder={t("search.plotHint")} autoFocus
              style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: compact ? 12 : 8, fontSize: compact ? 18 : 14 }} />
            <Pressable testID="find-go" onPress={find} style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: compact ? 20 : 14, justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: compact ? 20 : 16 }}>→</Text>
            </Pressable>
          </View>
          {findMsg && <Text testID="find-msg" style={{ fontSize: compact ? 14 : 12, color: colors.maybe, marginTop: 8 }}>{findMsg}</Text>}
        </Sheet>
      )}

      {panel === "export" && plot && (
        <Sheet title={t("map.export")} onClose={() => setPanel(null)} testID="export-menu" wideStyle={{ left: undefined, right: 12, width: 240 }}>
          {exportItems.map((x) => (
            <Pressable key={x.id} testID={`export-${x.id}`} onPress={() => { x.run(); setPanel(null); }} style={({ pressed }) => [compact ? sheetRow : { paddingVertical: 9 }, pressed && { backgroundColor: colors.allowedBg }]}>
              <Text style={{ fontSize: compact ? 17 : 13, color: colors.ink }}>{x.label}</Text>
            </Pressable>
          ))}
        </Sheet>
      )}

      {measure !== "none" && (
        <View testID="measure-box" style={{ position: "absolute", left: 10, bottom: compact ? 44 : 28, right: compact ? 78 : undefined, backgroundColor: "rgba(255,255,255,0.97)", borderRadius: 12, padding: 12, minWidth: compact ? undefined : 220, borderWidth: 1, borderColor: "#7B2FF7", zIndex: 10, ...shadow }}>
          {!result || result.points < (measure === "area" ? 3 : 2) ? (
            <Text style={{ fontSize: compact ? 14 : 12, color: colors.muted }}>{t(`map.tool.${measure}Hint`)}</Text>
          ) : (
            <>
              {measure === "area" && <Text testID="measure-area" style={{ fontSize: compact ? 18 : 15, fontWeight: "700", color: colors.ink }}>{fmtArea(result.areaM2, lng, 1)}</Text>}
              <Text testID="measure-length" style={{ fontSize: measure === "area" ? (compact ? 14 : 12) : compact ? 18 : 15, fontWeight: measure === "area" ? "400" : "700", color: colors.ink }}>
                {measure === "area" ? t("map.perimeter", { m: fmtNumber(result.lengthM, lng, 1) }) : `${fmtNumber(result.lengthM, lng, 1)} m`}
              </Text>
            </>
          )}
          <View style={{ flexDirection: "row", gap: compact ? 18 : 12, marginTop: 8, flexWrap: "wrap" }}>
            {result && result.points >= minPts && (
              <Pressable testID="measure-save" hitSlop={8} onPress={onSaveMeasure}><Text style={{ fontSize: compact ? 15 : 12, color: "#0284C7", fontWeight: "700" }}>{t("map.saveDrawing")}</Text></Pressable>
            )}
            <Pressable testID="measure-clear" hitSlop={8} onPress={onClear}><Text style={{ fontSize: compact ? 15 : 12, color: colors.footprint, fontWeight: "600" }}>{t("map.clear")}</Text></Pressable>
            <Pressable testID="measure-done" hitSlop={8} onPress={() => onMeasure("none")}><Text style={{ fontSize: compact ? 15 : 12, color: colors.footprint, fontWeight: "600" }}>{t("map.done")}</Text></Pressable>
          </View>
        </View>
      )}
    </>
  );
}

export function DrawingsPanel({ drawings, grid, onDelete, onClearAll, onZoom, onClose }: { drawings: UserCollection; grid?: NationalGrid; onDelete(id: string): void; onClearAll(): void; onZoom(f: UserFeature): void; onClose(): void }) {
  const { t } = useTranslation();
  const compact = useCompact();
  const kind = (f: UserFeature) => t(`map.geom.${f.geometry.type}`);
  const stamp = new Date().toISOString().slice(0, 10);
  const footer = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.line }}>
      <Text style={{ fontSize: 12, color: colors.muted, width: "100%" }}>{t("map.exportAll")}</Text>
      {[
        { id: "kml", label: "KML", run: () => download(`plotcheck-${stamp}.kml`, "application/vnd.google-earth.kml+xml", toKml(drawings, "PlotCheck")) },
        { id: "geojson", label: "GeoJSON", run: () => download(`plotcheck-${stamp}.geojson`, "application/geo+json", toGeoJson(drawings)) },
        ...(grid ? [{ id: "dxf", label: `DXF (${grid.name})`, run: () => download(`plotcheck-${stamp}.dxf`, "application/dxf", toDxf(drawings, grid)) }] : []),
      ].map((x) => (
        <Pressable key={x.id} testID={`drawings-export-${x.id}`} onPress={x.run} style={chip(false, compact)}><Text style={chipText(false, compact)}>{x.label}</Text></Pressable>
      ))}
      <Pressable testID="drawings-clear" onPress={onClearAll} style={{ paddingVertical: 10 }}><Text style={{ fontSize: compact ? 15 : 12, color: colors.notAllowed, fontWeight: "600" }}>{t("map.clearAll")}</Text></Pressable>
    </View>
  );
  return (
    <Sheet title={t("map.myDrawings")} onClose={onClose} testID="drawings-panel" closeTestID="drawings-close" footer={footer}>
      {drawings.features.map((f) => (
        <View key={f.id} testID={`drawing-${f.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: compact ? 56 : 40, borderBottomWidth: 1, borderColor: colors.line }}>
          <Pressable style={{ flex: 1, paddingVertical: 6 }} onPress={() => onZoom(f)}>
            <Text style={{ fontSize: compact ? 16 : 13, color: colors.ink }} numberOfLines={1}>{f.properties.name || kind(f)}</Text>
            <Text style={{ fontSize: compact ? 13 : 11, color: colors.muted }}>{kind(f)} · {t(`map.from.${f.properties.source}`)} · {allPositions(f.geometry).length} {t("map.vertices")}</Text>
          </Pressable>
          <Pressable onPress={() => onDelete(f.id)} accessibilityLabel={t("map.delete")} hitSlop={8} style={{ padding: 8 }}><Text style={{ color: colors.notAllowed, fontSize: compact ? 20 : 15 }}>🗑</Text></Pressable>
        </View>
      ))}
    </Sheet>
  );
}
