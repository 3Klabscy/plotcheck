import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { api, type AccessInfo, type Plan, type RelaxedPreview } from "../lib/api";
import { useAccount } from "../lib/account";
import { fmtArea, fmtMoney } from "../lib/format";
import { colors } from "../theme";
import { Button, Card, styles } from "./ui";

const go = (url: string) => (Platform.OS === "web" ? window.location.assign(url) : void Linking.openURL(url));

/** What the paid analysis adds, and the ways to get it: one plot (report) or a subscription. */
export function Paywall({ country, nationalRef, preview, onNeedSignIn }: { country: string; nationalRef: string; preview?: RelaxedPreview; onNeedSignIn(reason: string): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language.startsWith("el") ? "el" : "en";
  const acc = useAccount();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [providers, setProviders] = useState({ stripe: false, jcc: false });
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    api.plans().then((r) => { setPlans(r.plans); setProviders(r.providers); }).catch(() => undefined);
  }, []);
  const price = (p: Plan) => `${fmtMoney(p.price_cents / 100, i18n.language, p.currency)}${p.interval ? ` / ${t(`pay.per.${p.interval}`)}` : ""}`;

  const buy = async (p: Plan, provider: "stripe" | "jcc") => {
    if (!acc.session) return onNeedSignIn(t("pay.signInFirst"));
    setBusy(`${p.id}-${provider}`);
    setErr(undefined);
    try {
      const { url } = await api.checkout(p.id, provider, p.kind === "report" ? country : undefined, p.kind === "report" ? nationalRef : undefined);
      go(url);
    } catch (e) {
      setErr((e as { code?: string }).code ?? "generic");
      setBusy(undefined);
    }
  };

  return (
    <Card style={{ borderColor: "#5B3FA8", borderWidth: 2 }}>
      <View testID="paywall">
        <Text style={styles.h2}>{t("pay.title")}</Text>
        {preview && preview.gainM2 > 0.5 && (
          <Text style={[styles.body, { fontWeight: "600", marginBottom: 6 }]} testID="paywall-preview">
            {preview.units
              ? t("pay.previewUnits", { gfa: fmtArea(preview.gfaM2, i18n.language), floors: preview.floors, units: preview.units, gain: fmtArea(preview.gainM2, i18n.language) })
              : t("pay.previewArea", { gfa: fmtArea(preview.gfaM2, i18n.language), floors: preview.floors, gain: fmtArea(preview.gainM2, i18n.language) })}
          </Text>
        )}
        <Text style={[styles.small, { marginBottom: 10, color: colors.ink }]}>{t("pay.includes")}</Text>
        {plans.map((p) => (
          <View key={p.id} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginBottom: 8 }} testID={`plan-${p.id}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink, flex: 1 }}>{p.name[lng] ?? p.id}</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.accent }}>{price(p)}</Text>
            </View>
            {p.description[lng] ? <Text style={[styles.small, { marginTop: 2 }]}>{p.description[lng]}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {providers.stripe && (
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Button title={busy === `${p.id}-stripe` ? "…" : t(p.kind === "report" ? "pay.buyCard" : "pay.subscribe")} onPress={() => void buy(p, "stripe")} disabled={!!busy} testID={`buy-${p.id}-stripe`} />
                </View>
              )}
              {providers.jcc && p.kind === "report" && (
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Button title={busy === `${p.id}-jcc` ? "…" : t("pay.buyJcc")} kind="secondary" onPress={() => void buy(p, "jcc")} disabled={!!busy} testID={`buy-${p.id}-jcc`} />
                </View>
              )}
            </View>
          </View>
        ))}
        {!providers.stripe && !providers.jcc && plans.length > 0 && <Text style={styles.small}>{t("pay.noProvider")}</Text>}
        {err && <Text style={[styles.small, { color: colors.notAllowed }]} testID="paywall-error">{t(`error.${err}`, { defaultValue: t("error.generic") })}</Text>}
        <Text style={[styles.small, { marginTop: 4 }]}>{t("pay.note")}</Text>
      </View>
    </Card>
  );
}

/** Signed-in user's subscription line with "Manage" (Stripe customer portal). */
export function SubscriptionLine({ access }: { access?: AccessInfo }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const s = access?.subscription;
  if (!s) return null;
  const until = s.current_period_end ? new Intl.DateTimeFormat(i18n.language.startsWith("el") ? "el-GR" : "en-GB", { dateStyle: "medium" }).format(new Date(s.current_period_end)) : "";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }} testID="subscription">
      <Text style={[styles.small, { color: colors.ink, flex: 1 }]}>
        {t(s.cancel_at_period_end ? "pay.subEnds" : "pay.subActive", { until })}
      </Text>
      <Pressable
        testID="manage-subscription"
        onPress={async () => {
          setBusy(true);
          try { go((await api.portal()).url); } finally { setBusy(false); }
        }}
      >
        <Text style={{ color: colors.footprint, fontWeight: "600", fontSize: 12 }}>{busy ? "…" : t("pay.manage")}</Text>
      </Pressable>
    </View>
  );
}
