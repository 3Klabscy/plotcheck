import { useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { areasFrom, finance, type AnalysisResult, type FinanceAreas, type FinanceParams, type FinanceResult } from "@plotcheck/engine";
import type { AnalyseResponse, FinanceDefaults } from "../lib/api";
import { fmtArea, fmtMoney, fmtNumber, fmtPercent } from "../lib/format";
import { colors } from "../theme";
import { Card, Notice, Row, SectionTitle, styles } from "./ui";

export type Finish = "basic" | "standard" | "high";
export type Scenario = "base" | "relaxed";

function Stepper({ label, value, onChange, step, min, format, testID }: { label: string; value: number; onChange(v: number): void; step: number; min: number; format(v: number): string; testID: string }) {
  const btn = (d: number, s: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${s}`}
      testID={`${testID}-${d > 0 ? "up" : "down"}`}
      onPress={() => onChange(Math.max(min, value + d))}
      style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.accent, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: colors.accent, fontSize: 18, fontWeight: "700" }}>{s}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, gap: 8 }}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      {btn(-step, "−")}
      <Text testID={testID} style={[styles.rowValue, { minWidth: 92, textAlign: "center", fontWeight: "700" }]}>{format(value)}</Text>
      {btn(step, "+")}
    </View>
  );
}

function Segment<T extends string>({ options, value, onChange, label, testID }: { options: { id: T; label: string }[]; value: T; onChange(v: T): void; label: string; testID: string }) {
  return (
    <View style={{ paddingVertical: 6 }}>
      <Text style={[styles.rowLabel, { marginBottom: 6 }]}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            testID={`${testID}-${o.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: o.id === value }}
            onPress={() => onChange(o.id)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: o.id === value ? colors.accent : colors.line, backgroundColor: o.id === value ? colors.allowedBg : colors.panel }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: o.id === value ? colors.accent : colors.ink }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** What the finance card shows right now (the user's own assumptions), e.g. for the PDF report. */
export interface FinanceSnapshot {
  use: AnalysisResult["use"];
  scenario: Scenario;
  finish: Finish;
  params: FinanceParams;
  areas: FinanceAreas;
  result: FinanceResult;
}

/** Financial feasibility: estimates from the country module, adjustable and recomputed on the device. */
export function FinanceView({ data, result, onChange }: { data: AnalyseResponse; result: AnalysisResult; onChange?(s: FinanceSnapshot | undefined): void }) {
  const fd = data.finance;
  const show = !!fd && result.status !== "not_allowed" && result.figures.achievableGfaM2 > 0;
  useEffect(() => { if (!show) onChange?.(undefined); }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  return <FinanceCard key={`${data.parcel.nationalRef}-${result.use}`} fd={fd} data={data} result={result} onChange={onChange} />;
}

function FinanceCard({ fd, data, result, onChange }: { fd: FinanceDefaults; data: AnalyseResponse; result: AnalysisResult; onChange?(s: FinanceSnapshot): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const defaults = fd.byUse[result.use];
  const relaxed = result.relaxed && result.relaxed.gain.gfaM2 > 0.5 ? result.relaxed : undefined;

  const [scenario, setScenario] = useState<Scenario>(relaxed ? "relaxed" : "base");
  const [price, setPrice] = useState(defaults.salePricePerM2);
  const [commercialPrice, setCommercialPrice] = useState(defaults.commercialPricePerM2);
  const [cost, setCost] = useState(defaults.constructionCostPerM2);
  const [finish, setFinish] = useState<Finish>("standard");
  const [basement, setBasement] = useState(defaults.basementLevels);
  const [profitPct, setProfitPct] = useState(Math.round(defaults.targetProfitPctOfGdv * 100));
  const [landText, setLandText] = useState("");
  const landPrice = Number(landText.replace(/[^\d]/g, "")) || undefined;

  const src = scenario === "relaxed" && relaxed ? relaxed : result;
  const verandaM2 = scenario === "relaxed" && relaxed ? relaxed.applied.reduce((s, a) => s + (a.contribution.verandaM2 ?? 0), 0) : 0;
  const areas = areasFrom(src, data.params.netToGross, verandaM2);

  const params: FinanceParams = { ...defaults, salePricePerM2: price, commercialPricePerM2: commercialPrice, constructionCostPerM2: Math.round(cost * fd.finishFactor[finish]), basementLevels: basement, targetProfitPctOfGdv: profitPct / 100, ...(landPrice ? { landPrice } : {}) };
  const r = finance(areas, params);
  const snapKey = JSON.stringify([scenario, finish, params, areas]);
  useEffect(() => { onChange?.({ use: result.use, scenario, finish, params, areas, result: r }); }, [snapKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const money = (n: number) => fmtMoney(n, lng, r.currency);
  const perM2 = (n: number) => `${money(n)}/m²`;
  const olv = fd.officialLandValue;
  const pays = r.residualLandValue > 0;

  return (
    <Card style={{ borderColor: colors.footprint, borderWidth: 2 }}>
      <View testID="finance">
        <Text style={styles.h2}>{t("fin.title")}</Text>
        <Text style={[styles.body, { fontSize: 15, marginBottom: 8 }]} testID="finance-headline">
          {pays ? t("fin.headline.pays", { land: money(r.residualLandValue), gdv: money(r.gdv) }) : t("fin.headline.not_pays", { gdv: money(r.gdv), cost: money(r.devCost) })}
        </Text>

        {relaxed && (
          <Segment<Scenario>
            label={t("fin.scenario")}
            testID="fin-scenario"
            value={scenario}
            onChange={setScenario}
            options={[{ id: "base", label: t("fin.scenario.base") }, { id: "relaxed", label: t("fin.scenario.relaxed") }]}
          />
        )}

        <SectionTitle>{t("fin.assumptions")}</SectionTitle>
        {areas.residentialNetM2 > 0 && <Stepper label={t("fin.salePrice")} value={price} onChange={setPrice} step={100} min={500} format={perM2} testID="fin-price" />}
        {areas.commercialNetM2 > 0 && <Stepper label={t("fin.commercialPrice")} value={commercialPrice} onChange={setCommercialPrice} step={100} min={500} format={perM2} testID="fin-cprice" />}
        <Stepper label={t("fin.buildCost")} value={cost} onChange={setCost} step={50} min={300} format={perM2} testID="fin-cost" />
        <Segment<Finish>
          label={t("fin.finish")}
          testID="fin-finish"
          value={finish}
          onChange={setFinish}
          options={(["basic", "standard", "high"] as const).map((id) => ({ id, label: `${t(`fin.finish.${id}`)} (${fmtPercent(fd.finishFactor[id], lng)})` }))}
        />
        <Stepper label={t("fin.basement")} value={basement} onChange={(v) => setBasement(Math.min(3, v))} step={1} min={0} format={(v) => String(v)} testID="fin-basement" />
        <Stepper label={t("fin.profitTarget")} value={profitPct} onChange={(v) => setProfitPct(Math.min(40, v))} step={1} min={0} format={(v) => `${v}%`} testID="fin-profit" />
        <View style={{ paddingVertical: 6 }}>
          <Text style={[styles.rowLabel, { marginBottom: 6 }]}>{t("fin.landPrice")}</Text>
          <TextInput
            testID="fin-land"
            value={landText}
            onChangeText={setLandText}
            keyboardType="number-pad"
            placeholder={t("fin.landPriceHint")}
            placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: colors.ink }}
          />
        </View>

        <SectionTitle>{t("fin.sales")}</SectionTitle>
        {areas.residentialNetM2 > 0 && <Row label={t("fin.residential", { area: fmtArea(areas.residentialNetM2, lng) })} value={money(r.gdvBreakdown.residential)} />}
        {areas.commercialNetM2 > 0 && <Row label={t("fin.commercial", { area: fmtArea(areas.commercialNetM2, lng) })} value={money(r.gdvBreakdown.commercial)} />}
        {areas.verandaM2 > 0 && <Row label={t("fin.verandas", { area: fmtArea(areas.verandaM2, lng) })} value={money(r.gdvBreakdown.verandas)} />}
        <Row label={t("fin.gdv")} value={money(r.gdv)} strong />

        <SectionTitle>{t("fin.costs")}</SectionTitle>
        <Row label={t("fin.building", { area: fmtArea(areas.gfaM2, lng), rate: perM2(params.constructionCostPerM2) })} value={money(r.hardBreakdown.building)} />
        {r.hardBreakdown.verandas > 0 && <Row label={t("fin.verandaCost")} value={money(r.hardBreakdown.verandas)} />}
        {r.hardBreakdown.basement > 0 && <Row label={t("fin.basementCost", { count: basement })} value={money(r.hardBreakdown.basement)} />}
        <Row label={t("fin.external")} value={money(r.hardBreakdown.external)} />
        <Row label={t("fin.soft")} value={money(r.softBreakdown.design + r.softBreakdown.permits + r.softBreakdown.legal)} />
        <Row label={t("fin.contingency")} value={money(r.softBreakdown.contingency)} />
        <Row label={t("fin.marketing")} value={money(r.softBreakdown.marketing)} />
        <Row label={t("fin.financeCost")} value={money(r.softBreakdown.finance)} />
        <Row label={t("fin.devCost")} value={money(r.devCost)} strong />
        <Row label={t("fin.surplus")} value={money(r.surplusBeforeLand)} strong />

        <SectionTitle>{t("fin.land")}</SectionTitle>
        <Row label={t("fin.residual", { profit: fmtPercent(params.targetProfitPctOfGdv, lng) })} value={money(r.residualLandValue)} strong />
        {pays && <Row label={t("fin.residualFees")} value={money(r.residualLandFees)} />}
        {pays && areas.gfaM2 > 0 && <Row label={t("fin.residualPerM2")} value={perM2(Math.round(r.residualLandValue / areas.gfaM2))} />}
        {olv && (
          <View testID="fin-official">
            <Row label={t("fin.official", { date: new Date(olv.date).toLocaleDateString(lng.startsWith("el") ? "el-GR" : "en-GB") })} value={money(olv.total)} />
            <Text style={[styles.small, { marginTop: 2 }]}>
              {t("fin.officialDetail", { rate: perM2(olv.perM2Buildable), far: fmtNumber(olv.far, lng, 2) })}{" "}
              <Text style={{ color: colors.footprint, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(olv.source.url)}>{t("relax.source")}</Text>
            </Text>
            {r.residualLandValue < olv.total && (
              <Text testID="fin-below-official" style={[styles.small, { marginTop: 4, color: colors.maybe }]}>⚠ {t("fin.belowOfficial")}</Text>
            )}
          </View>
        )}

        {r.withLand && (
          <>
            <SectionTitle>{t("fin.withLand")}</SectionTitle>
            <Row label={t("fin.landFees")} value={money(r.withLand.landFees)} />
            <Row label={t("fin.totalCost")} value={money(r.withLand.totalCost)} />
            <Row label={t("fin.profit")} value={money(r.withLand.profit)} strong />
            <Row label={t("fin.marginGdv")} value={fmtPercent(r.withLand.marginOnGdv, lng)} />
            <Row label={t("fin.marginCost")} value={fmtPercent(r.withLand.marginOnCost, lng)} />
          </>
        )}

        {areas.residentialNetM2 > 0 && (
          <>
            <SectionTitle>{t("fin.rental")}</SectionTitle>
            <Row label={t("fin.rentGross", { rate: perM2(params.rentPerM2Month) })} value={money(r.rental.grossAnnual)} />
            <Row label={t("fin.rentNet", { pct: fmtPercent(params.rentCostsPct, lng) })} value={money(r.rental.netAnnual)} />
            <Row label={t("fin.yieldGdv")} value={fmtPercent(r.rental.netYield, lng)} />
            <Row label={t("fin.yieldCost")} value={fmtPercent(r.rental.onCost, lng)} strong />
          </>
        )}

        <Notice>
          {fd.notes.map((n) => (
            <Text key={n} style={[styles.small, { color: colors.ink }]}>• {t(`fin.note.${n}`)}</Text>
          ))}
        </Notice>
        <Text style={styles.small}>{t("result.sources")}:</Text>
        {fd.sources.map((s) => (
          <Text key={s.url} style={[styles.small, { color: colors.footprint, textDecorationLine: "underline", marginTop: 2 }]} onPress={() => void Linking.openURL(s.url)}>
            {s.label}
          </Text>
        ))}
      </View>
    </Card>
  );
}
