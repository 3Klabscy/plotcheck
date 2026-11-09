import type { Parcel } from "@plotcheck/core";
import { LARNACA_PLAN_STREETS, type PlanStreet } from "./streets.ts";

export interface StreetFrontage {
  id: string;
  group: PlanStreet["group"];
  name: string;
  /** Length of the plot boundary lying along the street (m). */
  lengthM: number;
}

/** Plot edge within this distance of the street centreline counts as fronting it (half road width + verge). */
const MAX_DIST_M = 14;
/** Shorter contact than this is treated as a corner touch, not frontage. */
const MIN_FRONTAGE_M = 8;

const R = 6_371_008.8;
const toXY = (lng: number, lat: number, lat0: number): [number, number] => [
  ((lng * Math.PI) / 180) * R * Math.cos((lat0 * Math.PI) / 180),
  ((lat * Math.PI) / 180) * R,
];

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rings(p: Parcel): number[][][] {
  return p.geometry.type === "Polygon" ? [p.geometry.coordinates[0]!] : p.geometry.coordinates.map((poly) => poly[0]!);
}

/** Which Larnaca plan streets (Central Commercial Area streets, commercial axes) the plot fronts. */
export function larnacaStreetFrontage(parcel: Parcel, streets: PlanStreet[] = LARNACA_PLAN_STREETS): StreetFrontage[] {
  const lat0 = parcel.geometry.type === "Polygon" ? parcel.geometry.coordinates[0]![0]![1]! : parcel.geometry.coordinates[0]![0]![0]![1]!;
  const out: StreetFrontage[] = [];
  for (const st of streets) {
    const segs: [[number, number], [number, number]][] = [];
    for (const line of st.lines) for (let i = 1; i < line.length; i++) segs.push([toXY(line[i - 1]![0]!, line[i - 1]![1]!, lat0), toXY(line[i]![0]!, line[i]![1]!, lat0)]);
    let length = 0;
    for (const ring of rings(parcel)) {
      for (let i = 1; i < ring.length; i++) {
        const a = toXY(ring[i - 1]![0]!, ring[i - 1]![1]!, lat0);
        const b = toXY(ring[i]![0]!, ring[i]![1]!, lat0);
        const edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(edge)); // sample every ~1 m
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const p: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
          if (segs.some(([s, e]) => segDist(p, s, e) <= MAX_DIST_M)) length += edge / n;
        }
      }
    }
    if (length >= MIN_FRONTAGE_M) out.push({ id: st.id, group: st.group, name: st.name, lengthM: Math.round(length) });
  }
  return out.sort((x, y) => y.lengthM - x.lengthM);
}
