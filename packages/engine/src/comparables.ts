// Comparable sales → a sale price per m² for the finance model.
// Pure: the sales come from a country source (e.g. a land-registry comparable-sales export) or are
// entered by the user. The last N months are kept, outliers removed (Tukey fences), then mean and median.

export type ComparableKind = "apartment" | "house" | "commercial" | "land" | "other";

export interface ComparableSale {
  /** ISO date of the sale (contract or registration). */
  date: string;
  /** Price paid, in the country currency. */
  price: number;
  /** Area the price refers to (covered/internal for buildings, plot for land), m². */
  areaM2: number;
  kind: ComparableKind;
  /** Free text: address, plot reference, notes. */
  label?: string;
  /** Distance from the subject plot, if known. */
  distanceM?: number;
}

export interface ComparableStats {
  months: number;
  from: string;
  to: string;
  kind: ComparableKind | "all";
  /** Sales in the period with a usable price and area. */
  inPeriod: number;
  /** Used after removing outliers. */
  used: ComparableSale[];
  excluded: ComparableSale[];
  meanPerM2: number;
  medianPerM2: number;
  minPerM2: number;
  maxPerM2: number;
}

const perM2 = (s: ComparableSale) => s.price / s.areaM2;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Sales of one kind in the last `months` months up to `asOf`, with outliers removed. */
export function comparableStats(sales: ComparableSale[], opts: { asOf: Date; months?: number; kind?: ComparableKind | "all" }): ComparableStats | undefined {
  const months = opts.months ?? 6;
  const to = opts.asOf;
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - months, to.getUTCDate()));
  const kind = opts.kind ?? "all";
  const inPeriod = sales.filter((s) => {
    const d = new Date(s.date);
    return !Number.isNaN(d.getTime()) && d >= from && d <= to && s.price > 0 && s.areaM2 > 0 && (kind === "all" || s.kind === kind);
  });
  if (inPeriod.length === 0) return undefined;
  const values = inPeriod.map(perM2).sort((a, b) => a - b);
  let lo = -Infinity, hi = Infinity;
  if (values.length >= 4) {
    const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75), iqr = q3 - q1;
    lo = q1 - 1.5 * iqr;
    hi = q3 + 1.5 * iqr;
  }
  const used = inPeriod.filter((s) => perM2(s) >= lo && perM2(s) <= hi);
  const excluded = inPeriod.filter((s) => !used.includes(s));
  const u = used.map(perM2).sort((a, b) => a - b);
  return {
    months,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    kind,
    inPeriod: inPeriod.length,
    used,
    excluded,
    meanPerM2: Math.round(u.reduce((a, b) => a + b, 0) / u.length),
    medianPerM2: Math.round(quantile(u, 0.5)),
    minPerM2: Math.round(u[0]!),
    maxPerM2: Math.round(u[u.length - 1]!),
  };
}
