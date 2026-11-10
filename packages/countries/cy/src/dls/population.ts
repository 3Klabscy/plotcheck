import type { LngLat } from "@plotcheck/core";
import type { AreaInfo, AreaInfoRow, LayerChoices, ProviderContext } from "@plotcheck/country-sdk";
import { DLS_INSPIRE, dlsGet } from "./http.ts";

/**
 * Census figures of the Statistical Service, published by DLS (INSPIRE PD_PopulationDistribution).
 * The service draws one choropleth per sex × age group (or employment indicator); it cannot be
 * queried, but WMS GetFeatureInfo returns every census field of the area under a point.
 * The fields include dwellings built 2001–2011, so the figures are the 2011 census.
 */
export const PD_SERVICE = `${DLS_INSPIRE}/PD_PopulationDistribution/MapServer`;
const WMS = `${PD_SERVICE}/exts/InspireView/service`;

const AGES = ["0_14", "15_24", "25_64", "65"] as const;
/** ArcGIS sublayer ids of the service, per level. */
const SUB = {
  district: { men: [2, 3, 4, 5], women: [6, 7, 8, 9], employed: [39, 40], unemployed: [46, 47], sectors: [53, 54, 55, 56, 57, 58] },
  community: { men: [11, 12, 13, 14], women: [15, 16, 17, 18], employed: [42, 43], unemployed: [49, 50], sectors: [60, 61, 62, 63, 64, 65] },
  quarter: { men: [20, 21, 22, 23], women: [24, 25, 26, 27] },
  postcode: { men: [29, 30, 31, 32], women: [33, 34, 35, 36] },
} as const;

function buildChoices(): LayerChoices {
  const layers: Record<string, string> = {};
  const ind: { id: string; titleKey: string }[] = [];
  for (const sex of ["men", "women"] as const)
    AGES.forEach((a, i) => {
      ind.push({ id: `${sex}${a}`, titleKey: `cy.stats.ind.${sex}${a}` });
      for (const [lvl, s] of Object.entries(SUB)) layers[`${lvl}|${sex}${a}`] = `show:${s[sex][i]}`;
    });
  for (const k of ["employed", "unemployed"] as const)
    (["men", "women"] as const).forEach((sex, i) => {
      ind.push({ id: `${k}_${sex}`, titleKey: `cy.stats.ind.${k}_${sex}` });
      for (const lvl of ["district", "community"] as const) layers[`${lvl}|${k}_${sex}`] = `show:${SUB[lvl][k][i]}`;
    });
  (["men", "women"] as const).forEach((sex, si) =>
    (["primary", "secondary", "tertiary"] as const).forEach((sec, i) => {
      ind.push({ id: `${sec}_${sex}`, titleKey: `cy.stats.ind.${sec}_${sex}` });
      for (const lvl of ["district", "community"] as const) layers[`${lvl}|${sec}_${sex}`] = `show:${SUB[lvl].sectors[si * 3 + i]}`;
    }),
  );
  return {
    dims: [
      { key: "level", titleKey: "cy.stats.level", options: [
        { id: "district", titleKey: "cy.stats.lvl.district" },
        { id: "community", titleKey: "cy.stats.lvl.community", minzoom: 14 },
        { id: "quarter", titleKey: "cy.stats.lvl.quarter", minzoom: 15 },
        { id: "postcode", titleKey: "cy.stats.lvl.postcode", minzoom: 16 },
      ] },
      { key: "indicator", titleKey: "cy.stats.indicator", options: ind },
    ],
    layers,
    initial: ["community", "women25_64"],
  };
}
export const populationChoices = buildChoices();

/** WMS layer (by name) to identify each level with; all return the full set of census fields. */
const IDENTIFY = [
  { level: "quarter", layer: "Men_qrtr_0-14" },
  { level: "postcode", layer: "Man_poc_0-14" },
  { level: "community", layer: "EmployedMen_vill" },
  { level: "district", layer: "UnemployedMen_dist" },
] as const;

export function parseFields(xml: string): Record<string, string> | undefined {
  const m = /<FIELDS\s([^>]*?)\/?>/.exec(xml);
  if (!m) return undefined;
  const out: Record<string, string> = {};
  for (const a of m[1]!.matchAll(/([\w.]+)="([^"]*)"/g)) out[a[1]!] = a[2]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return out;
}

/** Some Greek names come back as Windows-1253 bytes read as Latin-1 ("ËÁÑÍÁÊÁ"): repair them. */
function fixGreek(s: string | undefined): string | undefined {
  if (!s) return s;
  if (!/[À-ÿ]/.test(s) || /[Ͱ-Ͽ]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
    return new TextDecoder("windows-1253").decode(bytes);
  } catch {
    return undefined;
  }
}

function webMercator(p: LngLat): [number, number] {
  const x = (p.lng * Math.PI * 6378137) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI) / 360)) * 6378137;
  return [x, y];
}

export function areaFromFields(level: string, f: Record<string, string>): AreaInfo["areas"][number] | undefined {
  const n = (k: string) => (f[k] !== undefined && f[k] !== "" && Number.isFinite(Number(f[k])) ? Number(f[k]) : undefined);
  const total = n("TSTAT") ?? n("T");
  if (total === undefined) return undefined;
  const rows = (list: [string, number | undefined, AreaInfoRow["kind"]?, number?][]) =>
    list.filter((r): r is [string, number, AreaInfoRow["kind"], number | undefined] => r[1] !== undefined).map(([key, value, kind, of]) => ({ key, value, ...(kind ? { kind } : {}), ...(of !== undefined ? { of } : {}) }));
  const sections: AreaInfo["areas"][number]["sections"] = [];
  const push = (titleKey: string, r: AreaInfoRow[]) => { if (r.length) sections.push({ titleKey, rows: r }); };
  push("cy.stats.sec.population", rows([
    ["cy.stats.total", total],
    ["cy.stats.men", n("MSTAT") ?? n("M"), "count", total],
    ["cy.stats.women", n("FSTAT") ?? n("F"), "count", total],
    ["cy.stats.avgAge", n("TAVY"), "decimal"],
    ["cy.stats.density", n("DENST"), "perKm2"],
  ]));
  push("cy.stats.sec.ages", rows([
    ["cy.stats.age0_14", n("YT0_14"), "count", total],
    ["cy.stats.age15_24", n("YT15_24"), "count", total],
    ["cy.stats.age25_64", n("YT25_64"), "count", total],
    ["cy.stats.age65", n("YT65_"), "count", total],
  ]));
  const cit = [n("TCOC_CY"), n("TCOC_EU"), n("TCOC_NEU")];
  const citTotal = cit.every((x) => x !== undefined) ? cit.reduce((a, b) => a! + b!, 0) : undefined;
  push("cy.stats.sec.citizenship", rows([
    ["cy.stats.citCY", cit[0], "count", citTotal],
    ["cy.stats.citEU", cit[1], "count", citTotal],
    ["cy.stats.citNonEU", cit[2], "count", citTotal],
  ]));
  const hh = n("NR_HHOLDS"), hhPop = n("HHOLDTPOP");
  const built = [n("DY_LT1980"), n("DY1981_200"), n("DY2001_201")];
  const builtTotal = built.every((x) => x !== undefined) ? built.reduce((a, b) => a! + b!, 0) : undefined;
  push("cy.stats.sec.housing", rows([
    ["cy.stats.households", hh],
    ["cy.stats.hhSize", hh && hhPop ? hhPop / hh : undefined, "decimal"],
    ["cy.stats.dwellings", n("NR_LQ")],
    ["cy.stats.builtBefore1980", built[0], "count", builtTotal],
    ["cy.stats.built1981_2000", built[1], "count", builtTotal],
    ["cy.stats.built2001_2011", built[2], "count", builtTotal],
  ]));
  const act = n("TACTPR"), unemp = n("TUNEPR");
  push("cy.stats.sec.work", rows([
    ["cy.stats.active", act],
    ["cy.stats.employed", n("TEMPPR"), "count", act],
    ["cy.stats.unemployed", unemp, "count", act],
    ["cy.stats.unemploymentRate", act && unemp !== undefined ? (unemp / act) * 100 : undefined, "percent"],
  ]));
  push("cy.stats.sec.education", rows([
    ["cy.stats.eduTertiary", n("PTEDUUNI"), "percent"],
    ["cy.stats.eduBachelor", n("PTEDU6"), "percent"],
    ["cy.stats.eduMaster", n("PTEDU78"), "percent"],
  ]));
  const name =
    level === "quarter" ? { el: f["QRTR_NM_G"], en: f["QRTR_NM_E"] }
    : level === "postcode" ? { el: `${f["POST_CODE"] ?? ""} · ${f["VIL_NM_G"] ?? ""}`, en: `${f["POST_CODE"] ?? ""} · ${f["VIL_NM_E"] ?? ""}` }
    : level === "community" ? { el: f["VIL_NM_G_1"] ?? f["VIL_NM_G"], en: f["VIL_NM_E_1"] ?? f["VIL_NM_E"] }
    : { el: fixGreek(f["DIST_NM_G"]), en: f["DIST_NM_E"] };
  // quarter names in Greek are cut at 10 characters by the source: use the full English name then
  if (level === "quarter" && name.el && name.el.length >= 10 && name.en) name.el = undefined;
  return { levelKey: `cy.stats.lvl.${level}`, name, sections };
}

export async function cyPopulationAt(ctx: ProviderContext, p: LngLat): Promise<AreaInfo> {
  const [x, y] = webMercator(p);
  const d = 20; // 40 m box, 101 px: 0.4 m per pixel (well inside every level's scale range)
  const bbox = `${x - d},${y - d},${x + d},${y + d}`;
  const results = await Promise.all(
    IDENTIFY.map(async ({ level, layer }) => {
      try {
        const xml = await dlsGet(ctx, `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${encodeURIComponent(layer)}&QUERY_LAYERS=${encodeURIComponent(layer)}&STYLES=&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/xml&FEATURE_COUNT=1`, 15_000);
        const f = parseFields(xml);
        return f ? areaFromFields(level, f) : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return { areas: results.filter((a) => a !== undefined), sourceKey: "cy.stats.source" };
}
