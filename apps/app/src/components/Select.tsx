import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { colors } from "../theme";
import { styles } from "./ui";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Small searchable select that works the same on web and native. */
export function Select({ label, value, options, onChange, disabled, testID }: {
  label: string;
  value?: string;
  options: Option[];
  onChange(v: string): void;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return (f ? options.filter((o) => fold(`${o.label} ${o.hint ?? ""} ${o.value}`).includes(f)) : options).slice(0, 80);
  }, [q, options]);

  return (
    <View style={{ marginBottom: 10, opacity: disabled ? 0.5 : 1 }} testID={testID}>
      <Text style={[styles.small, { marginBottom: 4, color: colors.ink, fontWeight: "600" }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={{ borderWidth: 1, borderColor: open ? colors.accent : colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.panel, flexDirection: "row", justifyContent: "space-between" }}
      >
        <Text style={{ color: current ? colors.ink : colors.muted, fontSize: 15 }} numberOfLines={1}>
          {current ? current.label : t("search.choose")}
        </Text>
        <Text style={{ color: colors.muted }}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open && (
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, marginTop: 4, backgroundColor: colors.panel }}>
          {options.length > 8 && (
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("search.filter")}
              autoFocus
              style={{ borderBottomWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 }}
              testID={testID ? `${testID}-filter` : undefined}
            />
          )}
          <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
            {shown.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                  setQ("");
                }}
                style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: o.value === value ? colors.allowedBg : pressed ? "#F1F0EB" : colors.panel })}
                testID={testID ? `${testID}-opt-${o.value}` : undefined}
              >
                <Text style={{ fontSize: 15, color: colors.ink }}>{o.label}</Text>
                {o.hint ? <Text style={styles.small}>{o.hint}</Text> : null}
              </Pressable>
            ))}
            {shown.length === 0 && <Text style={[styles.small, { padding: 12 }]}>—</Text>}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
