// Transverse Mercator (Snyder, "Map Projections — A Working Manual", 1987, §8), forward and inverse.
// Millimetre-level within ~3° of the central meridian, enough for national grids such as CGRS93 / LTM.

export interface TmParams {
  /** Central meridian, degrees. */
  lon0: number;
  /** Latitude of origin, degrees. */
  lat0: number;
  k0: number;
  falseEasting: number;
  falseNorthing: number;
  /** Ellipsoid semi-major axis (m) and inverse flattening. */
  a: number;
  invF: number;
}

const rad = Math.PI / 180;

function consts(p: TmParams) {
  const f = 1 / p.invF;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const M = (phi: number) =>
    p.a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  return { e2, ep2, M, M0: M(p.lat0 * rad) };
}

/** WGS84/ETRS89 lng/lat (degrees) → easting/northing (metres). */
export function tmForward(p: TmParams, lng: number, lat: number): [number, number] {
  const { e2, ep2, M, M0 } = consts(p);
  const phi = lat * rad, lam = (lng - p.lon0) * rad;
  const N = p.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = lam * Math.cos(phi);
  const x = p.k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    p.k0 *
    (M(phi) - M0 + N * Math.tan(phi) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [x + p.falseEasting, y + p.falseNorthing];
}

/** Easting/northing (metres) → lng/lat (degrees). */
export function tmInverse(p: TmParams, x: number, y: number): [number, number] {
  const { e2, ep2, M0 } = consts(p);
  const Mv = M0 + (y - p.falseNorthing) / p.k0;
  const mu = Mv / (p.a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = p.a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2, C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (p.a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = (x - p.falseEasting) / (N1 * p.k0);
  const phi =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lam = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return [p.lon0 + lam / rad, phi / rad];
}

// ---------- 7-parameter datum shift (Helmert), and a national grid = shift + TM ----------

export interface Helmert7 {
  /** Translations (m), rotations (arc-seconds), scale (ppm), applied from WGS84/ETRS89 to the national datum. */
  tx: number; ty: number; tz: number;
  rx: number; ry: number; rz: number;
  ds: number;
  convention: "coordinate_frame" | "position_vector";
}

export interface NationalGrid {
  /** e.g. "CGRS93 / LTM" */
  name: string;
  epsg?: number;
  tm: TmParams;
  /** Datum shift from WGS84/ETRS89 to the grid's datum (omitted = none). */
  toDatum?: Helmert7;
}

const toXYZ = (a: number, e2: number, lng: number, lat: number): [number, number, number] => {
  const p = lat * rad, l = lng * rad, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [N * Math.cos(p) * Math.cos(l), N * Math.cos(p) * Math.sin(l), N * (1 - e2) * Math.sin(p)];
};
const toGeo = (a: number, e2: number, [X, Y, Z]: [number, number, number]): [number, number] => {
  const l = Math.atan2(Y, X), p0 = Math.hypot(X, Y);
  let p = Math.atan2(Z, p0 * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    const h = p0 / Math.cos(p) - N;
    p = Math.atan2(Z, p0 * (1 - (e2 * N) / (N + h)));
  }
  return [l / rad, p / rad];
};

function applyHelmert(h: Helmert7, xyz: [number, number, number], inverse: boolean): [number, number, number] {
  const s = inverse ? -1 : 1, sec = rad / 3600, cf = h.convention === "coordinate_frame" ? -1 : 1;
  const k = 1 + s * h.ds * 1e-6, rx = s * cf * h.rx * sec, ry = s * cf * h.ry * sec, rz = s * cf * h.rz * sec;
  const [X, Y, Z] = xyz;
  return [s * h.tx + k * (X - rz * Y + ry * Z), s * h.ty + k * (rz * X + Y - rx * Z), s * h.tz + k * (-ry * X + rx * Y + Z)];
}

function shift(g: NationalGrid, lng: number, lat: number, inverse: boolean): [number, number] {
  if (!g.toDatum) return [lng, lat];
  const e2 = (1 / g.tm.invF) * (2 - 1 / g.tm.invF);
  return toGeo(g.tm.a, e2, applyHelmert(g.toDatum, toXYZ(g.tm.a, e2, lng, lat), inverse));
}

/** WGS84/ETRS89 lng/lat → national grid easting/northing. */
export function toGrid(g: NationalGrid, lng: number, lat: number): [number, number] {
  const [l, p] = shift(g, lng, lat, false);
  return tmForward(g.tm, l, p);
}

/** National grid easting/northing → WGS84/ETRS89 lng/lat (iterated until it round-trips to < 0.1 mm). */
export function fromGrid(g: NationalGrid, x: number, y: number): [number, number] {
  const [lt, pt] = tmInverse(g.tm, x, y);
  let [lng, lat] = shift(g, lt, pt, true);
  for (let i = 0; i < 4; i++) {
    const [ex, ey] = toGrid(g, lng, lat);
    if (Math.abs(ex - x) < 1e-4 && Math.abs(ey - y) < 1e-4) break;
    const [le, pe] = tmInverse(g.tm, ex, ey);
    lng += lt - le;
    lat += pt - pe;
  }
  return [lng, lat];
}
