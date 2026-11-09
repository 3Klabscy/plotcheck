import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import en from "../locales/en";
import el from "../locales/el";

const STORAGE_KEY = "plotcheck.lang";

function savedLanguage(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Launch market default is Greek; English if the device prefers it or the user chose it. */
function initialLanguage(): string {
  const saved = savedLanguage();
  if (saved === "el" || saved === "en") return saved;
  const device = getLocales()[0]?.languageCode;
  return device === "en" ? "en" : "el";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, el: { translation: el } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lng: string) {
  void i18n.changeLanguage(lng);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lng);
  } catch {
    /* storage unavailable: language just won't persist */
  }
}

/** Merge a country module's strings (field labels, disclaimers) into the bundles. */
export function addCountryMessages(messages: Record<string, Record<string, string>>) {
  for (const [lng, bundle] of Object.entries(messages)) i18n.addResourceBundle(lng, "translation", bundle, true, false);
}

export const localeTag = (lng: string) => (lng === "el" ? "el-CY" : "en-GB");

export default i18n;
