// Server-side only (the JSON is ~1 MB): road access, street frontage and postcodes for plots in
// the Larnaca map area. See data/larnaca-roads-dls.json for sources and licence notes.
import type { Parcel } from "@plotcheck/core";
import roadsData from "../../data/larnaca-roads-dls.json" with { type: "json" };
import streetsData from "../../data/larnaca-streets-cypruspost.json" with { type: "json" };

interface RoadsFile {
  bbox: [number, number, number, number];
  names: [string, number[]][];
  links: [number, number[]][];
}
const DATA = roadsData as unknown as RoadsFile;

export interface RoadFrontage {
  /** Official street name (Cyprus Post spelling); null when the road segment is unnamed. */
  name: string | null;
  postcodes: number[];
  lengthM: number;
}

export interface RoadContext {
  covered: boolean; // plot inside the area the road data covers
  roadAccess: "yes" | "no" | "unknown";
  frontage: RoadFrontage[];
  postcodes: number[];
}

const R = 6_371_008.8;
const LAT0 = 34.92;
const K = Math.cos((LAT0 * Math.PI) / 180);
const toXY = (lng: number, lat: number): [number, number] => [((lng * Math.PI) / 180) * R * K, ((lat * Math.PI) / 180) * R];
const CELL = 50; // m

interface Seg { a: [number, number]; b: [number, number]; name: number }
let index: Map<string, Seg[]> | undefined;

function buildIndex(): Map<string, Seg[]> {
  const idx = new Map<string, Seg[]>();
  for (const [name, flat] of DATA.links) {
    for (let i = 2; i + 1 < flat.length; i += 2) {
      const a = toXY(flat[i - 2]!, flat[i - 1]!);
      const b = toXY(flat[i]!, flat[i + 1]!);
      const seg = { a, b, name };
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
        for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
          const k = `${gx},${gy}`;
          const list = idx.get(k);
          if (list) list.push(seg);
          else idx.set(k, [seg]);
        }
    }
  }
  return idx;
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Plot edge within this distance of a road centreline counts as fronting it. */
const MAX_DIST_M = 12;
const MIN_FRONTAGE_M = 3;

function postcodesFor(all: number[], municipalityCode?: string): number[] {
  // Larnaca municipality (DLS code 4000) uses 60xx postcodes; surrounding communities 7xxx.
  if (!municipalityCode) return all;
  const town = municipalityCode === "4000";
  const f = all.filter((pc) => (town ? pc >= 6000 && pc < 7000 : pc >= 7000));
  return f.length ? f : all;
}

export function larnacaRoadContext(parcel: Parcel): RoadContext {
  const ring = parcel.geometry.type === "Polygon" ? parcel.geometry.coordinates[0]! : parcel.geometry.coordinates[0]![0]!;
  const [w, s, e, n] = DATA.bbox;
  const covered = ring.every(([lng, lat]) => lng! >= w && lng! <= e && lat! >= s && lat! <= n);
  if (!covered) return { covered: false, roadAccess: "unknown", frontage: [], postcodes: [] };
  index ??= buildIndex();
  const byName = new Map<number, number>();
  const rings = parcel.geometry.type === "Polygon" ? [parcel.geometry.coordinates[0]!] : parcel.geometry.coordinates.map((p) => p[0]!);
  for (const rg of rings) {
    for (let i = 1; i < rg.length; i++) {
      const a = toXY(rg[i - 1]![0]!, rg[i - 1]![1]!);
      const b = toXY(rg[i]![0]!, rg[i]![1]!);
      const edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(edge));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const p: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        let best: { d: number; name: number } | undefined;
        const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const sg of index.get(`${gx + dx},${gy + dy}`) ?? []) {
              const d = segDist(p, sg.a, sg.b);
              if (d <= MAX_DIST_M && (!best || d < best.d || (sg.name >= 0 && best.name < 0 && d < best.d + 3))) best = { d, name: sg.name };
            }
        if (best) byName.set(best.name, (byName.get(best.name) ?? 0) + edge / steps);
      }
    }
  }
  const muni = parcel.identifiers["municipalityCode"];
  const frontage: RoadFrontage[] = [...byName.entries()]
    .filter(([, len]) => len >= MIN_FRONTAGE_M)
    .map(([ni, len]) => {
      const entry = ni >= 0 ? DATA.names[ni] : undefined;
      return { name: entry ? entry[0] : null, postcodes: entry ? postcodesFor(entry[1], muni) : [], lengthM: Math.round(len) };
    })
    .sort((x, y) => y.lengthM - x.lengthM);
  const postcodes = [...new Set(frontage.flatMap((f) => f.postcodes))].sort();
  return { covered: true, roadAccess: frontage.length ? "yes" : "no", frontage, postcodes };
}

/** Plan-street groups (Larnaca LP §11.6) by official street name. */
const PLAN_STREETS: Record<string, "kep" | "axis"> = {
  "Ζήνωνος Κιτιέως": "kep",
  "Ερμού": "kep",
  "Σταδίου": "kep",
  "Λόρδου Βύρωνος": "kep",
  "Ζήνωνος Πιερίδη": "kep",
  "Αρχιεπισκόπου Μακαρίου Γ'": "axis",
  "Γρηγορίου Αυξεντίου": "axis",
  "Αρτέμιδος": "axis", // §11.6.3.1: northern part only — checked by latitude below
};

export function planGroupsFromRoads(parcel: Parcel, ctx: RoadContext): ("kep" | "axis")[] {
  if (parcel.identifiers["municipalityCode"] !== "4000") return [];
  const ring = parcel.geometry.type === "Polygon" ? parcel.geometry.coordinates[0]! : parcel.geometry.coordinates[0]![0]!;
  const lat = ring.reduce((s, c) => s + c[1]!, 0) / ring.length;
  return [
    ...new Set(
      ctx.frontage
        .filter((f) => f.name && f.lengthM >= 8 && PLAN_STREETS[f.name] && !(f.name === "Αρτέμιδος" && lat < 34.9105))
        .map((f) => PLAN_STREETS[f.name!]!),
    ),
  ];
}

// ---------- Street search (address search on the map) ----------


const foldName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleUpperCase("el").replace(/[^Α-ΩA-Z0-9]+/g, " ").trim();

interface StreetEntry { name: string; en: string[]; postcodes: number[]; bbox: [number, number, number, number]; center: [number, number]; lengthM: number; keys: string[][] }
let streets: StreetEntry[] | undefined;

/** Split each street's links into separate stretches (same name in different areas). */
function clusters(links: number[][]): number[][][] {
  const parent = links.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const ends = links.map((f) => [toXY(f[0]!, f[1]!), toXY(f[f.length - 2]!, f[f.length - 1]!)]);
  for (let i = 0; i < links.length; i++)
    for (let j = i + 1; j < links.length; j++)
      if (ends[i]!.some((a) => ends[j]!.some((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 300))) parent[find(i)] = find(j);
  const groups = new Map<number, number[][]>();
  links.forEach((l, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(l));
  return [...groups.values()];
}

function buildStreets(): StreetEntry[] {
  const en = new Map<string, Set<string>>();
  for (const row of (streetsData as unknown as { rows: (string | number)[][] }).rows) {
    const k = foldName(String(row[0] ?? ""));
    if (!k || !row[1]) continue;
    for (const key of new Set([k, k.replace(/ ΛΕΩΦΟΡΟΣ$/, "")])) (en.get(key) ?? en.set(key, new Set()).get(key)!).add(String(row[1]));
  }
  const byName = new Map<number, number[][]>();
  for (const [name, flat] of DATA.links) if (name >= 0) (byName.get(name) ?? byName.set(name, []).get(name)!).push(flat);
  return DATA.names.flatMap(([name, postcodes], i) => {
    const english = [...(en.get(foldName(name)) ?? [])];
    const keys = [foldName(name), ...english.map(foldName)].map((k) => k.split(" "));
    return clusters(byName.get(i) ?? []).map((group) => {
      const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      let lengthM = 0;
      const pts: [number, number][] = [];
      for (const flat of group)
        for (let k = 0; k + 1 < flat.length; k += 2) {
          pts.push([flat[k]!, flat[k + 1]!]);
          b[0] = Math.min(b[0], flat[k]!); b[1] = Math.min(b[1], flat[k + 1]!);
          b[2] = Math.max(b[2], flat[k]!); b[3] = Math.max(b[3], flat[k + 1]!);
          if (k >= 2) { const a = toXY(flat[k - 2]!, flat[k - 1]!), c = toXY(flat[k]!, flat[k + 1]!); lengthM += Math.hypot(a[0] - c[0], a[1] - c[1]); }
        }
      // a point on the road, nearest the middle of the stretch
      const mid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const center = pts.reduce((best, p) => (Math.hypot(p[0] - mid[0]!, p[1] - mid[1]!) < Math.hypot(best[0] - mid[0]!, best[1] - mid[1]!) ? p : best), pts[0]!);
      return { name, en: english, postcodes, bbox: b, center, lengthM, keys };
    });
  });
}

/** Every query word must start a word of the name ("Γρ. Αυξεντίου" finds "Γρηγόρη Αυξεντίου"). */
function matchScore(keys: string[][], q: string[]): number | undefined {
  let best: number | undefined;
  for (const words of keys) {
    if (!q.every((w) => words.some((x) => x.startsWith(w)))) continue;
    const score = words.join(" ") === q.join(" ") ? 0 : words[0]!.startsWith(q[0]!) ? 1 : 2;
    best = best === undefined ? score : Math.min(best, score);
  }
  return best;
}

/** Larnaca streets by Greek or English name; one result per separate stretch of the street. */
export function larnacaStreetSearch(query: string, opts?: { limit?: number }) {
  const q = foldName(query).split(" ").filter(Boolean);
  if (q.join("").length < 2) return [];
  streets ??= buildStreets();
  const scored = streets
    .map((s) => ({ s, score: matchScore(s.keys, q) }))
    .filter((x): x is { s: StreetEntry; score: number } => x.score !== undefined)
    .sort((a, b) => a.score - b.score || a.s.name.localeCompare(b.s.name, "el") || b.s.lengthM - a.s.lengthM);
  const parts = new Map<string, number>();
  for (const { s } of scored) parts.set(s.name, (parts.get(s.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return scored.slice(0, opts?.limit ?? 12).map(({ s }) => ({
    name: s.en[0] ? `${s.name} (${s.en[0]})` : s.name,
    ...(parts.get(s.name)! > 1 ? { part: { n: seen.set(s.name, (seen.get(s.name) ?? 0) + 1).get(s.name)!, of: parts.get(s.name)! } } : {}),
    postcodes: s.postcodes.map(String),
    center: { lng: s.center[0], lat: s.center[1] },
    bbox: s.bbox,
  }));
}
