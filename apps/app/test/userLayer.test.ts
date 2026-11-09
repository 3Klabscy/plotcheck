import { describe, expect, it } from "vitest";
import type { NationalGrid } from "@plotcheck/core";
import { importFile, ImportError, toDxf, toKml, type UserCollection } from "../src/lib/userLayer";

const CGRS93: NationalGrid = {
  name: "CGRS93 / LTM", epsg: 6312,
  tm: { lon0: 33, lat0: 0, k0: 0.99995, falseEasting: 200000, falseNorthing: -3500000, a: 6378137, invF: 298.257223563 },
  toDatum: { tx: -8.846, ty: 4.394, tz: 1.122, rx: -0.00237, ry: -0.146528, rz: 0.130428, ds: -0.783926, convention: "coordinate_frame" },
};

// A surveyor's DXF in CGRS93 metres: a closed LWPOLYLINE, an old-style POLYLINE, a LINE and a POINT.
const DXF = [
  "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LWPOLYLINE", "8", "BOUNDARY", "90", "4", "70", "1",
  "10", "256209.5465", "20", "366817.6916", "10", "256229.5465", "20", "366817.6916", "10", "256229.5465", "20", "366837.6916", "10", "256209.5465", "20", "366837.6916",
  "0", "POLYLINE", "8", "ROAD", "66", "1", "70", "0",
  "0", "VERTEX", "8", "ROAD", "10", "256200", "20", "366800",
  "0", "VERTEX", "8", "ROAD", "10", "256250", "20", "366800",
  "0", "SEQEND",
  "0", "LINE", "8", "AXIS", "10", "256200", "20", "366810", "11", "256260", "21", "366810",
  "0", "POINT", "8", "PEG", "10", "256209.5465", "20", "366817.6916",
  "0", "ENDSEC", "0", "EOF",
].join("\n");

describe("import", () => {
  it("reads a CGRS93 DXF and places it on the map (lng/lat)", () => {
    const fs = importFile("site.dxf", DXF, CGRS93);
    expect(fs.map((f) => f.geometry.type)).toEqual(["Polygon", "LineString", "LineString", "Point"]);
    const pt = fs[3]!.geometry.coordinates as [number, number];
    // 256209.5465 / 366817.6916 is 33.6152, 34.9301 (DLS GeometryServer)
    expect(pt[0]).toBeCloseTo(33.6152, 6);
    expect(pt[1]).toBeCloseTo(34.9301, 6);
    expect(fs[0]!.properties.layer).toBe("BOUNDARY");
  });
  it("reads KML and GeoJSON in lng/lat as they are", () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>A &amp; B</name><Polygon><outerBoundaryIs><LinearRing><coordinates>33.6,34.9,0 33.61,34.9,0 33.61,34.91,0 33.6,34.9,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const k = importFile("a.kml", kml);
    expect(k[0]!.properties.name).toBe("A & B");
    expect(k[0]!.geometry.type).toBe("Polygon");
    const g = importFile("b.geojson", JSON.stringify({ type: "Feature", properties: { name: "x" }, geometry: { type: "MultiPoint", coordinates: [[33.6, 34.9], [33.7, 34.95]] } }));
    expect(g).toHaveLength(2);
  });
  it("refuses what it cannot read", () => {
    expect(() => importFile("a.shp", "x")).toThrow(ImportError);
    expect(() => importFile("a.geojson", "{oops")).toThrow(ImportError);
    expect(() => importFile("a.dxf", DXF)).toThrow(/unknown_crs/); // grid coordinates without a grid
  });
});

describe("export", () => {
  it("writes DXF in CGRS93 that reads back to the same place", () => {
    const fc: UserCollection = { type: "FeatureCollection", features: importFile("site.dxf", DXF, CGRS93) };
    const dxf = toDxf(fc, CGRS93);
    expect(dxf).toContain("256209.547");
    const back = importFile("again.dxf", dxf, CGRS93);
    expect(back).toHaveLength(4);
    const [a, b] = [fc.features[0]!.geometry.coordinates as number[][][], back[0]!.geometry.coordinates as number[][][]];
    expect(b[0]![2]![0]).toBeCloseTo(a[0]![2]![0]!, 7);
    expect(b[0]![2]![1]).toBeCloseTo(a[0]![2]![1]!, 7);
  });
  it("writes KML that reads back", () => {
    const fc: UserCollection = { type: "FeatureCollection", features: importFile("site.dxf", DXF, CGRS93) };
    expect(importFile("x.kml", toKml(fc, "t")).map((f) => f.geometry.type)).toEqual(["Polygon", "LineString", "LineString", "Point"]);
  });
});
