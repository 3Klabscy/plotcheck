import { Linking, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { AnalysisResult, AppliedRelaxation } from "@plotcheck/engine";
import { fmtArea, fmtNumber } from "../lib/format";
import { colors } from "../theme";
import { Card, SectionTitle, styles } from "./ui";

function TierBadge({ tier }: { tier: AppliedRelaxation["tier"] }) {
  const { t } = useTranslation();
  const [fg, bg] = tier === "entitlement" ? [colors.allowed, colors.allowedBg] : tier === "conditional" ? [colors.maybe, colors.maybeBg] : ["#5B3FA8", "#EEE8FB"];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: "700" }}>{t(`tier.${tier}`)}</Text>
    </View>
  );
}

function contributionText(t: ReturnType<typeof useTranslation>["t"], lng: string, a: AppliedRelaxation): string[] {
  const c = a.contribution;
  const out: string[] = [];
  if (c.farAdd) out.push(t("contrib.far", { far: fmtNumber(c.farAdd, lng, 2), gfa: fmtArea(c.gfaM2 ?? 0, lng) }));
  if (c.floorsAdd) out.push(t("contrib.floors", { floors: c.floorsAdd, height: fmtNumber(c.heightAddM ?? 0, lng, 1) }));
  else if (c.heightAddM) out.push(t("contrib.height", { height: fmtNumber(c.heightAddM, lng, 1) }));
  if (c.verandaM2) out.push(t("contrib.veranda", { area: fmtArea(c.verandaM2, lng) }));
  if (c.basementPerLevelM2) out.push(t("contrib.basement", { area: fmtArea(c.basementPerLevelM2, lng) }));
  if (c.setbackM !== undefined) out.push(t("contrib.setback", { m: fmtNumber(c.setbackM, lng, 1) }));
  return out;
}

function Item({ a, showContribution }: { a: AppliedRelaxation; showContribution: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const contrib = showContribution ? contributionText(t, lng, a) : [];
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: colors.line }} testID={`relax-${a.id}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, flex: 1 }}>{t(a.titleKey)}</Text>
        <TierBadge tier={a.tier} />
      </View>
      {contrib.map((c) => (
        <Text key={c} style={{ fontSize: 14, fontWeight: "600", color: colors.accent, marginTop: 4 }}>→ {c}</Text>
      ))}
      <Text style={[styles.small, { color: colors.ink, marginTop: 4 }]}>{t(a.grantKey)}</Text>
      <Text style={[styles.small, { marginTop: 4 }]}>{t(a.conditionsKey)}</Text>
      {a.cost?.noteKey && <Text style={[styles.small, { marginTop: 4, color: colors.maybe }]}>{t(a.cost.noteKey)}</Text>}
      {a.statusNoteKey && <Text style={[styles.small, { marginTop: 4, color: colors.notAllowed }]}>⚠ {t(a.statusNoteKey)}</Text>}
      <Text style={[styles.small, { marginTop: 4 }]}>
        {t("relax.instrument")}: {a.instrument}
        {a.provenance.sourceRef ? (
          <>
            {" · "}
            <Text style={{ color: colors.footprint, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(a.provenance.sourceRef!)}>
              {t("relax.source")}
            </Text>
          </>
        ) : null}
      </Text>
    </View>
  );
}

export function RelaxationsView({ result }: { result: AnalysisResult }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const x = result.relaxed;
  if (!x) return null;
  const f = x.figures;
  const headline =
    x.gain.gfaM2 <= 0.5
      ? t("relax.headline.none")
      : x.units
        ? t("relax.headline.units", { gfa: fmtArea(f.achievableGfaM2, lng), floors: f.feasibleFloors, units: x.units.total, gain: fmtArea(x.gain.gfaM2, lng), gainUnits: x.gain.units })
        : t("relax.headline.area", { gfa: fmtArea(f.achievableGfaM2, lng), floors: f.feasibleFloors, gain: fmtArea(x.gain.gfaM2, lng) });
  const titleOf = (id: string) => {
    const r = [...x.alternativeDetails, ...x.applied].find((a) => a.id === id);
    return r ? t(r.titleKey) : id;
  };

  return (
    <Card style={{ borderColor: "#5B3FA8", borderWidth: 2 }}>
      <SectionTitle>{t("relax.title")}</SectionTitle>
      <Text style={[styles.body, { fontSize: 16, lineHeight: 23, fontWeight: "600" }]} testID="relaxed-headline">{headline}</Text>
      <Text style={[styles.small, { marginTop: 6, marginBottom: 8 }]}>{t("relax.intro")}</Text>

      {x.applied.length > 0 && (
        <>
          <Text style={[styles.h2, { fontSize: 14, marginTop: 6 }]}>{t("relax.applied")}</Text>
          {x.applied.map((a) => <Item key={a.id} a={a} showContribution />)}
        </>
      )}

      {x.alternatives.length > 0 && (
        <>
          <Text style={[styles.h2, { fontSize: 14, marginTop: 12 }]}>{t("relax.alternatives")}</Text>
          {x.alternatives.map((alt) => (
            <Text key={alt.ids.join("+")} style={[styles.small, { color: colors.ink, marginBottom: 4 }]}>
              • {t("relax.alternative", { titles: alt.ids.map(titleOf).join(" + "), far: fmtNumber(alt.farAddTotal, lng, 2) })}
            </Text>
          ))}
          {x.alternativeDetails.map((a) => <Item key={a.id} a={a} showContribution={false} />)}
        </>
      )}

      {x.notes.length > 0 && (
        <>
          <Text style={[styles.h2, { fontSize: 14, marginTop: 12 }]}>{t("relax.notes")}</Text>
          {x.notes.map((a) => <Item key={a.id} a={a} showContribution={false} />)}
        </>
      )}
    </Card>
  );
}
