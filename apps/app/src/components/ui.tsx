import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import type { CheckStatus } from "@plotcheck/engine";
import { colors, radius } from "../theme";

export function StatusBadge({ status }: { status: CheckStatus }) {
  const { t } = useTranslation();
  const c = status === "allowed" ? [colors.allowed, colors.allowedBg] : status === "maybe" ? [colors.maybe, colors.maybeBg] : [colors.notAllowed, colors.notAllowedBg];
  return (
    <View style={[styles.badge, { backgroundColor: c[1] }]}>
      <Text style={[styles.badgeText, { color: c[0] }]}>{t(`status.${status}`)}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind = "primary", disabled, testID }: { title: string; onPress(): void; kind?: "primary" | "secondary"; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, kind === "primary" ? styles.btnPrimary : styles.btnSecondary, pressed && { opacity: 0.85 }, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.btnText, kind === "primary" ? { color: colors.accentInk } : { color: colors.accent }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Upper-case a heading. Greek capitals drop their accents (ΕΠΙΛΟΓΕΣ, not ΕΠΙΛΟΓΈΣ). */
export function upper(text: string, lng: string): string {
  const up = text.toLocaleUpperCase(lng);
  return lng.startsWith("el") ? up.normalize("NFD").replace(/[\u0301\u0308]/g, "").normalize("NFC") : up;
}

export function SectionTitle({ children }: { children: string }) {
  const { i18n } = useTranslation();
  return <Text style={styles.section}>{upper(children, i18n.language)}</Text>;
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontWeight: "700" }]}>{value}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "error" | "info" }) {
  const bg = tone === "error" ? colors.notAllowedBg : tone === "info" ? colors.allowedBg : colors.warnBg;
  const line = tone === "error" ? colors.notAllowed : tone === "info" ? colors.allowed : colors.warnLine;
  return <View style={[styles.notice, { backgroundColor: bg, borderColor: line }]}>{children}</View>;
}

export const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "700" },
  btn: { borderRadius: radius, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", marginTop: 8 },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.accent },
  btnText: { fontSize: 15, fontWeight: "600" },
  card: { backgroundColor: colors.panel, borderRadius: radius, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.line },
  section: { fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 12 },
  rowLabel: { color: colors.muted, flexShrink: 1, fontSize: 14 },
  rowValue: { color: colors.ink, fontSize: 14, textAlign: "right", fontVariant: ["tabular-nums"] },
  loading: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12 },
  muted: { color: colors.muted, fontSize: 14 },
  notice: { borderLeftWidth: 4, borderRadius: 6, padding: 12, marginBottom: 12 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  h1: { fontSize: 22, fontWeight: "700", color: colors.ink },
  h2: { fontSize: 17, fontWeight: "700", color: colors.ink, marginBottom: 6 },
});
