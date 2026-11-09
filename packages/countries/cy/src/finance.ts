import type { Parcel, UseType, ZoneHit } from "@plotcheck/core";
import type { FinanceParams } from "@plotcheck/engine";
import type { FinanceDefaults } from "@plotcheck/country-sdk";
import landValues from "../data/larnaca-land-values-2021.json" with { type: "json" };
import plotIndex from "../data/larnaca-plot-index.json" with { type: "json" };
import { cyMarketStats } from "./market.ts";

/**
 * Cyprus / Larnaca financial defaults (2026-11). Every figure is an ESTIMATE, editable in the app
 * and later in the admin panel. Sources are listed in `sources` and shown to the user.
 */

const SOURCES = [
  { label: "New-build asking prices Larnaca (listings median ≈ €2,500/m², Nov 2026; €2,200–3,500 centre/coast, €1,800–2,500 inland)", url: "https://index.cy/articles/apartments-for-sale-larnaca-guide/" },
  { label: "Construction cost ranges Cyprus 2025–26 (€1,700–2,500/m² houses; CYSTAT permit values ≈ €1,077/m² apartment blocks)", url: "https://tools.axiavaluers.com/en/tools/construction-cost" },
  { label: "DLS transfer fees: 3% to €85,000, 5% to €170,000, 8% above (50% exemption where no VAT is charged)", url: "https://portal.dls.moi.gov.cy/enimerosi/teli-kai-dikaiomata/" },
  { label: "DLS General Valuation 1/1/2021 — value of building density per m² by area and zone", url: "https://portal.dls.moi.gov.cy/enimerosi/nea-geniki-ektimisi-se-times-1-1-2021/" },
];

/** Residential sale price per m² (net internal area, ex-VAT) by DLS municipality code. */
const PRICE_BY_MUNICIPALITY: Record<string, number> = {
  "4000": 2600, // Larnaca town
  "4010": 2100, // Aradippou
  "4011": 2200, // Livadia
  "4014": 2000, // Dromolaxia–Meneou
  "4102": 2300, // Oroklini
};
const PRICE_DEFAULT = 1900;

/** Construction cost per m² of gross floor area (standard finish), by building type. */
const BUILD_COST: Record<UseType, number> = {
  apartment_block: 1300,
  mixed_use: 1400,
  commercial: 1400,
  house: 1700,
  row_houses: 1500,
};
export const FINISH_FACTOR = { basic: 0.85, standard: 1, high: 1.3 } as const;

const BASE: Omit<FinanceParams, "salePricePerM2" | "commercialPricePerM2" | "constructionCostPerM2"> = {
  currency: "EUR",
  verandaValueShare: 0.5,
  verandaCostShare: 0.5,
  basementLevels: 0,
  basementCostPerM2: 900,
  externalWorksPct: 0.05,
  designPct: 0.07,
  permitsPct: 0.015,
  legalPct: 0.01,
  contingencyPct: 0.05,
  marketingPctOfGdv: 0.03,
  financePct: 0.04,
  targetProfitPctOfGdv: 0.15, // ≈ 18% on cost
  landPurchaseFeeBands: [
    { upTo: 85000, rate: 0.03 },
    { upTo: 170000, rate: 0.05 },
    { upTo: null, rate: 0.08 },
  ],
  rentPerM2Month: 12,
  rentCostsPct: 0.2,
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^Α-ΩA-Z0-9]/g, "");

type IndexFile = { municipalities: { code: string; el?: string | null; quarters: { code: string; el?: string | null }[] }[] };
type ValuesFile = { rows: [string, string, number, number, number, string][] };

/** Official land value (DLS General Valuation 1/1/2021) for the plot's area and zone. */
export function officialLandValue(parcel: Parcel, zone: ZoneHit) {
  const muni = parcel.identifiers["municipalityCode"];
  const q = parcel.identifiers["quarter"];
  if (!muni) return undefined;
  const m = (plotIndex as unknown as IndexFile).municipalities.find((x) => x.code === muni);
  if (!m?.el) return undefined;
  const quarter = q ? m.quarters.find((x) => x.code === `${muni}${q.padStart(2, "0")}`) : undefined;
  const keys = [
    ...(quarter?.el ? [fold(m.el) + fold(quarter.el)] : []),
    fold(m.el.replace(/\(.*\)/, "")),
    ...(m.el.match(/\(([^)]+)\)/) ? [fold(m.el.match(/\(([^)]+)\)/)![1]!)] : []),
  ];
  const zoneKey = zone.zoneCode.trim();
  const rows = (landValues as unknown as ValuesFile).rows.filter((r) => r[1] === zoneKey && r[5] === "plan");
  for (const k of keys) {
    // Exact area, then a broader area that contains ours; a narrower one only if all its sub-areas agree.
    const wider = rows.find((r) => r[0] === k) ?? rows.find((r) => k.startsWith(r[0]));
    const narrower = rows.filter((r) => r[0].startsWith(k));
    const hit = wider ?? (narrower.length > 0 && narrower.every((r) => r[3] === narrower[0]![3]) ? narrower[0] : undefined);
    if (hit) {
      const area = parcel.officialAreaM2 ?? 0;
      return {
        perM2Buildable: hit[3],
        perM2BuildableGround: hit[4],
        far: hit[2],
        total: Math.round(area * hit[2] * hit[3]),
        areaKey: hit[0],
        date: "2021-01-01",
        source: SOURCES[3]!,
      };
    }
  }
  return undefined;
}

export function cyFinanceDefaults(parcel: Parcel, zone: ZoneHit | undefined): FinanceDefaults {
  const muni = parcel.identifiers["municipalityCode"] ?? "";
  const price = PRICE_BY_MUNICIPALITY[muni] ?? PRICE_DEFAULT;
  const byUse = Object.fromEntries(
    (Object.keys(BUILD_COST) as UseType[]).map((u) => [u, { ...BASE, salePricePerM2: price, commercialPricePerM2: Math.round(price * 1.15), constructionCostPerM2: BUILD_COST[u] }]),
  ) as Record<UseType, FinanceParams>;
  return {
    byUse,
    finishFactor: FINISH_FACTOR,
    ...(zone ? { officialLandValue: officialLandValue(parcel, zone) } : {}),
    ...((m) => (m ? { market: m } : {}))(cyMarketStats(parcel)),
    sources: SOURCES,
    notes: ["prices_ex_vat", "estimates"],
  };
}
