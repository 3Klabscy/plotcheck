import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Parcel } from "@plotcheck/core";
import { api, ApiError, type PlotSearchIndex, type StreetHit } from "../lib/api";
import { fmtArea } from "../lib/format";
import { colors } from "../theme";
import { Select, type Option } from "./Select";
import { Button, Loading, Notice, styles } from "./ui";

type SearchMode = "sheet" | "plot" | "address" | "registration";

/**
 * Plot search the way the DLS portal offers it:
 *  - by sheet/plan: Municipality → Quarter → Sheet/Plan → Block → Plot number (one exact plot);
 *  - by plot: Municipality (+ quarter) + plot number → every matching plot, to pick from;
 *  - by address: street name → the map moves there;
 *  - by registration number: needs DLS eServices access (not in the open data), shown disabled.
 * Choices come from the official DLS references (index served by the API).
 */
export function PlotSearch({ country, region, onFound, onCandidates, onStreet }: { country: string; region: string; onFound(p: Parcel): void; onCandidates?(ps: Parcel[]): void; onStreet?(s: StreetHit): void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SearchMode>("sheet");
  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }} accessibilityRole="tablist">
        {(["sheet", "plot", "address", "registration"] as const).map((m) => (
          <Pressable key={m} testID={`search-mode-${m}`} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: mode === m ? colors.accent : colors.line, backgroundColor: mode === m ? colors.allowedBg : colors.panel }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: mode === m ? colors.accent : m === "registration" ? colors.muted : colors.ink }}>{t(`search.mode.${m}`)}</Text>
          </Pressable>
        ))}
      </View>
      {mode === "address" ? (
        <StreetSearch country={country} onStreet={onStreet} />
      ) : mode === "registration" ? (
        <Notice tone="info"><Text style={styles.small} testID="registration-note">{t("search.registrationNote")}</Text></Notice>
      ) : (
        <SheetOrPlotSearch key={mode} mode={mode} country={country} region={region} onFound={onFound} onCandidates={onCandidates} />
      )}
    </View>
  );
}

function StreetSearch({ country, onStreet }: { country: string; onStreet?(s: StreetHit): void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StreetHit[]>([]);
  const [picked, setPicked] = useState<number>();
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const ac = new AbortController();
    const h = setTimeout(() => api.streets(country, q, ac.signal).then((r) => setHits(r.streets)).catch(() => undefined), 250);
    return () => { clearTimeout(h); ac.abort(); };
  }, [q, country]);
  return (
    <View testID="street-search">
      <Text style={[styles.small, { marginBottom: 4, color: colors.ink, fontWeight: "600" }]}>{t("search.street")}</Text>
      <TextInput value={q} onChangeText={(v) => { setQ(v); setPicked(undefined); }} placeholder={t("search.streetHint")} testID="street-q"
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: colors.panel }} />
      {hits.map((h, i) => (
        <Pressable key={`${h.name}-${i}`} testID={`street-${i}`} onPress={() => { setPicked(i); onStreet?.(h); }}
          style={{ paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: picked === i ? colors.allowedBg : undefined }}>
          <Text style={{ fontSize: 14, color: colors.ink, fontWeight: "600" }}>{h.name}{h.part ? ` · ${t("search.part", { n: h.part.n, of: h.part.of })}` : ""}</Text>
          <Text style={styles.small}>{t("search.postcodes", { codes: h.postcodes.slice(0, 6).join(", ") })}</Text>
        </Pressable>
      ))}
      {q.trim().length >= 2 && hits.length === 0 && <Text style={[styles.small, { marginTop: 8 }]}>{t("search.noStreets")}</Text>}
      {picked !== undefined && <Text style={[styles.small, { marginTop: 8, color: colors.accent }]}>{t("search.streetThen")}</Text>}
      <Text style={[styles.small, { marginTop: 8 }]}>{t("search.streetSource")}</Text>
    </View>
  );
}

function SheetOrPlotSearch({ mode, country, region, onFound, onCandidates }: { mode: "sheet" | "plot"; country: string; region: string; onFound(p: Parcel): void; onCandidates?(ps: Parcel[]): void }) {
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
  useEffect(() => { if (mode === "sheet" && sheetOptions.length === 1) setSheet(sheetOptions[0]!.value); }, [sheetOptions, mode]);
  useEffect(() => { if (mode === "sheet" && blockOptions.length === 1) setBlock(blockOptions[0]!.value); }, [blockOptions, mode]);

  const ready = mode === "sheet" ? !!(muni && quarter && sheet && block && plot.trim()) : !!(muni && plot.trim());
  const [matches, setMatches] = useState<Parcel[] | null>(null);

  async function search() {
    if (!ready || !muni) return;
    setBusy(true);
    setError(null);
    setMatches(null);
    try {
      if (mode === "plot") {
        const r = await api.parcelsSearch(country, { municipalityCode: muni, ...(quarter ? { quarter } : {}), ...(sheet ? { sheetPlan: sheet } : {}), ...(block ? { block } : {}), plot: plot.trim() });
        if (r.parcels.length === 1) onFound(r.parcels[0]!);
        else if (r.parcels.length === 0) setError("parcel_not_found");
        else { setMatches(r.parcels); onCandidates?.(r.parcels); }
        return;
      }
      const r = await api.parcelsById(country, { municipalityCode: muni!, quarter: quarter!, sheetPlan: sheet!, block: block!, plot: plot.trim() });
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

  const optional = mode === "plot" ? ` (${t("search.optional")})` : "";
  return (
    <View testID="plot-search">
      <Select label={t("cy.field.district")} value="4" options={[{ value: "4", label: t("search.district.larnaca") }]} testID="sel-district" onChange={() => undefined} />
      <Select label={t("cy.field.municipality")} value={muni} options={muniOptions} testID="sel-muni"
        onChange={(v) => { setMuni(v); setQuarter(undefined); setSheet(undefined); setBlock(undefined); }} />
      <Select label={t("cy.field.quarter") + optional} value={quarter} options={quarterOptions} disabled={!muni} testID="sel-quarter"
        onChange={(v) => { setQuarter(v); setSheet(undefined); setBlock(undefined); }} />
      <Select label={t("cy.field.sheetPlan") + optional} value={sheet} options={sheetOptions} disabled={!quarter} testID="sel-sheet"
        onChange={(v) => { setSheet(v); setBlock(undefined); }} />
      <Select label={t("cy.field.block") + optional} value={block} options={blockOptions} disabled={!sheet} testID="sel-block" onChange={setBlock} />
      <Text style={[styles.small, { marginBottom: 4, color: colors.ink, fontWeight: "600" }]}>{t("cy.field.plot")}</Text>
      <TextInput
        value={plot}
        onChangeText={setPlot}
        editable={mode === "plot" ? !!muni : !!block}
        placeholder={t("search.plotHint")}
        inputMode="numeric"
        onSubmitEditing={search}
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: (mode === "plot" ? muni : block) ? colors.panel : "#F1F0EB" }}
        testID="plot-number"
      />
      {error && (
        <Text style={[styles.small, { color: colors.notAllowed, marginTop: 8 }]}>{t(`error.${error}`, { defaultValue: t("error.generic") })}</Text>
      )}
      <Button title={busy ? t("loading.parcel") : t("search.button")} onPress={search} disabled={busy || !ready} testID="search-go" />
      {matches && (
        <View style={{ marginTop: 10 }} testID="search-matches">
          <Text style={[styles.small, { fontWeight: "700", color: colors.ink, marginBottom: 4 }]}>{t("search.matches", { count: matches.length })}</Text>
          {matches.map((p) => {
            const [, sh, qu, bl] = p.nationalRef.split("-");
            const qi = m?.quarters.find((x) => x.code === `${m.code}${(qu ?? "").padStart(2, "0")}`);
            return (
              <Pressable key={p.nationalRef} testID={`match-${p.nationalRef}`} onPress={() => onFound(p)}
                style={{ paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.line }}>
                <Text style={{ fontSize: 14, color: colors.ink, fontWeight: "600" }}>
                  {t("search.matchLine", { plot: p.label ?? plot, sheet: sh, block: bl })}
                </Text>
                <Text style={styles.small}>{[qi ? name(qi, qu ?? "") : qu, p.officialAreaM2 !== undefined ? fmtArea(p.officialAreaM2, lng) : ""].filter(Boolean).join(" · ")}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={[styles.small, { marginTop: 8 }]}>{t("search.source", { count: index.municipalities.length })}</Text>
    </View>
  );
}
