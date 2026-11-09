// Contour lines from the DLS terrain model (marching squares on a gridded DTM window).
import type { ProviderContext } from "@plotcheck/country-sdk";
import { terrainGrid, type Grid } from "./elevation.ts";

export interface ContourCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { elevation: number; major: boolean }; geometry: { type: "LineString"; coordinates: [number, number][] } }[];
  interval: number;
  source: string;
}

/** Pick a contour interval that gives a readable number of lines for this relief. */
export function chooseInterval(min: number, max: number): number {
  const range = max - min;
  for (const i of [0.5, 1, 2, 5, 10, 20, 50]) if (range / i <= 30) return i;
  return 100;
}

/** Contour polylines of a grid at the given levels (edges interpolated linearly, segments joined). */
export function contourLines(g: Grid, levels: number[]): Map<number, [number, number][][]> {
  const out = new Map<number, [number, number][][]>();
  const v = (c: number, r: number) => g.values[r * g.cols + c]!;
  const pt = (c: number, r: number): [number, number] => [g.x0 + c * g.dx, g.y0 - r * g.dy];
  for (const level of levels) {
    const segs: [[number, number], [number, number]][] = [];
    for (let r = 0; r + 1 < g.rows; r++)
      for (let c = 0; c + 1 < g.cols; c++) {
        const a = v(c, r), b = v(c + 1, r), d = v(c, r + 1), e = v(c + 1, r + 1); // a b / d e
        if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(d) || Number.isNaN(e)) continue;
        // corners in order: top-left a, top-right b, bottom-right e, bottom-left d
        const corners: [number, number, number][] = [[a, c, r], [b, c + 1, r], [e, c + 1, r + 1], [d, c, r + 1]];
        const cross: [number, number][] = [];
        for (let k = 0; k < 4; k++) {
          const [v1, c1, r1] = corners[k]!, [v2, c2, r2] = corners[(k + 1) % 4]!;
          if ((v1 < level) !== (v2 < level)) {
            const t = (level - v1) / (v2 - v1);
            cross.push(pt(c1 + (c2 - c1) * t, r1 + (r2 - r1) * t));
          }
        }
        if (cross.length === 2) segs.push([cross[0]!, cross[1]!]);
        else if (cross.length === 4) {
          // saddle: decide by the centre value
          const centre = (a + b + d + e) / 4;
          if ((centre < level) === (a < level)) { segs.push([cross[0]!, cross[3]!]); segs.push([cross[1]!, cross[2]!]); }
          else { segs.push([cross[0]!, cross[1]!]); segs.push([cross[2]!, cross[3]!]); }
        }
      }
    out.set(level, join(segs));
  }
  return out;
}

const key = (p: [number, number]) => `${p[0].toFixed(8)},${p[1].toFixed(8)}`;

function join(segs: [[number, number], [number, number]][]): [number, number][][] {
  const ends = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) (ends.get(key(p)) ?? ends.set(key(p), []).get(key(p))!).push(i);
  });
  const used = new Uint8Array(segs.length);
  const lines: [number, number][][] = [];
  const extend = (line: [number, number][], atEnd: boolean) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1]! : line[0]!;
      const next = (ends.get(key(tip)) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next]!;
      const other = key(a) === key(tip) ? b : a;
      if (atEnd) line.push(other);
      else line.unshift(other);
    }
  };
  segs.forEach(([a, b], i) => {
    if (used[i]) return;
    used[i] = 1;
    const line: [number, number][] = [a, b];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  });
  return lines;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Contours over a box (≤ ~1 km across), from the 2019 DTM resampled to 2 m. */
export async function cyContours(ctx: ProviderContext, box: [number, number, number, number]): Promise<ContourCollection | undefined> {
  const widthM = (box[2] - box[0]) * 91_300, heightM = (box[3] - box[1]) * 111_000;
  const step = Math.max(2, Math.ceil(Math.max(widthM, heightM) / 400)); // ≤ ~400×400 cells
  const g = await terrainGrid(ctx, box, step);
  if (!g) return undefined;
  let min = Infinity, max = -Infinity;
  for (const x of g.values) if (!Number.isNaN(x)) { min = Math.min(min, x); max = Math.max(max, x); }
  if (!Number.isFinite(min)) return undefined;
  const interval = chooseInterval(min, max);
  const levels: number[] = [];
  for (let l = Math.ceil(min / interval) * interval; l <= max; l += interval) levels.push(Math.round(l * 10) / 10);
  const major = interval * 5;
  const features: ContourCollection["features"] = [];
  for (const [level, lines] of contourLines(g, levels))
    for (const line of lines)
      if (line.length >= 5)
        features.push({ type: "Feature", properties: { elevation: level, major: Math.abs(level / major - Math.round(level / major)) < 1e-6 }, geometry: { type: "LineString", coordinates: line.map(([x, y]) => [r6(x), r6(y)]) } });
  return { type: "FeatureCollection", features, interval, source: `DLS DTM 2019 (${step} m grid)` };
}
