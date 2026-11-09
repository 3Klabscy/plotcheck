// Small geodesy helpers for the measuring tools (WGS84, metres). Good to a few cm at plot scale.
const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthM(pts: [number, number][], closed = false): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distanceM(pts[i - 1]!, pts[i]!);
  if (closed && pts.length > 2) s += distanceM(pts[pts.length - 1]!, pts[0]!);
  return s;
}

/** Area of a polygon ring on the sphere (same formula as turf/area). */
export function ringAreaM2(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]!, p2 = pts[(i + 1) % pts.length]!, p3 = pts[(i + 2) % pts.length]!;
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return Math.abs((total * R * R) / 2);
}
