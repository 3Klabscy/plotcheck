import { describe, expect, it } from "vitest";
import { larnacaStreetSearch } from "../src/larnaca/roads.ts";
import { searchWhere } from "../src/dls/parcels.ts";

describe("plot search filter (DLS 'by plot')", () => {
  it("builds a LIKE filter with wildcards for the parts not given", () => {
    expect(searchWhere({ municipalityCode: "4000", plot: "666" })).toBe("nationalCadastralRef LIKE '4000-%-%-%-666'");
    expect(searchWhere({ municipalityCode: "4000", quarter: "3", plot: "666" })).toBe("nationalCadastralRef LIKE '4000-%-3-%-666'");
  });
  it("rejects anything that is not a plain reference part", () => {
    expect(searchWhere({ municipalityCode: "4000", plot: "666' OR '1'='1" })).toBeNull();
    expect(searchWhere({ municipalityCode: "40%", plot: "1" })).toBeNull();
    expect(searchWhere({ municipalityCode: "4000", quarter: "3%", plot: "1" })).toBeNull();
    expect(searchWhere({ municipalityCode: "4000" })).toBeNull();
  });
});

describe("street search (Larnaca)", () => {
  it("finds streets in Greek, without accents, and in Latin script", () => {
    expect(larnacaStreetSearch("Ερμού")[0]!.name).toMatch(/^Ερμού/);
    expect(larnacaStreetSearch("ερμου")[0]!.name).toMatch(/^Ερμού/);
    expect(larnacaStreetSearch("ermou")[0]!.name).toMatch(/^Ερμού/);
  });
  it("matches abbreviations word by word", () => {
    expect(larnacaStreetSearch("Γρ. Αυξεντίου")[0]!.name).toMatch(/^Γρηγορίου Αυξεντίου/);
  });
  it("numbers separate stretches of the same street name", () => {
    const hits = larnacaStreetSearch("Ερμού").filter((h) => h.name.startsWith("Ερμού"));
    if (hits.length > 1) expect(hits.map((h) => h.part?.n)).toEqual(hits.map((_, i) => i + 1));
    for (const h of hits) expect(h.bbox[0]).toBeLessThanOrEqual(h.center.lng);
  });
});
