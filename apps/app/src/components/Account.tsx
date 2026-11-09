import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAccount, type SavedPlot } from "../lib/account";
import { fmtArea } from "../lib/format";
import { colors } from "../theme";
import { Button, Card, SectionTitle, styles } from "./ui";

const field = { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.ink, backgroundColor: colors.panel };

/** Header control: "Sign in" or the signed-in e-mail with "Sign out". */
export function AccountButton({ onSignIn }: { onSignIn(): void }) {
  const { t } = useTranslation();
  const acc = useAccount();
  if (!acc.enabled) return null;
  if (!acc.session)
    return (
      <Pressable testID="btn-signin" onPress={onSignIn} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.accent }}>
        <Text style={{ fontWeight: "700", color: colors.accent, fontSize: 13 }}>{t("acc.signIn")}</Text>
      </Pressable>
    );
  return (
    <Pressable testID="btn-signout" onPress={() => void acc.signOut()} accessibilityLabel={t("acc.signOut")} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.line, maxWidth: 170 }}>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.ink }}>{acc.email}</Text>
      <Text style={{ fontSize: 11, color: colors.muted }}>{t("acc.signOut")}</Text>
    </Pressable>
  );
}

/** E-mail → 6-digit code → signed in. */
export function SignInCard({ onDone, reason }: { onDone(): void; reason?: string }) {
  const { t } = useTranslation();
  const acc = useAccount();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("auth_email");
    setBusy(true);
    const e = await acc.sendCode(email);
    setBusy(false);
    if (e) return setErr(e);
    setErr(undefined);
    setSent(true);
  };
  const verify = async () => {
    setBusy(true);
    const e = await acc.verifyCode(email, code);
    setBusy(false);
    if (e) return setErr(e);
    onDone();
  };
  return (
    <Card style={{ borderColor: colors.accent, borderWidth: 2 }}>
      <View testID="signin">
        <Text style={styles.h2}>{t("acc.title")}</Text>
        <Text style={[styles.small, { marginBottom: 10 }]}>{reason ?? t("acc.why")}</Text>
        {!sent ? (
          <>
            <TextInput testID="signin-email" value={email} onChangeText={setEmail} placeholder={t("acc.email")} placeholderTextColor={colors.muted} inputMode="email" autoCapitalize="none" autoComplete="email" onSubmitEditing={send} style={field} />
            <Button title={busy ? "…" : t("acc.sendCode")} onPress={send} disabled={busy} testID="signin-send" />
          </>
        ) : (
          <>
            <Text style={[styles.body, { marginBottom: 6 }]}>{t("acc.codeSent", { email: email.trim() })}</Text>
            <TextInput testID="signin-code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} placeholder="123456" placeholderTextColor={colors.muted} inputMode="numeric" autoComplete="one-time-code" onSubmitEditing={verify} style={[field, { fontSize: 22, letterSpacing: 6, textAlign: "center" }]} />
            <Button title={busy ? "…" : t("acc.verify")} onPress={verify} disabled={busy || code.length < 6} testID="signin-verify" />
            <Pressable onPress={() => { setSent(false); setCode(""); }} style={{ marginTop: 8 }}><Text style={{ color: colors.footprint, fontSize: 13 }}>{t("acc.otherEmail")}</Text></Pressable>
          </>
        )}
        {err && <Text testID="signin-error" style={[styles.small, { color: colors.notAllowed, marginTop: 8 }]}>{t(`error.${err}`, { defaultValue: t("error.generic") })}</Text>}
        <Pressable onPress={onDone} style={{ marginTop: 10 }}><Text style={{ color: colors.muted, fontSize: 13 }}>{t("acc.cancel")}</Text></Pressable>
        <Text style={[styles.small, { marginTop: 10 }]}>{t("acc.privacy")}</Text>
      </View>
    </Card>
  );
}

/** "My plots": open, rename note, delete. */
export function SavedPlotsCard({ onOpen, currentRef }: { onOpen(p: SavedPlot): void; currentRef?: string }) {
  const { t, i18n } = useTranslation();
  const acc = useAccount();
  if (!acc.session || acc.plots.length === 0) return null;
  const date = (s: string) => new Intl.DateTimeFormat(i18n.language.startsWith("el") ? "el-GR" : "en-GB", { day: "numeric", month: "short" }).format(new Date(s));
  return (
    <Card>
      <View testID="saved-plots">
        <SectionTitle>{t("acc.myPlots", { count: acc.plots.length })}</SectionTitle>
        {acc.plots.map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}>
            <Pressable style={{ flex: 1 }} onPress={() => onOpen(p)} testID={`saved-${p.national_ref}`}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: p.national_ref === currentRef ? colors.accent : colors.ink }}>
                {p.label ?? p.national_ref}{p.zone_code ? ` · ${p.zone_code}` : ""}{p.area_m2 ? ` · ${fmtArea(p.area_m2, i18n.language)}` : ""}
              </Text>
              <Text style={styles.small} numberOfLines={2}>
                {[p.national_ref, p.use_type ? t(`use.${p.use_type}`) : "", p.comparables.length ? t("acc.nComparables", { count: p.comparables.length }) : "", p.drawings.features.length ? t("map.drawings", { count: p.drawings.features.length }) : "", date(p.updated_at)].filter(Boolean).join(" · ")}
              </Text>
              {p.note ? <Text style={[styles.small, { color: colors.ink }]} numberOfLines={2}>“{p.note}”</Text> : null}
            </Pressable>
            <Pressable onPress={() => void acc.removePlot(p.id)} accessibilityLabel={t("map.delete")} testID={`saved-delete-${p.national_ref}`}><Text style={{ color: colors.notAllowed, fontSize: 15 }}>🗑</Text></Pressable>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Save button + note for the plot on screen. */
export function SavePlotBar({ saved, onSave, onNote, onNeedSignIn }: { saved?: SavedPlot; onSave(): Promise<void>; onNote(note: string): void; onNeedSignIn(): void }) {
  const { t } = useTranslation();
  const acc = useAccount();
  const [note, setNote] = useState(saved?.note ?? "");
  const [busy, setBusy] = useState(false);
  if (!acc.enabled) return null;
  if (!saved)
    return (
      <Button
        title={busy ? "…" : `☆ ${t("acc.save")}`}
        kind="secondary"
        testID="save-plot"
        disabled={busy}
        onPress={async () => {
          if (!acc.session) return onNeedSignIn();
          setBusy(true);
          try { await onSave(); } finally { setBusy(false); }
        }}
      />
    );
  return (
    <View style={{ marginTop: 10 }} testID="saved-bar">
      <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 13 }}>★ {t("acc.saved")}</Text>
      <TextInput testID="saved-note" value={note} onChangeText={setNote} onBlur={() => onNote(note)} placeholder={t("acc.notePlaceholder")} placeholderTextColor={colors.muted} multiline
        style={[field, { marginTop: 6, minHeight: 44, fontSize: 13 }]} />
    </View>
  );
}
