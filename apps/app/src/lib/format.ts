export const localeTag = (lng: string) => (lng === "el" ? "el-CY" : "en-GB");

export function fmtNumber(n: number, lng: string, digits = 0): string {
  return new Intl.NumberFormat(localeTag(lng), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export const fmtArea = (m2: number, lng: string, digits = 0) => `${fmtNumber(m2, lng, digits)} m²`;

export const fmtPercent = (ratio: number, lng: string) =>
  new Intl.NumberFormat(localeTag(lng), { style: "percent", maximumFractionDigits: 1 }).format(ratio);

export const fmtMoney = (n: number, lng: string, currency = "EUR") =>
  new Intl.NumberFormat(localeTag(lng), { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
