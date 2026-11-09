// Calculation engine. Pure functions, no I/O, no country-specific code.
// Check logic adapted from zoneR (vibe-lab-gsd/zoneR, MIT licence): each check returns
// allowed / not_allowed / maybe with a reason, and undecidable conditions yield "maybe".

import area from "@turf/area";
import buffer from "@turf/buffer";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { maxOf, minOf, type ConstraintName, type ZoneRuleSet } from "@plotcheck/core";
import type { AnalysisInput, AnalysisResult, Check, CheckStatus, Figures, ReviewWarning, UnitMix } from "./types.ts";
import { applyRelaxations } from "./relax.ts";

export const ENGINE_VERSION = "0.1.0";

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("not_allowed")) return "not_allowed";
  if (statuses.includes("maybe")) return "maybe";
  return "allowed";
}

/** Split gross floor area over floors, filling each floor up to the footprint. */
export function splitFloors(gfa: number, footprint: number, floors: number): number[] {
  const out: number[] = [];
  let left = gfa;
  for (let i = 0; i < floors && left > 0.01; i++) {
    const f = Math.min(footprint, left);
    out.push(round(f, 1));
    left -= f;
  }
  return out;
}

/** Largest-remainder allocation of `total` items by shares. */
function allocate(total: number, shares: UnitMix): UnitMix {
  const keys = Object.keys(shares) as (keyof UnitMix)[];
  const sum = keys.reduce((s, k) => s + shares[k], 0) || 1;
  const raw = keys.map((k) => ({ k, v: (shares[k] / sum) * total }));
  const out = Object.fromEntries(raw.map(({ k, v }) => [k, Math.floor(v)])) as unknown as UnitMix;
  let rest = total - keys.reduce((s, k) => s + out[k], 0);
  for (const { k } of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (rest <= 0) break;
    out[k]++;
    rest--;
  }
  return out;
}

function unitEstimate(sellable: number, mix: UnitMix, sizes: UnitMix) {
  const keys = Object.keys(mix) as (keyof UnitMix)[];
  const sum = keys.reduce((s, k) => s + mix[k], 0) || 1;
  const avg = keys.reduce((s, k) => s + (mix[k] / sum) * sizes[k], 0);
  let total = Math.max(0, Math.floor(sellable / avg));
  let byType = allocate(total, mix);
  // rounding can overshoot the sellable area: drop units until it fits
  const used = (b: UnitMix) => keys.reduce((s, k) => s + b[k] * sizes[k], 0);
  while (total > 0 && used(byType) > sellable + 0.01) {
    total--;
    byType = allocate(total, mix);
  }
  return { total, byType };
}

export function analyse(input: AnalysisInput): AnalysisResult {
  const { site, rules, use, params } = input;
  const checks: Check[] = [];
  const needsReview: ReviewWarning[] = [];
  const toBeChecked = new Set<string>(["check.engineer.survey", "check.engineer.planning_authority"]);
  const used = new Set<ConstraintName>();
  const track = <T extends { constraint: { provenance: ReviewWarning["provenance"] } }>(name: ConstraintName, r: T | undefined): T | undefined => {
    if (r && !used.has(name)) {
      used.add(name);
      if (r.constraint.provenance.status !== "verified") needsReview.push({ constraint: name, provenance: r.constraint.provenance });
    }
    return r;
  };

  // ---- 1. Plot area
  let geometryAreaM2: number | undefined;
  if (site.geometry) geometryAreaM2 = round(area({ type: "Feature", properties: {}, geometry: site.geometry } as Feature), 1);
  const plotAreaM2 = site.officialAreaM2 ?? geometryAreaM2 ?? 0;
  if (site.officialAreaM2 && geometryAreaM2 && Math.abs(geometryAreaM2 - site.officialAreaM2) / site.officialAreaM2 > 0.05) {
    checks.push({ id: "area_mismatch", status: "maybe", reasonKey: "reason.area_mismatch", params: { official: plotAreaM2, drawn: geometryAreaM2 } });
    toBeChecked.add("check.engineer.area");
  }

  // ---- 2. Use permitted
  const uses = rules.uses_allowed;
  if (uses.provenance.status !== "verified") needsReview.push({ constraint: "uses_allowed", provenance: uses.provenance });
  if (uses.value === null) checks.push({ id: "use", status: "maybe", reasonKey: "reason.use_unknown", params: { use } });
  else if (rules.uses_conditional?.includes(use)) {
    checks.push({ id: "use", status: "maybe", reasonKey: "reason.use_conditional", params: { use, zone: rules.dist_abbr } });
    toBeChecked.add("check.engineer.use");
  } else if (uses.value.includes(use)) checks.push({ id: "use", status: "allowed", reasonKey: "reason.use_allowed", params: { use } });
  else checks.push({ id: "use", status: "not_allowed", reasonKey: "reason.use_not_allowed", params: { use, zone: rules.dist_abbr } });

  // ---- 3. Coefficients
  const farR = track("far", maxOf(rules, "far"));
  const covR = track("lot_cov_bldg", maxOf(rules, "lot_cov_bldg"));
  const stR = track("stories", maxOf(rules, "stories"));
  const hR = track("height", maxOf(rules, "height"));

  let far = farR?.value ?? 0;
  for (const b of rules.bonuses) {
    if (b.farAdd && params.applyBonusIds?.includes(b.id)) {
      far += b.farAdd;
      checks.push({ id: `bonus_${b.id}`, status: "maybe", reasonKey: "reason.bonus_applied", params: { bonus: b.description, far: b.farAdd } });
      toBeChecked.add("check.engineer.bonus");
    }
  }
  const coverageRatio = covR?.value ?? 0;
  if (!farR || !covR) {
    checks.push({ id: "coefficients", status: "maybe", reasonKey: "reason.coefficients_missing" });
  }
  for (const r of [farR, covR, stR, hR]) if (r?.ambiguous) checks.push({ id: "ambiguous", status: "maybe", reasonKey: "reason.rule_ambiguous" });

  const maxGfaM2 = round(plotAreaM2 * far, 1);
  const maxCoverageM2 = round(plotAreaM2 * coverageRatio, 1);

  // ---- 4. Floors vs stories and height
  const maxStories = stR?.value;
  const maxHeightM = hR?.value;
  const floorsByHeight = maxHeightM !== undefined ? Math.floor(maxHeightM / params.storeyHeightM + 1e-9) : undefined;
  const candidates = [maxStories, floorsByHeight].filter((x): x is number => x !== undefined && x > 0);
  const allowedFloors = candidates.length ? Math.min(...candidates) : 0;
  if (!candidates.length) checks.push({ id: "floors", status: "maybe", reasonKey: "reason.floors_unknown" });

  // ---- 5. Setbacks → buildable footprint on the real plot shape, per floor.
  // Distances can step back with height (e.g. 3 m up to the 3rd floor, 4 m on the 4th, 5 m above),
  // so each floor gets its own footprint. Rules may use the variable `floor` (1 = ground floor).
  const vars = { height: maxHeightM ?? allowedFloors * params.storeyHeightM, stories: allowedFloors, lot_area: plotAreaM2, floor: 1 };
  const setbackNames: ConstraintName[] = ["setback_dist_boundary", "setback_side_int", "setback_rear"];
  const setbackAt = (floor: number) => setbackNames.map((n) => minOf(rules, n, { ...vars, floor })).filter((x) => x !== undefined);
  const sb = setbackNames.map((n) => track(n, minOf(rules, n, vars))).filter((x) => x !== undefined);
  const front = track("setback_front", minOf(rules, "setback_front", vars));
  let setbackM: number | undefined;
  let netFootprintM2: number | undefined;
  let buildableFootprint: AnalysisResult["buildableFootprint"];
  if (sb.length) {
    setbackM = Math.max(...sb.map((s) => s.value));
    if (sb.some((s) => s.ambiguous)) {
      const lo = Math.min(...sb.map((s) => minBoundLow(s.constraint)));
      checks.push({ id: "setback_ambiguous", status: "maybe", reasonKey: "reason.setback_ambiguous", params: { min: lo, used: setbackM } });
      toBeChecked.add("check.engineer.setbacks");
    }
  }
  const siteFeature = site.geometry ? ({ type: "Feature", properties: {}, geometry: site.geometry } as Feature<Polygon | MultiPolygon>) : undefined;
  const insetCache = new Map<number, { area: number; geometry?: AnalysisResult["buildableFootprint"] }>();
  const inset = (m: number) => {
    let hit = insetCache.get(m);
    if (!hit && siteFeature) {
      const f = m > 0 ? buffer(siteFeature, -m, { units: "meters" }) : siteFeature;
      hit = { area: f?.geometry ? round(area(f), 1) : 0, geometry: f?.geometry as AnalysisResult["buildableFootprint"] };
      insetCache.set(m, hit);
    }
    return hit;
  };
  if (siteFeature && setbackM !== undefined) {
    const g = inset(setbackM)!;
    netFootprintM2 = g.area;
    buildableFootprint = g.geometry;
    checks.push({
      id: "setbacks",
      status: netFootprintM2 > 0 ? "allowed" : "not_allowed",
      reasonKey: netFootprintM2 > 0 ? "reason.setback_footprint" : "reason.setback_no_footprint",
      params: { setback: setbackM, footprint: netFootprintM2 },
      constraint: "setback_dist_boundary",
    });
  } else {
    checks.push({ id: "setbacks", status: "maybe", reasonKey: site.geometry ? "reason.setback_unknown" : "reason.setback_no_geometry" });
  }
  if (front) {
    toBeChecked.add("check.engineer.front_setback");
    if (setbackM === undefined || front.value > setbackM) checks.push({ id: "front_setback", status: "maybe", reasonKey: "reason.front_setback", params: { setback: front.value } });
  }
  toBeChecked.add("check.engineer.street_alignment");

  const footprintM2 = round(netFootprintM2 !== undefined ? Math.min(maxCoverageM2, netFootprintM2) : maxCoverageM2, 1);
  if (netFootprintM2 !== undefined && netFootprintM2 < maxCoverageM2) {
    checks.push({ id: "coverage_limited_by_setbacks", status: "allowed", reasonKey: "reason.coverage_limited", params: { coverage: maxCoverageM2, footprint: netFootprintM2 } });
  }

  // Per-floor setback and floor-plate area (never larger than the ground-floor footprint)
  const setbackByFloor: number[] = [];
  const floorPlateM2: number[] = [];
  for (let f = 1; f <= allowedFloors; f++) {
    const s = setbackAt(f);
    const sf = s.length ? Math.max(...s.map((x) => x.value)) : undefined;
    if (sf !== undefined) setbackByFloor.push(sf);
    const plate = siteFeature && sf !== undefined ? Math.min(footprintM2, inset(sf)!.area) : footprintM2;
    floorPlateM2.push(round(plate, 1));
  }
  const stepped = setbackByFloor.some((x) => x !== setbackByFloor[0]);
  if (stepped) {
    const firstStep = setbackByFloor.findIndex((x) => x !== setbackByFloor[0]);
    checks.push({ id: "stepped_setbacks", status: "allowed", reasonKey: "reason.stepped_setbacks", params: { floor: firstStep + 1, setback: setbackByFloor[firstStep]!, top: setbackByFloor.at(-1)! } });
  }

  // ---- 6. Capacity: fill floors from the ground up until the density is used
  const perFloorM2: number[] = [];
  let left = maxGfaM2;
  for (const plate of floorPlateM2) {
    if (left <= 0.01 || plate <= 0) break;
    const a = Math.min(plate, left);
    perFloorM2.push(round(a, 1));
    left -= a;
  }
  const achievableGfaM2 = round(perFloorM2.reduce((a, b) => a + b, 0), 1);
  const feasibleFloors = perFloorM2.length;
  if (achievableGfaM2 < maxGfaM2 - 0.5) {
    checks.push({ id: "density_unused", status: "allowed", reasonKey: "reason.density_unused", params: { unused: round(maxGfaM2 - achievableGfaM2, 0) } });
  }
  const buildingHeightM = round(feasibleFloors * params.storeyHeightM, 1);
  if (maxHeightM !== undefined) {
    checks.push({
      id: "height",
      status: buildingHeightM <= maxHeightM + 1e-6 ? "allowed" : "not_allowed",
      reasonKey: "reason.height",
      params: { height: buildingHeightM, max: maxHeightM },
      constraint: "height",
    });
  }
  if (maxStories !== undefined) {
    checks.push({ id: "stories", status: feasibleFloors <= maxStories ? "allowed" : "not_allowed", reasonKey: "reason.stories", params: { floors: feasibleFloors, max: maxStories }, constraint: "stories" });
  }

  // ---- 7. Lot minimums
  const lotArea = track("lot_area", minOf(rules, "lot_area", vars));
  if (lotArea) checks.push({ id: "lot_area", status: plotAreaM2 >= lotArea.value ? "allowed" : "not_allowed", reasonKey: "reason.lot_area", params: { area: plotAreaM2, min: lotArea.value }, constraint: "lot_area" });
  const lotWidth = track("lot_width", minOf(rules, "lot_width", vars));
  if (lotWidth) {
    if (params.frontageM === undefined) checks.push({ id: "lot_width", status: "maybe", reasonKey: "reason.lot_width_unknown", params: { min: lotWidth.value }, constraint: "lot_width" });
    else checks.push({ id: "lot_width", status: params.frontageM >= lotWidth.value ? "allowed" : "not_allowed", reasonKey: "reason.lot_width", params: { width: params.frontageM, min: lotWidth.value }, constraint: "lot_width" });
  }

  // ---- 8. Use-specific outputs
  const parkingPerUnit = track("parking_per_unit", minOfRange(rules, "parking_per_unit"));
  // tracked lazily so the review list only names rules the result actually used
  const commercialRate = () => track("parking_per_100m2_commercial", minOfRange(rules, "parking_per_100m2_commercial"));
  const parking = (n: number, rate = parkingPerUnit) =>
    rate ? { min: Math.ceil(n * rate.lo - 1e-9), max: Math.ceil(n * rate.hi - 1e-9) } : { min: 0, max: 0 };
  if (!parkingPerUnit && use !== "commercial") toBeChecked.add("check.engineer.parking");

  const result: AnalysisResult = {
    engineVersion: ENGINE_VERSION,
    use,
    zone: { code: rules.dist_abbr, name: rules.dist_name, plan: rules.plan?.name, curated: rules.curated },
    status: "allowed",
    checks,
    figures: {} as Figures,
    needsReview,
    toBeChecked: [],
  };
  if (buildableFootprint) result.buildableFootprint = buildableFootprint;

  if (use === "apartment_block" || use === "mixed_use") {
    let residentialGfa = achievableGfaM2;
    if (use === "mixed_use") {
      const groundCommercial = perFloorM2[0] ?? 0;
      residentialGfa = achievableGfaM2 - groundCommercial;
      result.commercial = { gfaM2: groundCommercial, netM2: round(groundCommercial * params.netToGross, 0), parking: parkingCommercialFor(groundCommercial, commercialRate()) };
    }
    const sellableM2 = round(residentialGfa * params.netToGross, 0);
    const { total, byType } = unitEstimate(sellableM2, params.unitMix, params.unitSizeM2);
    result.units = { sellableM2, total, byType, parking: parking(total) };
    if (total === 0) checks.push({ id: "units", status: "not_allowed", reasonKey: "reason.no_units" });
    const dw = rules.dwellings;
    if (dw && total > 0) {
      if (dw.provenance.status !== "verified") needsReview.push({ constraint: "unit_size", provenance: dw.provenance });
      const kinds = (["studio", "bed1", "bed2", "bed3"] as const).filter((k) => byType[k] > 0);
      // average sizes include walls/verandas share; compare the usable part (net-to-gross) with the minimum
      const small = kinds.filter((k) => params.unitSizeM2[k] < dw.minUsableM2[k] - 1e-9);
      checks.push(
        small.length
          ? { id: "unit_sizes", status: "not_allowed", reasonKey: "reason.unit_size_small", params: { type: small[0]!, size: params.unitSizeM2[small[0]!], min: dw.minUsableM2[small[0]!] } }
          : { id: "unit_sizes", status: "allowed", reasonKey: "reason.unit_size_ok" },
      );
      const cap = dw.maxStudioShare;
      if (cap && total >= cap.fromUnits && byType.studio / total > cap.share + 1e-9) {
        checks.push({ id: "studio_share", status: "not_allowed", reasonKey: "reason.studio_share", params: { share: Math.round(cap.share * 100) } });
      }
    }
  } else if (use === "house") {
    result.houses = { count: achievableGfaM2 > 0 ? 1 : 0, gfaEachM2: achievableGfaM2, parking: parking(achievableGfaM2 > 0 ? 1 : 0) };
  } else if (use === "row_houses") {
    const byArea = Math.floor(achievableGfaM2 / params.avgHouseSizeM2);
    let count = byArea;
    if (params.frontageM !== undefined) {
      const usable = params.frontageM - 2 * (setbackM ?? 0);
      count = Math.min(byArea, Math.max(0, Math.floor(usable / params.minRowHouseWidthM)));
    } else {
      checks.push({ id: "row_frontage", status: "maybe", reasonKey: "reason.row_frontage_unknown", params: { width: params.minRowHouseWidthM } });
    }
    result.houses = { count, gfaEachM2: count ? round(achievableGfaM2 / count, 0) : 0, parking: parking(count) };
    if (count < 2) checks.push({ id: "row_count", status: "not_allowed", reasonKey: "reason.row_too_few", params: { count } });
  } else if (use === "commercial") {
    const rate = commercialRate();
    result.commercial = { gfaM2: achievableGfaM2, netM2: round(achievableGfaM2 * params.netToGross, 0), parking: parkingCommercialFor(achievableGfaM2, rate) };
    if (!rate) toBeChecked.add("check.engineer.parking");
  }

  result.figures = {
    plotAreaM2: round(plotAreaM2, 1),
    ...(geometryAreaM2 !== undefined ? { geometryAreaM2 } : {}),
    far: round(far, 3),
    coverageRatio,
    maxGfaM2,
    maxCoverageM2,
    ...(setbackM !== undefined ? { setbackM } : {}),
    ...(netFootprintM2 !== undefined ? { netFootprintM2 } : {}),
    footprintM2,
    ...(maxStories !== undefined ? { maxStories } : {}),
    ...(maxHeightM !== undefined ? { maxHeightM } : {}),
    ...(floorsByHeight !== undefined ? { floorsByHeight } : {}),
    allowedFloors,
    feasibleFloors,
    achievableGfaM2,
    perFloorM2,
    ...(setbackByFloor.length ? { setbackByFloorM: setbackByFloor.slice(0, Math.max(feasibleFloors, 1)) } : {}),
    buildingHeightM,
  };
  if (!rules.curated) checks.push({ id: "zone_not_curated", status: "maybe", reasonKey: "reason.zone_not_curated", params: { zone: rules.dist_abbr } });
  result.status = worst(checks.map((c) => c.status));
  if (input.relaxations?.length && result.status !== "not_allowed") {
    const relaxed = applyRelaxations(input, result, input.relaxations, analyse);
    if (relaxed) {
      result.relaxed = relaxed;
      toBeChecked.add("check.engineer.relaxations");
    }
  }
  result.toBeChecked = [...toBeChecked];
  return result;
}

/** Smallest candidate of a min bound (e.g. 0 m where building on the boundary may be allowed). */
function minBoundLow(c: { min_val?: { expression: unknown }[] }): number {
  const vals = (c.min_val ?? []).flatMap((v) => (Array.isArray(v.expression) ? v.expression : [v.expression])).map(Number).filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : 0;
}

/** A parking requirement may be a range: OZFS list expression without min_max, e.g. [1, 1.5]. */
function minOfRange(rules: ZoneRuleSet, name: ConstraintName) {
  const c = rules.constraints[name];
  const vals = c?.min_val?.flatMap((v) => (Array.isArray(v.expression) ? v.expression : [v.expression])).map(Number).filter(Number.isFinite);
  if (!c || !vals?.length) return undefined;
  return { lo: Math.min(...vals), hi: Math.max(...vals), constraint: c };
}

function parkingCommercialFor(gfa: number, rate: ReturnType<typeof minOfRange>) {
  return rate ? { min: Math.ceil((gfa / 100) * rate.lo - 1e-9), max: Math.ceil((gfa / 100) * rate.hi - 1e-9) } : { min: 0, max: 0 };
}
