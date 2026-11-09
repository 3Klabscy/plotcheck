import type { CountryModule } from "@plotcheck/country-sdk";
import { dlsInspireParcels, dlsRestParcels, palSurveyParcels } from "./dls/parcels.ts";
import { dlsPlanningZones } from "./dls/zones.ts";
import { cyPlotIdSchema } from "./plotId.ts";
import { cyRuleLayers, cySourceLayer, cyUsesForZone } from "./rules.ts";
import { cyRelaxationsFor } from "./relaxations.ts";
import { cySiteContextWithElevation } from "./site.ts";
import { cyFinanceDefaults } from "./finance.ts";
import { cyRestrictionLayers, larnacaNoiseFor } from "./restrictions.ts";
import { larnacaStreetSearch } from "./larnaca/roads.ts";
import { cyMapLayers } from "./mapLayers.ts";
import { cyContours } from "./dls/contours.ts";
import el from "./i18n/el.ts";
import en from "./i18n/en.ts";

export const cyprus: CountryModule = {
  code: "CY",
  nameKey: "cy.name",
  locales: ["el", "en"],
  currency: "EUR",
  bbox: [32.2, 34.5, 34.65, 35.75],
  defaultView: { center: { lng: 33.62, lat: 34.92 }, zoom: 15 },
  // Tried in order: fast REST query, then the standard INSPIRE WFS, then PAL (disabled).
  parcelProviders: [dlsRestParcels, dlsInspireParcels, palSurveyParcels],
  planningProviders: [dlsPlanningZones],
  restrictionLayers: cyRestrictionLayers,
  restrictionsForZone: (zone) => [larnacaNoiseFor(zone.zoneCode, zone.planRef)].filter((x) => x !== undefined),
  plotIdSchema: cyPlotIdSchema,
  ruleLayers: cyRuleLayers,
  usesForZone: cyUsesForZone,
  sourceLayerForZone: cySourceLayer,
  relaxationsFor: cyRelaxationsFor,
  siteContext: cySiteContextWithElevation,
  financeDefaults: cyFinanceDefaults,
  streetSearch: larnacaStreetSearch,
  contours: cyContours,
  // CGRS93 / Cyprus LTM (EPSG:6312). Datum shift = EPSG:7721 reversed (coordinate frame), which is what
  // the DLS GeometryServer applies by default (ESRI 108128/108129); checked to < 5 mm, 2026-11-09.
  nationalGrid: {
    name: "CGRS93 / LTM",
    epsg: 6312,
    tm: { lon0: 33, lat0: 0, k0: 0.99995, falseEasting: 200000, falseNorthing: -3500000, a: 6378137, invF: 298.257223563 },
    toDatum: { tx: -8.846, ty: 4.394, tz: 1.122, rx: -0.00237, ry: -0.146528, rz: 0.130428, ds: -0.783926, convention: "coordinate_frame" },
  },
  coverage: [{ dist_abbr: "Κα4", planName: "ΤΟΠΙΚΟ ΣΧΕΔΙΟ ΛΑΡΝΑΚΑΣ", status: "curated" }],
  defaults: {
    storeyHeightM: 3.2,
    netToGrossResidential: 0.82,
    avgUnitSizeM2: { studio: 45, bed1: 60, bed2: 85, bed3: 115 },
    avgHouseSizeM2: 160,
    minRowHouseWidthM: 6.5,
  },
  legal: { disclaimerKey: "cy.disclaimer", attributionKeys: ["cy.attribution.dls"] },
  features: { docScan: false, plotIdSearch: true, restrictions: true, financials: true, brokering: false, ads: false },
  mapLayers: cyMapLayers,
  messages: { el, en },
};

export { dlsInspireParcels, dlsRestParcels, palSurveyParcels, dlsPlanningZones };
export { parseRestParcels } from "./dls/parcels.ts";
export * from "./plotId.ts";
export * from "./rules.ts";
export * from "./relaxations.ts";
export { cySiteContext, cySiteContextWithElevation, cyPlotElevation } from "./site.ts";
export { groundElevation, readPixel, readWindow, terrainGrid, lzwDecode, dtmTilesAt } from "./dls/elevation.ts";
export { cyContours, contourLines, chooseInterval } from "./dls/contours.ts";
export { cyPlotStructures } from "./site.ts";
export * from "./restrictions.ts";
export { cyFinanceDefaults, officialLandValue } from "./finance.ts";
export { parseCadastralParcels, parseFeatureInfo } from "./dls/gml.ts";
export { mapZoneAttributes, samplePoints, toZoneHit } from "./dls/zones.ts";
