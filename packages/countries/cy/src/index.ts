import type { CountryModule } from "@plotcheck/country-sdk";
import { dlsInspireParcels, dlsRestParcels, palSurveyParcels } from "./dls/parcels.ts";
import { dlsPlanningZones, PLANNING_ZONE_LAYER } from "./dls/zones.ts";
import { DLS_BASE, DLS_INSPIRE } from "./dls/http.ts";
import { cyPlotIdSchema } from "./plotId.ts";
import { cyRuleLayers, cySourceLayer, cyUsesForZone } from "./rules.ts";
import { cyRelaxationsFor } from "./relaxations.ts";
import { cySiteContext } from "./site.ts";
import { cyFinanceDefaults } from "./finance.ts";
import { cyRestrictionLayers, larnacaNoiseFor } from "./restrictions.ts";
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
  siteContext: async (_ctx, parcel) => cySiteContext(parcel),
  financeDefaults: cyFinanceDefaults,
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
  mapLayers: [
    {
      id: "cy-ortho-2019",
      kind: "xyz",
      role: "basemap",
      url: `${DLS_BASE}/arcgis/rest/services/BASEMAPS/Orthoimagery_2019_WebMercator/MapServer/tile/{z}/{y}/{x}`,
      attributionKey: "cy.attribution.ortho",
      maxzoom: 20,
    },
    {
      id: "cy-planning-zones",
      kind: "wms",
      role: "overlay",
      url: `${DLS_INSPIRE}/LU_LandUse/MapServer/exts/InspireView/service`,
      layers: PLANNING_ZONE_LAYER,
      attributionKey: "cy.attribution.dls",
      minzoom: 13,
      opacity: 0.35,
    },
    {
      id: "cy-parcels",
      kind: "wms",
      role: "overlay",
      url: `${DLS_INSPIRE}/CP_CadastralParcels/MapServer/exts/InspireView/service`,
      layers: "CP.CadastralParcel",
      attributionKey: "cy.attribution.dls",
      minzoom: 16,
      opacity: 0.9,
    },
  ],
  messages: { el, en },
};

export { dlsInspireParcels, dlsRestParcels, palSurveyParcels, dlsPlanningZones };
export { parseRestParcels } from "./dls/parcels.ts";
export * from "./plotId.ts";
export * from "./rules.ts";
export * from "./relaxations.ts";
export { cySiteContext } from "./site.ts";
export * from "./restrictions.ts";
export { cyFinanceDefaults, officialLandValue } from "./finance.ts";
export { parseCadastralParcels, parseFeatureInfo } from "./dls/gml.ts";
export { mapZoneAttributes, samplePoints, toZoneHit } from "./dls/zones.ts";
