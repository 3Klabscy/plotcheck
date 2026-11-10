import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { api, type AreaInfo, type AreaInfoRow, type LegendItem } from "../lib/api";
import { fmtNumber } from "../lib/format";
import { colors } from "../theme";
import { Sheet, useCompact } from "./MapControls";

/** Figures of the areas around a tapped point (census), finest level first. */
export function AreaStatsSheet({ info, loading, error, onClose }: { info?: AreaInfo; loading: boolean; error?: string; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const compact = useCompact();
  const [tab, setTab] = useState(0);
  useEffect(() => setTab(0), [info]);
  const area = info?.areas[tab];
  const fmt = (r: AreaInfoRow) =>
    r.kind === "percent" ? `${fmtNumber(r.value, lng, 1)}%`
    : r.kind === "decimal" ? fmtNumber(r.value, lng, 1)
    : r.kind === "perKm2" ? `${fmtNumber(r.value, lng, 0)} ${t("map.perKm2")}`
    : fmtNumber(r.value, lng, 0);
  const name = (n: { el?: string; en?: string }) => (lng === "el" ? n.el ?? n.en : n.en ?? n.el) ?? "";
  const fs = compact ? 15 : 13;
  return (
    <Sheet title={t("map.statsTitle")} onClose={onClose} testID="area-stats" closeTestID="area-stats-close" wideStyle={{ width: 380, maxHeight: "90%" }}>
      {loading && <Text style={{ fontSize: fs, color: colors.muted, paddingVertical: 12 }}>{t("loading.parcel")}</Text>}
      {!loading && (error || !info || info.areas.length === 0) && <Text testID="area-stats-none" style={{ fontSize: fs, color: colors.muted, paddingVertical: 12 }}>{t("map.statsNone")}</Text>}
      {!loading && info && area && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {info.areas.map((a, i) => (
              <Pressable key={a.levelKey} testID={`area-tab-${i}`} onPress={() => setTab(i)}
                style={{ paddingHorizontal: 10, paddingVertical: compact ? 8 : 5, borderRadius: 999, borderWidth: 1, borderColor: i === tab ? colors.accent : colors.line, backgroundColor: i === tab ? colors.allowedBg : colors.panel }}>
                <Text style={{ fontSize: compact ? 13 : 12, fontWeight: "700", color: i === tab ? colors.accent : colors.ink }}>{t(a.levelKey)}</Text>
              </Pressable>
            ))}
          </View>
          <Text testID="area-name" style={{ fontSize: compact ? 19 : 16, fontWeight: "800", color: colors.ink, marginBottom: 4 }}>{name(area.name)}</Text>
          {area.sections.map((s) => (
            <View key={s.titleKey} style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t(s.titleKey)}</Text>
              {s.rows.map((r) => {
                const share = r.of ? r.value / r.of : undefined;
                return (
                  <View key={r.key} testID={`stat-${r.key.split(".").pop()}`} style={{ paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.line }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ fontSize: fs, color: colors.ink, flex: 1 }}>{t(r.key)}</Text>
                      <Text style={{ fontSize: fs, color: colors.ink, fontWeight: "700" }}>
                        {fmt(r)}{share !== undefined ? <Text style={{ fontWeight: "400", color: colors.muted }}>{`  ${fmtNumber(share * 100, lng, 1)}%`}</Text> : null}
                      </Text>
                    </View>
                    {share !== undefined && (
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: "#EEECE6", marginTop: 3 }}>
                        <View style={{ height: 5, borderRadius: 3, width: `${Math.max(1, Math.min(100, share * 100))}%`, backgroundColor: colors.accent }} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 12 }}>{t(info.sourceKey)}</Text>
        </>
      )}
    </Sheet>
  );
}

/** Legend swatches of what a layer currently draws (fetched through the API). */
export function LayerLegend({ country, layer, layers }: { country: string; layer: string; layers: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<LegendItem[]>([]);
  useEffect(() => {
    let live = true;
    api.mapLegend(country, layer, layers).then((r) => live && setItems(r.items)).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [country, layer, layers]);
  if (items.length === 0) return null;
  return (
    <View testID={`legend-${layer}`} style={{ marginTop: 6 }}>
      <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>{t("map.legend")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {items.map((x) => (
          <View key={x.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Image source={{ uri: x.image }} style={{ width: 16, height: 16, borderRadius: 3 }} />
            <Text style={{ fontSize: 12, color: colors.ink }}>{x.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
