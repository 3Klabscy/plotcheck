import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Parcel } from "@plotcheck/core";
import type { MapLayerDef, MapLayerGroup } from "../lib/api";
import { fmtArea, fmtNumber } from "../lib/format";
import { colors } from "../theme";
import type { MeasureResult, MeasureTool } from "./PlotMap.types";

const chip = (on: boolean) => ({
  backgroundColor: on ? colors.ink : "rgba(255,255,255,0.94)",
  paddingHorizontal: 9,
  paddingVertical: 6,
  borderRadius: 8,
  shadowColor: "#000",
  shadowOpacity: 0.12,
  shadowRadius: 3,
  shadowOffset: { width: 0, height: 1 },
});
const chipText = (on: boolean) => ({ color: on ? "#fff" : colors.ink, fontSize: 12, fontWeight: "600" as const });

const GROUPS: MapLayerGroup[] = ["cadastre", "planning", "risk", "environment", "infrastructure", "admin"];

export function LayerPanel({ layers, basemap, overlays, onBasemap, onToggle, onClose }: { layers: MapLayerDef[]; basemap: string; overlays: string[]; onBasemap(id: string): void; onToggle(id: string): void; onClose(): void }) {
  const { t } = useTranslation();
  const title = (l: MapLayerDef) => (l.date ? `${t(l.titleKey)} ${l.date}` : t(l.titleKey));
  const bases = [...layers.filter((l) => l.role === "basemap").map((l) => ({ id: l.id, label: title(l) })), { id: "streets", label: t("map.streets") }, { id: "blank", label: t("map.blank") }];
  return (
    <View testID="layer-panel" style={{ position: "absolute", left: 10, top: 48, width: 290, maxHeight: "80%", backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.line, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("map.layers")}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("map.close")} testID="layers-close"><Text style={{ fontSize: 18, color: colors.muted }}>✕</Text></Pressable>
      </View>
      <ScrollView style={{ paddingHorizontal: 14 }} contentContainerStyle={{ paddingBottom: 12 }}>
        <Text style={groupTitle}>{t("map.group.basemap")}</Text>
        {bases.map((b) => (
          <Pressable key={b.id} testID={`base-${b.id}`} accessibilityRole="radio" accessibilityState={{ checked: basemap === b.id }} onPress={() => onBasemap(b.id)} style={rowStyle}>
            <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: basemap === b.id ? colors.accent : colors.line, alignItems: "center", justifyContent: "center" }}>
              {basemap === b.id && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />}
            </View>
            <Text style={rowText}>{b.label}</Text>
          </Pressable>
        ))}
        {GROUPS.map((g) => {
          const ls = layers.filter((l) => l.role === "overlay" && l.group === g);
          if (ls.length === 0) return null;
          return (
            <View key={g}>
              <Text style={groupTitle}>{t(`map.group.${g}`)}</Text>
              {ls.map((l) => {
                const on = overlays.includes(l.id);
                return (
                  <Pressable key={l.id} testID={`overlay-${l.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onToggle(l.id)} style={rowStyle}>
                    <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 2, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                      {on && <Text style={{ color: "#fff", fontSize: 10, fontWeight: "900", lineHeight: 12 }}>✓</Text>}
                    </View>
                    <Text style={rowText}>{title(l)}</Text>
                    {l.minzoom ? <Text style={{ fontSize: 10, color: colors.muted }}>{t("map.zoomIn")}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 10 }}>{t("map.layersSource")}</Text>
      </ScrollView>
    </View>
  );
}

const groupTitle = { fontSize: 11, fontWeight: "700" as const, color: colors.muted, letterSpacing: 0.5, marginTop: 10, marginBottom: 2, textTransform: "uppercase" as const };
const rowStyle = { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingVertical: 6 };
const rowText = { fontSize: 13, color: colors.ink, flex: 1 };

/** Download a text file (web). On native this arrives with the store builds. */
function download(name: string, mime: string, text: string) {
  if (Platform.OS !== "web") return;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
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

export function MapToolbar({ measure, onMeasure, onClear, result, plot, shareUrl, layersOpen, onLayers }: { measure: MeasureTool; onMeasure(t: MeasureTool): void; onClear(): void; result: MeasureResult | null; plot?: Parcel; shareUrl(): string; layersOpen: boolean; onLayers(): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const share = async () => {
    const url = shareUrl();
    try {
      if (typeof navigator !== "undefined" && navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ url, title: plot?.label ?? "PlotCheck" });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user cancelled */
    }
  };
  const name = plot ? plot.nationalRef.replace(/[^\w-]+/g, "_") : "plot";
  return (
    <>
      <View style={{ position: "absolute", left: 10, top: 10, right: 52, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Pressable testID="btn-layers" onPress={onLayers} style={chip(layersOpen)}><Text style={chipText(layersOpen)}>☰ {t("map.layers")}</Text></Pressable>
        {(["distance", "area"] as const).map((m) => (
          <Pressable key={m} testID={`tool-${m}`} onPress={() => onMeasure(measure === m ? "none" : m)} style={chip(measure === m)}>
            <Text style={chipText(measure === m)}>{m === "distance" ? "📏" : "▱"} {t(`map.tool.${m}`)}</Text>
          </Pressable>
        ))}
        <Pressable testID="tool-share" onPress={share} style={chip(copied)}><Text style={chipText(copied)}>🔗 {copied ? t("map.copied") : t("map.share")}</Text></Pressable>
        {plot && (
          <Pressable testID="tool-export" onPress={() => setExportOpen((o) => !o)} style={chip(exportOpen)}><Text style={chipText(exportOpen)}>⤓ {t("map.export")}</Text></Pressable>
        )}
      </View>
      {exportOpen && plot && (
        <View style={{ position: "absolute", right: 52, top: 48, backgroundColor: colors.panel, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 6 }}>
          {[
            { id: "kml", label: "KML (Google Earth)", run: () => download(`${name}.kml`, "application/vnd.google-earth.kml+xml", plotKml(plot)) },
            { id: "geojson", label: "GeoJSON", run: () => download(`${name}.geojson`, "application/geo+json", plotGeoJson(plot)) },
          ].map((x) => (
            <Pressable key={x.id} testID={`export-${x.id}`} onPress={() => { x.run(); setExportOpen(false); }} style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 13, color: colors.ink }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {measure !== "none" && (
        <View testID="measure-box" style={{ position: "absolute", left: 10, bottom: 28, backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 10, padding: 10, minWidth: 200, borderWidth: 1, borderColor: "#7B2FF7" }}>
          {!result || result.points < (measure === "area" ? 3 : 2) ? (
            <Text style={{ fontSize: 12, color: colors.muted }}>{t(`map.tool.${measure}Hint`)}</Text>
          ) : (
            <>
              {measure === "area" && <Text testID="measure-area" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{fmtArea(result.areaM2, lng, 1)}</Text>}
              <Text testID="measure-length" style={{ fontSize: measure === "area" ? 12 : 15, fontWeight: measure === "area" ? "400" : "700", color: colors.ink }}>
                {measure === "area" ? t("map.perimeter", { m: fmtNumber(result.lengthM, lng, 1) }) : `${fmtNumber(result.lengthM, lng, 1)} m`}
              </Text>
            </>
          )}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
            <Pressable testID="measure-clear" onPress={onClear}><Text style={{ fontSize: 12, color: colors.footprint, fontWeight: "600" }}>{t("map.clear")}</Text></Pressable>
            <Pressable testID="measure-done" onPress={() => onMeasure("none")}><Text style={{ fontSize: 12, color: colors.footprint, fontWeight: "600" }}>{t("map.done")}</Text></Pressable>
          </View>
        </View>
      )}
    </>
  );
}
