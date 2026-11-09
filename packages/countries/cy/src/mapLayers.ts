import type { MapLayerDef } from "@plotcheck/country-sdk";
import { DLS_BASE, DLS_INSPIRE } from "./dls/http.ts";
import { PLANNING_ZONE_LAYER } from "./dls/zones.ts";

const BASEMAPS = `${DLS_BASE}/arcgis/rest/services/BASEMAPS`;
const svc = (name: string) => `${DLS_INSPIRE}/${name}/MapServer`;

/**
 * Map layers offered in the layer panel: all public DLS (INSPIRE) services, drawn as images.
 * Checked 2026-11-09: every service answers /export in Web Mercator (historical orthophotos are
 * stored in the Cyprus grid and are reprojected by the server; ~2–4 s per image).
 */
export const cyMapLayers: MapLayerDef[] = [
  // ---- basemaps (one at a time) ----
  { id: "cy-ortho-2019", kind: "xyz", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "2019", defaultOn: true,
    url: `${BASEMAPS}/Orthoimagery_2019_WebMercator/MapServer/tile/{z}/{y}/{x}`, attributionKey: "cy.attribution.ortho", maxzoom: 20 },
  { id: "cy-ortho-2014", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "2014",
    url: `${BASEMAPS}/Imagery_Orthophoto_2014_10cm/MapServer`, attributionKey: "cy.attribution.dls" },
  { id: "cy-ortho-1993", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "1993",
    url: `${BASEMAPS}/Imagery_Orthophoto_1993/MapServer`, attributionKey: "cy.attribution.dls" },
  { id: "cy-ortho-1963", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "1963",
    url: `${BASEMAPS}/Imagery_Orthophoto_1963/MapServer`, attributionKey: "cy.attribution.dls" },

  // ---- cadastre ----
  { id: "cy-parcels", kind: "wms", role: "overlay", group: "cadastre", titleKey: "cy.layer.parcels", defaultOn: true,
    url: `${svc("CP_CadastralParcels")}/exts/InspireView/service`, layers: "CP.CadastralParcel", attributionKey: "cy.attribution.dls", minzoom: 16, opacity: 0.9 },
  { id: "cy-buildings", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.buildings",
    url: svc("BU_Buildings"), layers: "show:6", attributionKey: "cy.attribution.dls", minzoom: 16, opacity: 0.8 },
  { id: "cy-quarters", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.quarters",
    url: svc("CP_CadastralParcels"), layers: "show:2", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.9 },

  // ---- planning ----
  { id: "cy-planning-zones", kind: "wms", role: "overlay", group: "planning", titleKey: "cy.layer.zones",
    url: `${svc("LU_LandUse")}/exts/InspireView/service`, layers: PLANNING_ZONE_LAYER, attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.35 },

  // ---- natural risk ----
  { id: "cy-flood", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.flood",
    url: svc("NZ_NaturalRiskZones"), layers: "show:1,2,3", attributionKey: "cy.attribution.dls", opacity: 0.55 },
  { id: "cy-seismic", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.seismic",
    url: svc("NZ_NaturalRiskZones"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.45 },
  { id: "cy-geohazards", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.geohazards",
    url: svc("NZ_NaturalRiskZones"), layers: "show:4", attributionKey: "cy.attribution.dls", opacity: 0.55 },
  { id: "cy-shoreline", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.shoreline",
    url: svc("SR_SeaRegions"), attributionKey: "cy.attribution.dls", opacity: 0.6 },

  // ---- environment ----
  { id: "cy-protected", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.protected",
    url: svc("PS_ProtectedSites"), layers: "show:1,3,5,7", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-geology", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.geology",
    url: svc("GE_Geology"), layers: "show:3", attributionKey: "cy.attribution.dls", opacity: 0.5 },

  // ---- infrastructure ----
  { id: "cy-roads", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.roads",
    url: svc("TN_TransportNetwork"), layers: "show:1", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.9 },
  { id: "cy-water", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.water",
    url: svc("US_UtilityAndGovernmentalServices"), layers: "show:27,28", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-sewer", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.sewer",
    url: svc("US_UtilityAndGovernmentalServices"), layers: "show:16,17", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-public", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.public",
    url: svc("US_UtilityAndGovernmentalServices"), layers: "show:1,2,3,4,5,6,7,8", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.7 },

  // ---- administrative ----
  { id: "cy-admin", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.admin",
    url: svc("AU_AdmUnits"), layers: "show:2,3", attributionKey: "cy.attribution.dls", opacity: 0.9 },
];
