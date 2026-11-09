import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Parcel } from "@plotcheck/core";
import { api, ApiError, type PlotSearchIndex } from "../lib/api";
import { colors } from "../theme";
import { Select, type Option } from "./Select";
import { Button, Loading, Notice, styles } from "./ui";

/**
 * "Enter plot details": Municipality → Quarter → Sheet/Plan → Block → Plot number.
 * Each choice narrows the next, from the official DLS references (index served by the API).
 */
export function PlotSearch({ country, region, onFound }: { country: string; region: string; onFound(p: Parcel): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [index, setIndex] = useState<PlotSearchIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [muni, setMuni] = useState<string>();
  const [quarter, setQuarter] = useState<string>();
  const [sheet, setSheet] = useState<string>();
  const [block, setBlock] = useState<string>();
  const [plot, setPlot] = useState("");

  useEffect(() => {
    api.plotIndex(country, region).then(setIndex).catch((e: ApiError) => setError(e.code ?? "generic"));
  }, [country, region]);

  const m = index?.municipalities.find((x) => x.code === muni);
  const name = (o: { el?: string | null; en?: string | null }, fallback: string) => (lng === "el" ? o.el : o.en) ?? o.el ?? fallback;

  const muniOptions: Option[] = useMemo(
    () => (index?.municipalities ?? []).map((x) => ({ value: x.code, label: name(x, x.code), hint: x.code })).sort((a, b) => a.label.localeCompare(b.label, lng)),
    [index, lng],
  );
  const quarterOptions: Option[] = useMemo(() => {
    if (!m) return [];
    const qs = new Set(Object.values(m.sheets).flatMap((blocks) => Object.keys(blocks).map((k) => k.split("-")[0]!)));
    return [...qs].sort((a, b) => Number(a) - Number(b)).map((q) => {
      const info = m.quarters.find((x) => x.code === `${m.code}${q.padStart(2, "0")}`);
      return { value: q, label: info ? name(info, q) : `${t("cy.field.quarter")} ${q}`, hint: q };
    });
  }, [m, lng]);
  const sheetOptions: Option[] = useMemo(() => {
    if (!m || !quarter) return [];
    return Object.entries(m.sheets)
      .filter(([, blocks]) => Object.keys(blocks).some((k) => k.split("-")[0] === quarter))
      .map(([s, blocks]) => ({ value: s, label: s, hint: t("search.plots", { count: Object.entries(blocks).filter(([k]) => k.split("-")[0] === quarter).reduce((a, [, n]) => a + n, 0) }) }));
  }, [m, quarter, lng]);
  const blockOptions: Option[] = useMemo(() => {
    if (!m || !quarter || !sheet) return [];
    return Object.entries(m.sheets[sheet] ?? {})
      .filter(([k]) => k.split("-")[0] === quarter)
      .map(([k, n]) => ({ value: k.split("-")[1]!, label: k.split("-")[1]!, hint: t("search.plots", { count: n }) }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }, [m, quarter, sheet, lng]);

  // auto-pick single options
  useEffect(() => { if (quarterOptions.length === 1) setQuarter(quarterOptions[0]!.value); }, [quarterOptions]);
  useEffect(() => { if (sheetOptions.length === 1) setSheet(sheetOptions[0]!.value); }, [sheetOptions]);
  useEffect(() => { if (blockOptions.length === 1) setBlock(blockOptions[0]!.value); }, [blockOptions]);

  async function search() {
    if (!muni || !quarter || !sheet || !block || !plot.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.parcelsById(country, { municipalityCode: muni, quarter, sheetPlan: sheet, block, plot: plot.trim() });
      const p = r.parcels[0];
      if (p) onFound(p);
      else setError("parcel_not_found");
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "generic");
    } finally {
      setBusy(false);
    }
  }

  if (!index) return error ? <Notice tone="error"><Text style={styles.body}>{t(`error.${error}`, { defaultValue: t("error.generic") })}</Text></Notice> : <Loading label={t("loading.config")} />;

  return (
    <View testID="plot-search">
      <Select label={t("cy.field.municipality")} value={muni} options={muniOptions} testID="sel-muni"
        onChange={(v) => { setMuni(v); setQuarter(undefined); setSheet(undefined); setBlock(undefined); }} />
      <Select label={t("cy.field.quarter")} value={quarter} options={quarterOptions} disabled={!muni} testID="sel-quarter"
        onChange={(v) => { setQuarter(v); setSheet(undefined); setBlock(undefined); }} />
      <Select label={t("cy.field.sheetPlan")} value={sheet} options={sheetOptions} disabled={!quarter} testID="sel-sheet"
        onChange={(v) => { setSheet(v); setBlock(undefined); }} />
      <Select label={t("cy.field.block")} value={block} options={blockOptions} disabled={!sheet} testID="sel-block" onChange={setBlock} />
      <Text style={[styles.small, { marginBottom: 4, color: colors.ink, fontWeight: "600" }]}>{t("cy.field.plot")}</Text>
      <TextInput
        value={plot}
        onChangeText={setPlot}
        editable={!!block}
        placeholder={t("search.plotHint")}
        inputMode="numeric"
        onSubmitEditing={search}
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: block ? colors.panel : "#F1F0EB" }}
        testID="plot-number"
      />
      {error && (
        <Text style={[styles.small, { color: colors.notAllowed, marginTop: 8 }]}>{t(`error.${error}`, { defaultValue: t("error.generic") })}</Text>
      )}
      <Button title={busy ? t("loading.parcel") : t("search.button")} onPress={search} disabled={busy || !block || !plot.trim()} testID="search-go" />
      <Text style={[styles.small, { marginTop: 8 }]}>{t("search.source", { count: index.municipalities.length })}</Text>
    </View>
  );
}
