import { describe, expect, it } from "vitest";
import { fromGrid, tmForward, tmInverse, toGrid, type NationalGrid, type TmParams } from "../src/index.ts";

// CGRS93 / Cyprus Local Transverse Mercator (EPSG:6312), as the DLS publishes its data (no datum shift).
const CY: TmParams = { lon0: 33, lat0: 0, k0: 0.99995, falseEasting: 200000, falseNorthing: -3500000, a: 6378137, invF: 298.257223563 };

// The DLS server applies ESRI CGRS_1993_To_ETRS_1989 = EPSG:7721 parameters, reversed, coordinate frame.
const CGRS93: NationalGrid = { name: "CGRS93 / LTM", epsg: 6312, tm: CY,
  toDatum: { tx: -8.846, ty: 4.394, tz: 1.122, rx: -0.00237, ry: -0.146528, rz: 0.130428, ds: -0.783926, convention: "coordinate_frame" } };

describe("Transverse Mercator (CGRS93 / LTM)", () => {
  // reference values from the DLS ArcGIS GeometryServer /project (4326 → 6312), 2026-11-09
  const ref: [number, number, number, number][] = [
    [33.6152, 34.9301, 256209.5465, 366817.6916],
    [32.8634, 34.9364, 187524.7608, 367352.3183],
    [34.55, 35.68, 340318.4609, 450946.4790],
    [32.3, 34.75, 135910.8939, 346889.2077],
  ];
  it("matches the DLS server to the millimetre", () => {
    for (const [lng, lat, x, y] of ref) {
      const [e, n] = toGrid(CGRS93, lng, lat);
      expect(Math.abs(e - x)).toBeLessThan(0.005);
      expect(Math.abs(n - y)).toBeLessThan(0.005);
    }
  });
  it("puts the DLS terrain-tile corners on the 2.5 km grid", () => {
    const [e, n] = toGrid(CGRS93, 33.601841941307896, 34.91378182435104); // tile 2550-3650, south-west corner
    expect(e).toBeCloseTo(255000, 1);
    expect(n).toBeCloseTo(365000, 1);
  });
  it("converts grid coordinates back to lng/lat", () => {
    for (const [lng, lat, x, y] of ref) {
      const [l, p] = fromGrid(CGRS93, x, y);
      expect(Math.abs(l - lng)).toBeLessThan(1e-7);
      expect(Math.abs(p - lat)).toBeLessThan(1e-7);
    }
  });
  it("inverts the plain projection", () => {
    for (const [lng, lat] of ref) {
      const [e, n] = tmForward(CY, lng, lat);
      const [lng2, lat2] = tmInverse(CY, e, n);
      expect(Math.abs(lng2 - lng)).toBeLessThan(1e-8);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-8);
    }
  });
});
