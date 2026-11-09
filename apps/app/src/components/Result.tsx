import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AnalysisResult, Check } from "@plotcheck/engine";
import type { UseType } from "@plotcheck/core";
import type { AnalyseResponse } from "../lib/api";
import { fmtArea, fmtNumber, fmtPercent } from "../lib/format";
import { colors } from "../theme";
import { Card, Notice, Row, SectionTitle, StatusBadge, styles } from "./ui";
import { RelaxationsView } from "./Relaxations";

/** Translate engine reason params: use keys → names, numbers → local format. */
export function reasonText(t: TFunction, lng: string, c: Pick<Check, "reasonKey" | "params">): string {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.params ?? {})) {
    if (k === "use") params[k] = t(`use.${v}`);
    else if (k === "type") params[k] = t(`unit.${v}`);
    else if (k === "surface") params[k] = t(`surface.${v}`);
    else if (k === "years" || k === "code") params[k] = String(v);
    else params[k] = typeof v === "number" ? fmtNumber(v, lng, 1) : String(v);
  }
  return t(c.reasonKey, params);
}

export function headline(t: TFunction, lng: string, r: AnalysisResult): string {
  const f = r.figures;
  if (r.checks.some((c) => c.id === "use" && c.status === "not_allowed")) {
    return t("result.headline.not_allowed", { use: t(`use.${r.use}`), zone: r.zone.code });
  }
  const base = { gfa: fmtArea(f.achievableGfaM2, lng), floors: f.feasibleFloors, coverage: fmtArea(f.footprintM2, lng) };
  let s = "";
  switch (r.use) {
    case "apartment_block":
      s = t("result.headline.apartment_block", { ...base, units: r.units?.total ?? 0, pmin: r.units?.parking.min ?? 0, pmax: r.units?.parking.max ?? 0 });
      break;
    case "house":
      s = t("result.headline.house", base);
      break;
    case "row_houses":
      s = t("result.headline.row_houses", { ...base, count: r.houses?.count ?? 0, each: fmtArea(r.houses?.gfaEachM2 ?? 0, lng) });
      break;
    case "commercial":
      s = t("result.headline.commercial", { ...base, net: fmtArea(r.commercial?.netM2 ?? 0, lng), pmin: r.commercial?.parking.min ?? 0, pmax: r.commercial?.parking.max ?? 0 });
      break;
    case "mixed_use":
      s = t("result.headline.mixed_use", { ...base, commercial: fmtArea(r.commercial?.gfaM2 ?? 0, lng), units: r.units?.total ?? 0 });
      break;
  }
  return r.status === "maybe" ? t("result.headline.maybePrefix") + s : s;
}

export function UseOptions({ data, onPick, selected }: { data: AnalyseResponse; onPick(u: UseType): void; selected?: UseType }) {
  const { t, i18n } = useTranslation();
  return (
    <View>
      {data.results.map((r) => (
        <Pressable
          key={r.use}
          testID={`use-${r.use}`}
          accessibilityRole="button"
          onPress={() => onPick(r.use)}
          style={({ pressed }) => [
            { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, borderWidth: 1, borderColor: selected === r.use ? colors.accent : colors.line, backgroundColor: colors.panel, marginBottom: 8, gap: 12 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{t(`use.${r.use}`)}</Text>
            {r.status !== "not_allowed" && (
              <Text style={styles.small}>
                {[
                  fmtArea(r.figures.achievableGfaM2, i18n.language),
                  t("result.floorsShort", { count: r.figures.feasibleFloors }),
                  r.units ? t("result.unitsShort", { count: r.units.total }) : r.use === "row_houses" && r.houses ? t("result.housesShort", { count: r.houses.count }) : "",
                ].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
          <StatusBadge status={r.status} />
        </Pressable>
      ))}
    </View>
  );
}

export function ResultView({ data, result }: { data: AnalyseResponse; result: AnalysisResult }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const f = result.figures;
  const review = dedupeReview(result);

  return (
    <View testID="result">
      <Card style={{ borderColor: result.status === "not_allowed" ? colors.notAllowed : colors.accent, borderWidth: 2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={styles.h2}>{t(`use.${result.use}`)}</Text>
          <StatusBadge status={result.status} />
        </View>
        <Text style={[styles.body, { fontSize: 16, lineHeight: 24 }]} testID="headline">{headline(t, lng, result)}</Text>
      </Card>

      <RelaxationsView result={result} />

      {review.length > 0 && (
        <Notice>
          <Text style={[styles.body, { fontWeight: "600", marginBottom: 6 }]}>{t("review.banner")}</Text>
          {review.map((g) => (
            <Text key={g.source} style={[styles.small, { marginTop: 4 }]}>
              • <Text style={{ fontWeight: "600" }}>{g.constraints.map((c) => t(`constraint.${c}`)).join(", ")}</Text> — {g.source}
            </Text>
          ))}
        </Notice>
      )}

      {result.checks.length > 0 && (
        <Card>
          <SectionTitle>{t("result.checks")}</SectionTitle>
          {result.checks.map((c, i) => (
            <View key={`${c.id}-${i}`} style={{ flexDirection: "row", gap: 10, paddingVertical: 6, alignItems: "flex-start" }}>
              <Text style={{ color: c.status === "allowed" ? colors.allowed : c.status === "maybe" ? colors.maybe : colors.notAllowed, fontWeight: "700", width: 16 }}>
                {c.status === "allowed" ? "✓" : c.status === "maybe" ? "?" : "✕"}
              </Text>
              <Text style={[styles.body, { flex: 1, fontSize: 14 }]}>{reasonText(t, lng, c)}</Text>
            </View>
          ))}
        </Card>
      )}

      {f.perFloorM2.length > 0 && result.status !== "not_allowed" && (
        <Card>
          <SectionTitle>{t("result.perFloor")}</SectionTitle>
          {f.perFloorM2.map((a, i) => (
            <Row key={i} label={i === 0 ? t("result.ground") : t("result.floorN", { n: i })} value={fmtArea(a, lng, 1)} />
          ))}
          <Row label={t("result.total")} value={fmtArea(f.achievableGfaM2, lng, 1)} strong />
        </Card>
      )}

      {result.units && result.status !== "not_allowed" && (
        <Card>
          <SectionTitle>{t("result.units")}</SectionTitle>
          {(["studio", "bed1", "bed2", "bed3"] as const)
            .filter((k) => result.units!.byType[k] > 0)
            .map((k) => (
              <Row key={k} label={t(`unit.${k}`)} value={`${result.units!.byType[k]} × ~${fmtArea(data.params.unitSizeM2[k], lng)}`} />
            ))}
          <Row label={t("result.parking")} value={`${result.units.parking.min}–${result.units.parking.max}`} strong />
        </Card>
      )}

      <Card>
        <SectionTitle>{t("result.figures")}</SectionTitle>
        <Row label={t("fig.plotArea")} value={fmtArea(f.plotAreaM2, lng)} />
        <Row label={t("fig.far")} value={fmtNumber(f.far, lng, 2)} />
        <Row label={t("fig.coverageRatio")} value={fmtPercent(f.coverageRatio, lng)} />
        <Row label={t("fig.maxGfa")} value={fmtArea(f.maxGfaM2, lng, 1)} strong />
        <Row label={t("fig.maxCoverage")} value={fmtArea(f.maxCoverageM2, lng, 1)} />
        {f.setbackM !== undefined && <Row label={t("fig.setback")} value={`${fmtNumber(f.setbackM, lng, 1)} m`} />}
        {f.netFootprintM2 !== undefined && <Row label={t("fig.netFootprint")} value={fmtArea(f.netFootprintM2, lng, 1)} />}
        <Row label={t("fig.footprint")} value={fmtArea(f.footprintM2, lng, 1)} />
        {f.maxStories !== undefined && <Row label={t("fig.maxStories")} value={String(f.maxStories)} />}
        {f.maxHeightM !== undefined && <Row label={t("fig.maxHeight")} value={`${fmtNumber(f.maxHeightM, lng, 1)} m`} />}
        <Row label={t("fig.feasibleFloors")} value={String(f.feasibleFloors)} />
        <Row label={t("fig.buildingHeight")} value={`~${fmtNumber(f.buildingHeightM, lng, 1)} m`} />
        {result.buildableFootprint && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
            <View style={{ width: 14, height: 14, backgroundColor: colors.footprint, opacity: 0.6, borderRadius: 3 }} />
            <Text style={styles.small}>{t("result.footprintLegend")}</Text>
          </View>
        )}
      </Card>

      <Card>
        <SectionTitle>{t("result.toBeChecked")}</SectionTitle>
        {result.toBeChecked.map((k) => (
          <Text key={k} style={[styles.body, { fontSize: 14, marginBottom: 4 }]}>☐ {t(k)}</Text>
        ))}
      </Card>

      <Notice tone="info">
        <Text style={[styles.body, { fontWeight: "700", marginBottom: 4 }]}>{t("result.disclaimerTitle")}</Text>
        <Text style={styles.small} testID="disclaimer">{t(data.disclaimerKey)}</Text>
      </Notice>

      <Text style={[styles.small, { marginBottom: 24 }]}>
        {t("result.sources")}: {[...new Set([data.parcel.provenance.source, data.zone.provenance.source])].join(" · ")}
        {data.zone.provenance.sourceUpdatedAt ? ` (${data.zone.provenance.sourceUpdatedAt})` : ""}
      </Text>
    </View>
  );
}

/** Group unverified values by their source so each source is listed once. */
function dedupeReview(r: AnalysisResult) {
  const groups = new Map<string, Set<string>>();
  for (const w of r.needsReview) {
    const g = groups.get(w.provenance.source) ?? new Set<string>();
    g.add(w.constraint);
    groups.set(w.provenance.source, g);
  }
  return [...groups].map(([source, cs]) => ({ source, constraints: [...cs] }));
}
