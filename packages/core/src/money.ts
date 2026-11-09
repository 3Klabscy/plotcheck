import type { CurrencyCode } from "./types.ts";

/** Money is always integer minor units + currency, never floats. Used from phase 2 onward. */
export interface Money {
  minor: number;
  currency: CurrencyCode;
}

export function formatMoney(m: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(m.minor / 100);
}

export function formatArea(m2: number, locale: string, digits = 0): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(m2)} m²`;
}
