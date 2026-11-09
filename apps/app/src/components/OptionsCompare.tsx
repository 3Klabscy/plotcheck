import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { UseType } from "@plotcheck/core";
import type { AnalyseResponse } from "../lib/api";
import { fmtArea, fmtMoney, fmtNumber } from "../lib/format";
import { compareOptions, type PriceChoice } from "../lib/options";
import { colors } from "../theme";
import { Card, SectionTitle, StatusBadge, styles } from "./ui";

/** Every allowed building type side by side: what gets built, what it sells for, what it costs. */
export function OptionsCompare({ data, priceFor, selected, onPick }: { data: AnalyseResponse; priceFor(u: UseType): PriceChoice | undefined; selected?: UseType; onPick(u: UseType): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const anyRelaxed = data.results.some((r) => r.relaxed && r.relaxed.gain.gfaM2 > 0.5);
  const [relaxed, setRelaxed] = useState(anyRelaxed);
  const rows = compareOptions(data, { relaxed, priceFor });
  if (rows.length === 0) return null;
  const money = (n: number) => fmtMoney(n, lng);
  const best = rows[0]!;

  return (
    <Card>
      <View testID="options-compare">
        <SectionTitle>{t("opt.title")}</SectionTitle>
        <Text style={[styles.small, { marginBottom: 8 }]}>{t("opt.intro")}</Text>
        {anyRelaxed && (
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
            {[false, true].map((v) => (
              <Pressable key={String(v)} testID={`opt-relaxed-${v}`} onPress={() => setRelaxed(v)}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: relaxed === v ? colors.accent : colors.line, backgroundColor: relaxed === v ? colors.allowedBg : colors.panel }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: relaxed === v ? colors.accent : colors.ink }}>{t(v ? "fin.scenario.relaxed" : "fin.scenario.base")}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {rows.map((o) => {
          const f = o.finance;
          const what =
            o.units !== undefined ? t("opt.units", { count: o.units }) : o.houses !== undefined ? t("opt.houses", { count: o.houses }) : t("opt.space");
          return (
            <Pressable key={o.use} testID={`opt-${o.use}`} onPress={() => onPick(o.use)}
              style={({ pressed }) => [{ borderWidth: selected === o.use ? 2 : 1, borderColor: selected === o.use ? colors.accent : colors.line, borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: colors.panel }, pressed && { opacity: 0.85 }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink, flex: 1 }}>
                  {t(`use.${o.use}`)}{o === best && f.residualLandValue > 0 ? `  ★ ${t("opt.best")}` : ""}
                </Text>
                <StatusBadge status={o.result.status} />
              </View>
              <Text style={[styles.small, { color: colors.ink, marginBottom: 6 }]}>
                {what} · {fmtArea(o.gfaM2, lng)} · {t("result.floorsShort", { count: o.floors })} · {t("opt.sellable", { area: fmtArea(o.areas.residentialNetM2 + o.areas.commercialNetM2, lng) })}
              </Text>
              <Line label={t("opt.price")} value={`${money(o.price.perM2)}/m²`} hint={o.price.source === "comparables" ? t("opt.fromComparables", { count: o.price.count ?? 0 }) : t("opt.estimate")} />
              <Line label={t("opt.gdv")} value={money(f.gdv)} strong />
              <Line label={t("opt.buildCost")} value={money(f.hardCost)} hint={t("opt.perM2", { value: money(Math.round(f.hardCost / o.gfaM2)) })} />
              <Line label={t("opt.devCost")} value={money(f.devCost)} />
              <Line label={t("opt.residual")} value={money(f.residualLandValue)} strong color={f.residualLandValue > 0 ? colors.allowed : colors.notAllowed} />
            </Pressable>
          );
        })}
        <Text style={styles.small}>{t("opt.note", { profit: fmtNumber((data.finance?.byUse[best.use].targetProfitPctOfGdv ?? 0) * 100, lng) })}</Text>
      </View>
    </Card>
  );
}

function Line({ label, value, hint, strong, color }: { label: string; value: string; hint?: string; strong?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 13, color: colors.muted, flexShrink: 1 }}>
        {label}
        {hint ? <Text style={{ fontSize: 11 }}> · {hint}</Text> : null}
      </Text>
      <Text style={{ fontSize: 13, color: color ?? colors.ink, fontWeight: strong ? "700" : "400", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}
