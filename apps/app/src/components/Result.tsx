import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { AnalysisResult } from "@plotcheck/engine";
import { dedupeReview, headline, reasonText } from "../lib/text";
export { headline, reasonText };
import type { UseType } from "@plotcheck/core";
import type { AnalyseResponse } from "../lib/api";
import { fmtArea, fmtNumber, fmtPercent } from "../lib/format";
import { colors } from "../theme";
import { Card, Notice, Row, SectionTitle, StatusBadge, styles } from "./ui";
import { RelaxationsView } from "./Relaxations";
import { FinanceView, type FinanceSnapshot } from "./Finance";
import type { PriceChoice } from "../lib/options";

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

export function ResultView({ data, result, onFinance, marketPrice }: { data: AnalyseResponse; result: AnalysisResult; onFinance?(s: FinanceSnapshot | undefined): void; marketPrice?: PriceChoice }) {
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

      <FinanceView data={data} result={result} onChange={onFinance} {...(marketPrice ? { marketPrice } : {})} />

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

