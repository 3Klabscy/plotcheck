import { describe, expect, it } from "vitest";
import { areaFromFields, parseFields, populationChoices } from "../src/dls/population.ts";
import { tidyLabel } from "../../../api/src/legend.ts";

// trimmed GetFeatureInfo answer of the community layer (Larnaca municipality, census 2011)
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<FeatureInfoResponse xmlns="http://www.esri.com/wms">
<FIELDS OBJECTID="203" VIL_CCD_1="4000" VIL_NM_E_1="LARNAKA" VIL_NM_G_1="ΛΑΡΝΑΚΑ" TACTPR="24968" TUNEPR="3605" TEMPPR="21363" TCOC_CY="37777" TCOC_EU="8256" TCOC_NEU="5308" YT0_14="7186" YT15_24="7499" YT25_64="28750" YT65_="7989" NR_LQ="26619" NR_HHOLDS="19649" DY_LT1980="7053" DY1981_200="12438" DY2001_201="6536" TSTAT="51468" MSTAT="24613" FSTAT="26855" HHOLDTPOP="51214" TAVY="39.434019" DENST="1753.731979" PTEDUUNI="17.64148" PTEDU6="13.423061" PTEDU78="4.218418"></FIELDS>
</FeatureInfoResponse>`;

describe("census figures (DLS PD service)", () => {
  it("reads every field of the area", () => {
    const a = areaFromFields("community", parseFields(XML)!)!;
    expect(a.name).toEqual({ el: "ΛΑΡΝΑΚΑ", en: "LARNAKA" });
    const row = (k: string) => a.sections.flatMap((s) => s.rows).find((r) => r.key === `cy.stats.${k}`);
    expect(row("total")?.value).toBe(51468);
    expect(row("women")).toMatchObject({ value: 26855, of: 51468 });
    expect(row("age65")?.value).toBe(7989);
    expect(row("citEU")).toMatchObject({ value: 8256, of: 37777 + 8256 + 5308 });
    expect(row("unemploymentRate")?.value).toBeCloseTo(14.44, 2);
    expect(row("hhSize")?.value).toBeCloseTo(2.61, 2);
    expect(row("eduTertiary")).toMatchObject({ kind: "percent" });
  });
  it("repairs Greek names sent as Windows-1253 bytes", () => {
    const a = areaFromFields("district", { DIST_NM_E: "LARNAKA", DIST_NM_G: "ËÁÑÍÁÊÁ", T: "143192" })!;
    expect(a.name.el).toBe("ΛΑΡΝΑΚΑ");
  });
  it("offers each level only with the indicators it has", () => {
    expect(populationChoices.layers["quarter|women25_64"]).toBe("show:26");
    expect(populationChoices.layers["community|unemployed_men"]).toBe("show:49");
    expect(populationChoices.layers["postcode|unemployed_men"]).toBeUndefined();
    expect(populationChoices.layers[populationChoices.initial.join("|")]).toBeDefined();
  });
  it("tidies legend labels", () => {
    expect(tidyLabel("66,000001 - 220,000000")).toBe("67 – 220");
    expect(tidyLabel("0,000000 - 66,000000")).toBe("0 – 66");
  });
});
