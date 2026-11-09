import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { comparableStats, type ComparableKind, type ComparableSale, type ComparableStats } from "@plotcheck/engine";
import type { MarketStats } from "../lib/api";
import { ComparablesError, parseCsv, parseDate, parseNumber, rowsToComparables, type Cell } from "../lib/comparables";
import { fmtArea, fmtMoney, fmtNumber, fmtPercent } from "../lib/format";
import { colors } from "../theme";
import { Button, Card, SectionTitle, styles } from "./ui";

const KINDS: (ComparableKind | "all")[] = ["apartment", "house", "commercial", "land", "all"];

const monthLabel = (ym: string, lng: string) =>
  new Intl.DateTimeFormat(lng.startsWith("el") ? "el-GR" : "en-GB", { month: "short", year: "numeric" }).format(new Date(`${ym.slice(0, 7)}-15T00:00:00Z`));

/** Stats for the comparables of one kind over the chosen period. */
export function statsFor(sales: ComparableSale[], kind: ComparableKind | "all", months: number, asOf = new Date()): ComparableStats | undefined {
  return comparableStats(sales, { asOf, months, kind });
}

async function readFile(file: File, fallbackKind: ComparableKind) {
  const name = file.name.toLowerCase();
  let rows: Cell[][];
  if (name.endsWith(".xlsx")) {
    const { default: readXlsx } = await import("read-excel-file");
    rows = (await readXlsx(file)) as Cell[][];
  } else if (name.endsWith(".csv") || name.endsWith(".txt")) rows = parseCsv(await file.text());
  else throw new ComparablesError("unsupported");
  return rowsToComparables(rows, fallbackKind);
}

export function ComparablesCard({ sales, onChange, kind, onKind, months, onMonths, market, countryCode }: {
  sales: ComparableSale[];
  onChange(s: ComparableSale[]): void;
  kind: ComparableKind | "all";
  onKind(k: ComparableKind | "all"): void;
  months: number;
  onMonths(m: number): void;
  market?: MarketStats;
  countryCode: string;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [msg, setMsg] = useState<{ text: string; ok: boolean }>();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ date: "", price: "", area: "", kind: kind === "all" ? "apartment" : kind } as { date: string; price: string; area: string; kind: ComparableKind });
  const [showList, setShowList] = useState(false);
  const st = statsFor(sales, kind, months);
  const money = (n: number) => fmtMoney(n, lng);

  const importFile = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx,.txt";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const r = await readFile(f, kind === "all" ? "apartment" : kind);
        onChange([...sales, ...r.sales]);
        setMsg({ ok: true, text: t("comp.imported", { count: r.sales.length, skipped: r.skipped, columns: Object.values(r.columns).join(", ") }) });
      } catch (e) {
        setMsg({ ok: false, text: t(`comp.error.${e instanceof ComparablesError ? e.message : "bad_file"}`) });
      }
    };
    input.click();
  };

  const add = () => {
    const date = parseDate(form.date), price = parseNumber(form.price), area = parseNumber(form.area);
    if (!date || !price || !area) return setMsg({ ok: false, text: t("comp.error.form") });
    onChange([...sales, { date, price, areaM2: area, kind: form.kind }]);
    setForm({ ...form, date: "", price: "", area: "" });
    setMsg(undefined);
  };

  const input = (key: "date" | "price" | "area", placeholder: string, flex = 1) => (
    <TextInput testID={`comp-${key}`} value={form[key]} onChangeText={(v) => setForm({ ...form, [key]: v })} placeholder={placeholder} placeholderTextColor={colors.muted}
      style={{ flex, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: colors.ink, minWidth: 70 }} />
  );
  const chip = (on: boolean) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.allowedBg : colors.panel });

  return (
    <Card>
      <View testID="comparables">
        <SectionTitle>{t("comp.title", { months })}</SectionTitle>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {KINDS.map((k) => (
            <Pressable key={k} testID={`comp-kind-${k}`} onPress={() => onKind(k)} style={chip(kind === k)}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: kind === k ? colors.accent : colors.ink }}>{t(`comp.kind.${k}`)}</Text>
            </Pressable>
          ))}
          {[6, 12].map((m) => (
            <Pressable key={m} testID={`comp-months-${m}`} onPress={() => onMonths(m)} style={chip(months === m)}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: months === m ? colors.accent : colors.ink }}>{t("comp.months", { count: m })}</Text>
            </Pressable>
          ))}
        </View>

        {st ? (
          <View testID="comp-stats" style={{ backgroundColor: colors.allowedBg, borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("comp.average", { value: `${money(st.meanPerM2)}/m²` })}</Text>
            <Text style={[styles.small, { color: colors.ink }]}>
              {t("comp.detail", { median: `${money(st.medianPerM2)}/m²`, min: money(st.minPerM2), max: money(st.maxPerM2), count: st.used.length, from: st.from, to: st.to })}
            </Text>
            {st.excluded.length > 0 && <Text style={styles.small}>{t("comp.excluded", { count: st.excluded.length })}</Text>}
          </View>
        ) : (
          <Text style={[styles.small, { marginBottom: 8 }]} testID="comp-empty">{sales.length ? t("comp.noneInPeriod") : t("comp.none")}</Text>
        )}

        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 140 }}><Button title={t("comp.import")} kind="secondary" onPress={importFile} testID="comp-import" /></View>
          <View style={{ flex: 1, minWidth: 140 }}><Button title={t("comp.add")} kind="secondary" onPress={() => setAdding((a) => !a)} testID="comp-add" /></View>
        </View>

        {adding && (
          <View style={{ marginTop: 10, gap: 6 }} testID="comp-form">
            <View style={{ flexDirection: "row", gap: 6 }}>
              {input("date", t("comp.f.date"))}
              {input("area", t("comp.f.area"), 0.8)}
              {input("price", t("comp.f.price"))}
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {(["apartment", "house", "commercial", "land"] as const).map((k) => (
                <Pressable key={k} onPress={() => setForm({ ...form, kind: k })} style={chip(form.kind === k)}>
                  <Text style={{ fontSize: 12, color: form.kind === k ? colors.accent : colors.ink }}>{t(`comp.kind.${k}`)}</Text>
                </Pressable>
              ))}
              <Pressable testID="comp-save" onPress={add} style={{ backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{t("comp.save")}</Text>
              </Pressable>
            </View>
          </View>
        )}
        {msg && <Text testID="comp-msg" style={[styles.small, { marginTop: 6, color: msg.ok ? colors.allowed : colors.notAllowed }]}>{msg.text}</Text>}

        {sales.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Pressable onPress={() => setShowList((s) => !s)} testID="comp-list-toggle">
              <Text style={{ fontSize: 12, color: colors.footprint, fontWeight: "600" }}>{showList ? t("comp.hideList") : t("comp.showList", { count: sales.length })}</Text>
            </Pressable>
            {showList && (
              <View style={{ marginTop: 6 }}>
                {[...sales].sort((a, b) => b.date.localeCompare(a.date)).map((s, i) => {
                  const used = st?.used.includes(s), excl = st?.excluded.includes(s);
                  return (
                    <View key={`${s.date}-${s.price}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.line, opacity: used ? 1 : 0.5 }}>
                      <Text style={{ fontSize: 12, color: colors.ink, flex: 1 }} numberOfLines={1}>
                        {s.date} · {t(`comp.kind.${s.kind}`)}{s.label ? ` · ${s.label}` : ""}
                      </Text>
                      <Text style={{ fontSize: 12, color: excl ? colors.notAllowed : colors.ink, fontVariant: ["tabular-nums"] }}>
                        {fmtArea(s.areaM2, lng)} · {money(s.price)} · {money(s.price / s.areaM2)}/m²
                      </Text>
                      <Pressable onPress={() => onChange(sales.filter((x) => x !== s))} accessibilityLabel={t("map.delete")}><Text style={{ color: colors.notAllowed }}>✕</Text></Pressable>
                    </View>
                  );
                })}
                <Pressable onPress={() => onChange([])} style={{ marginTop: 6 }}><Text style={{ fontSize: 12, color: colors.notAllowed, fontWeight: "600" }}>{t("map.clearAll")}</Text></Pressable>
              </View>
            )}
          </View>
        )}

        <Text style={[styles.small, { marginTop: 10 }]}>{t([`${countryCode.toLowerCase()}.comp.howTo`, "comp.howTo"])}</Text>

        {market && (
          <View testID="market" style={{ marginTop: 10, borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{t("comp.market.title", { area: market.area, from: monthLabel(market.from, lng), to: monthLabel(market.to, lng) })}</Text>
            <Text style={[styles.small, { color: colors.ink }]}>
              {t("comp.market.line", { sales: fmtNumber(market.sales, lng), avg: money(market.avgValuePerSale) })}
              {market.changeVsYearBefore !== undefined ? ` ${t("comp.market.change", { pct: `${market.changeVsYearBefore >= 0 ? "+" : ""}${fmtPercent(market.changeVsYearBefore, lng)}` })}` : ""}
            </Text>
            <Text style={styles.small}>{t("comp.market.note")} {market.source.label}</Text>
          </View>
        )}
      </View>
    </Card>
  );
}
