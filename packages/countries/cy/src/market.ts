// District property market from the DLS open data (data.gov.cy, CC BY 4.0): monthly sales totals.
// All property kinds together, so this is market activity and the average value per sale —
// context for the sale price, not a price per m².
import type { Parcel } from "@plotcheck/core";
import type { MarketStats } from "@plotcheck/country-sdk";
import stats from "../data/cy-sales-stats.json" with { type: "json" };

type Row = [string, string, number, number, number, number];
const DATA = stats as unknown as { source: string; url: string; rows: Row[] };

/** DLS district codes (first digit of the municipality code). */
const DISTRICT: Record<string, string> = { "1": "ΛΕΥΚΩΣΙΑ", "3": "ΑΜΜΟΧΩΣΤΟΣ", "4": "ΛΑΡΝΑΚΑ", "5": "ΛΕΜΕΣΟΣ", "6": "ΠΑΦΟΣ" };

const sum = (rows: Row[], i: 2 | 3 | 4 | 5) => rows.reduce((a, r) => a + r[i], 0);

export function cyMarketStats(parcel: Parcel, months = 6): MarketStats | undefined {
  const district = DISTRICT[(parcel.identifiers["municipalityCode"] ?? "").slice(0, 1)];
  if (!district) return undefined;
  const rows = DATA.rows.filter((r) => r[1] === district && r[2] > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const last = rows.slice(-months);
  if (last.length === 0) return undefined;
  const ymBefore = (ym: string) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
  const prior = rows.filter((r) => last.some((l) => ymBefore(l[0]) === r[0]));
  const cases = sum(last, 2), accepted = sum(last, 5);
  const avg = accepted / cases;
  const priorAvg = prior.length === last.length ? sum(prior, 5) / sum(prior, 2) : undefined;
  return {
    area: district,
    from: last[0]![0],
    to: last[last.length - 1]![0],
    sales: cases,
    plots: sum(last, 3),
    totalValue: Math.round(accepted),
    avgValuePerSale: Math.round(avg),
    ...(priorAvg ? { changeVsYearBefore: Math.round((avg / priorAvg - 1) * 1000) / 1000, salesYearBefore: sum(prior, 2) } : {}),
    monthly: last.map((r) => ({ month: r[0], sales: r[2], avgValue: Math.round(r[5] / r[2]) })),
    source: { label: DATA.source, url: DATA.url },
  };
}
