import type { MapLayerDef } from "@plotcheck/country-sdk";
import { DLS_BASE, DLS_INSPIRE } from "./dls/http.ts";
import { PLANNING_ZONE_LAYER } from "./dls/zones.ts";

const BASEMAPS = `${DLS_BASE}/arcgis/rest/services/BASEMAPS`;
const svc = (name: string) => `${DLS_INSPIRE}/${name}/MapServer`;

/**
 * Map layers offered in the layer panel: every public DLS service (INSPIRE + BASEMAPS), drawn as images.
 * Inventory checked 2026-11-10; the "National" and "DTPH" folders are not public (HTTP 403).
 * minzoom follows each DLS layer's minScale (the server draws nothing when zoomed further out).
 * Checked 2026-11-09: every service answers /export in Web Mercator (historical orthophotos are
 * stored in the Cyprus grid and are reprojected by the server; ~2–4 s per image).
 */
export const cyMapLayers: MapLayerDef[] = [
  // ---- basemaps (one at a time) ----
  { id: "cy-ortho-2019", kind: "xyz", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "2019", defaultOn: true,
    url: `${BASEMAPS}/Orthoimagery_2019_WebMercator/MapServer/tile/{z}/{y}/{x}`, attributionKey: "cy.attribution.ortho", maxzoom: 20 },
  { id: "cy-ortho-2014", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "2014",
    url: `${BASEMAPS}/Imagery_Orthophoto_2014_10cm/MapServer`, attributionKey: "cy.attribution.dls" },
  { id: "cy-satellite", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.satellite", date: "2009–2013",
    url: `${BASEMAPS}/Imagery_Satellite_2009_2013/MapServer`, attributionKey: "cy.attribution.dls" },
  { id: "cy-ortho-1993", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "1993",
    url: `${BASEMAPS}/Imagery_Orthophoto_1993/MapServer`, attributionKey: "cy.attribution.dls" },
  { id: "cy-ortho-1963", kind: "arcgis", role: "basemap", group: "basemap", titleKey: "cy.layer.ortho", date: "1963",
    url: `${BASEMAPS}/Imagery_Orthophoto_1963/MapServer`, attributionKey: "cy.attribution.dls" },

  // ---- cadastre ----
  { id: "cy-parcels", kind: "wms", role: "overlay", group: "cadastre", titleKey: "cy.layer.parcels", defaultOn: true,
    url: `${svc("CP_CadastralParcels")}/exts/InspireView/service`, layers: "CP.CadastralParcel", attributionKey: "cy.attribution.dls", minzoom: 16, opacity: 0.9 },
  { id: "cy-cad-boundaries", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.cadBoundaries", url: svc("CP_CadastralParcels"), layers: "show:0", attributionKey: "cy.attribution.dls", minzoom: 17, opacity: 0.9 },
  { id: "cy-quarters", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.quarters", url: svc("CP_CadastralParcels"), layers: "show:2", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.9 },
  { id: "cy-buildings", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.buildings", url: svc("BU_Buildings"), layers: "show:6", attributionKey: "cy.attribution.dls", minzoom: 16, opacity: 0.8 },
  { id: "cy-buildings-reg", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.buildingsRegistered", url: svc("BU_Buildings"), layers: "show:1,2", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.8 },
  { id: "cy-landmarks", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.landmarks", url: svc("BU_Buildings"), layers: "show:4", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.8 },
  { id: "cy-addresses", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.addresses", url: svc("AD_Addresses"), layers: "show:0", attributionKey: "cy.attribution.dls", minzoom: 14, opacity: 0.9 },
  { id: "cy-placenames", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.placeNames", url: svc("GN_GeoNames"), layers: "show:1", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.9 },
  { id: "cy-ortho-coverage", kind: "arcgis", role: "overlay", group: "cadastre", titleKey: "cy.layer.orthoCoverage", url: svc("OI_Orthoimagery"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.4 },

  // ---- terrain ----
  { id: "cy-contours", kind: "contours", role: "overlay", group: "terrain", titleKey: "cy.layer.contours", date: "2019",
    attributionKey: "cy.attribution.dtm", minzoom: 16 },
  { id: "cy-hillshade", kind: "arcgis", role: "overlay", group: "terrain", titleKey: "cy.layer.hillshade", date: "1993",
    url: `${BASEMAPS}/Imagery_HillShade_1993/MapServer`, attributionKey: "cy.attribution.dls", opacity: 0.45 },
  { id: "cy-geomorphology", kind: "arcgis", role: "overlay", group: "terrain", titleKey: "cy.layer.geomorphology", url: svc("GE_Geology"), layers: "show:1", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.5 },
  { id: "cy-dtm-index", kind: "arcgis", role: "overlay", group: "terrain", titleKey: "cy.layer.dtmIndex", url: svc("EL1"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.7 },

  // ---- planning & land ----
  { id: "cy-planning-zones", kind: "wms", role: "overlay", group: "planning", titleKey: "cy.layer.zones",
    url: `${svc("LU_LandUse")}/exts/InspireView/service`, layers: PLANNING_ZONE_LAYER, attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.35 },
  { id: "cy-landcover", kind: "arcgis", role: "overlay", group: "planning", titleKey: "cy.layer.landCover", url: svc("LC_LandCover"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.45 },
  { id: "cy-agglomerations", kind: "arcgis", role: "overlay", group: "planning", titleKey: "cy.layer.agglomerations", url: svc("AM_AreaManagement"), layers: "show:0", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.45 },
  { id: "cy-nitrate", kind: "arcgis", role: "overlay", group: "planning", titleKey: "cy.layer.nitrateZones", url: svc("AM_AreaManagement"), layers: "show:3", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.45 },
  { id: "cy-bathing", kind: "arcgis", role: "overlay", group: "planning", titleKey: "cy.layer.bathingWaters", url: svc("AM_AreaManagement"), layers: "show:2", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.6 },
  { id: "cy-dumping", kind: "arcgis", role: "overlay", group: "planning", titleKey: "cy.layer.dumpingSites", url: svc("AM_AreaManagement"), layers: "show:1", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.6 },
  { id: "cy-minerals", kind: "arcgis", role: "overlay", group: "planning", titleKey: "cy.layer.minerals", url: svc("MR_MineralResources"), layers: "show:0,1,2,3,4", attributionKey: "cy.attribution.dls", opacity: 0.8 },

  // ---- natural risk ----
  { id: "cy-flood", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.flood", url: svc("NZ_NaturalRiskZones"), layers: "show:1,2,3", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.55 },
  { id: "cy-seismic", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.seismic", url: svc("NZ_NaturalRiskZones"), layers: "show:0", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.45 },
  { id: "cy-geohazards", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.geohazards", url: svc("NZ_NaturalRiskZones"), layers: "show:4", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.55 },
  { id: "cy-shoreline", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.shoreline", url: svc("SR_SeaRegions"), layers: "show:0,1", attributionKey: "cy.attribution.dls", opacity: 0.8 },
  { id: "cy-intertidal", kind: "arcgis", role: "overlay", group: "risk", titleKey: "cy.layer.intertidal", url: svc("SR_SeaRegions"), layers: "show:2", attributionKey: "cy.attribution.dls", opacity: 0.6 },

  // ---- water ----
  { id: "cy-rivers", kind: "arcgis", role: "overlay", group: "water", titleKey: "cy.layer.rivers", url: svc("HY_Hydrography"), layers: "show:1,2", attributionKey: "cy.attribution.dls", opacity: 0.8 },
  { id: "cy-watercourses", kind: "arcgis", role: "overlay", group: "water", titleKey: "cy.layer.watercourses", url: svc("HY_Hydrography"), layers: "show:10", attributionKey: "cy.attribution.dls", opacity: 0.8 },
  { id: "cy-lakes", kind: "arcgis", role: "overlay", group: "water", titleKey: "cy.layer.lakes", url: svc("HY_Hydrography"), layers: "show:4,5", attributionKey: "cy.attribution.dls", opacity: 0.8 },
  { id: "cy-drainage", kind: "arcgis", role: "overlay", group: "water", titleKey: "cy.layer.drainageBasins", url: svc("HY_Hydrography"), layers: "show:7", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-riverbasins", kind: "arcgis", role: "overlay", group: "water", titleKey: "cy.layer.riverBasins", url: svc("HY_Hydrography"), layers: "show:8", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-rbd", kind: "arcgis", role: "overlay", group: "water", titleKey: "cy.layer.riverBasinDistrict", url: svc("AM_AreaManagement"), layers: "show:4", attributionKey: "cy.attribution.dls", opacity: 0.4 },

  // ---- environment ----
  { id: "cy-protected", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.protected", url: svc("PS_ProtectedSites"), layers: "show:1,3,5,7", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-habitats", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.habitats", url: svc("HB_HabitatBiotop"), layers: "show:1", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-mpa", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.marineProtected", url: svc("HB_HabitatBiotop"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-species", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.species", url: svc("SD_SpeciesDistribution"), layers: "show:0,1,2", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.6 },
  { id: "cy-biogeo", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.biogeographic", url: svc("BR_BioGeographicalRegions"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.35 },
  { id: "cy-geology", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.geology", url: svc("GE_Geology"), layers: "show:3", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-monitoring", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.monitoring", url: svc("EF_EnvironmentalFacilities"), layers: "show:0,1,2,3,4,5", attributionKey: "cy.attribution.dls", opacity: 0.9 },
  { id: "cy-monitoring-prog", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.monitoringProgrammes", url: svc("EF_EnvironmentalFacilities"), layers: "show:6", attributionKey: "cy.attribution.dls", opacity: 0.4 },
  { id: "cy-production", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.production", url: svc("PF_ProductionFacility"), layers: "show:0,1", attributionKey: "cy.attribution.dls", opacity: 0.9 },
  { id: "cy-temperature", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.temperature", url: svc("ACMF_AtmConditions_MeteoGeoFeatures"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-rainfall", kind: "arcgis", role: "overlay", group: "environment", titleKey: "cy.layer.rainfall", url: svc("ACMF_AtmConditions_MeteoGeoFeatures"), layers: "show:1", attributionKey: "cy.attribution.dls", opacity: 0.5 },

  // ---- networks & public buildings ----
  { id: "cy-roads", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.roads", url: svc("TN_TransportNetwork"), layers: "show:1", attributionKey: "cy.attribution.dls", minzoom: 14, opacity: 0.9 },
  { id: "cy-transport-other", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.transportOther", url: svc("TN_TransportNetwork"), layers: "show:0,2", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.9 },
  { id: "cy-water", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.water", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:27,28", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-water-fittings", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.waterFittings", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:19,20,21,23,25", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-water-meters", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.waterMeters", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:24,26", attributionKey: "cy.attribution.dls", minzoom: 16, opacity: 0.9 },
  { id: "cy-hydrants", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.hydrants", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:9,22", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-sewer", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.sewer", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:16,17", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-sewer-nodes", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.sewerNodes", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:14,15", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.9 },
  { id: "cy-treatment", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.treatment", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:11,12", attributionKey: "cy.attribution.dls", minzoom: 14, opacity: 0.7 },
  { id: "cy-public", kind: "arcgis", role: "overlay", group: "infrastructure", titleKey: "cy.layer.public", url: svc("US_UtilityAndGovernmentalServices"), layers: "show:1,2,3,4,5,6,7,8", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.7 },

  // ---- administrative & statistical units ----
  { id: "cy-admin", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.admin", url: svc("AU_AdmUnits"), layers: "show:2,3,4,5", attributionKey: "cy.attribution.dls", opacity: 0.9 },
  { id: "cy-admin-units", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.adminUnits", url: svc("AU_AdmUnits"), layers: "show:7,8,9,10", attributionKey: "cy.attribution.dls", opacity: 0.35 },
  { id: "cy-eez", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.eez", url: svc("AU_AdmUnits"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.6 },
  { id: "cy-su-district", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.suDistrict", url: svc("SU_StatisticalUnits"), layers: "show:0", attributionKey: "cy.attribution.dls", opacity: 0.5 },
  { id: "cy-su-community", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.suCommunity", url: svc("SU_StatisticalUnits"), layers: "show:1", attributionKey: "cy.attribution.dls", minzoom: 12, opacity: 0.5 },
  { id: "cy-su-quarter", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.suQuarter", url: svc("SU_StatisticalUnits"), layers: "show:2", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.5 },
  { id: "cy-postcodes", kind: "arcgis", role: "overlay", group: "admin", titleKey: "cy.layer.postcodes", url: svc("SU_StatisticalUnits"), layers: "show:3", attributionKey: "cy.attribution.dls", minzoom: 14, opacity: 0.5 },

  // ---- population statistics (census choropleths by sex and age, drawn together) ----
  { id: "cy-pd-district", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popDistrict", url: svc("PD_PopulationDistribution"), layers: "show:2,3,4,5,6,7,8,9", attributionKey: "cy.attribution.dls", opacity: 0.35 },
  { id: "cy-pd-community", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popCommunity", url: svc("PD_PopulationDistribution"), layers: "show:11,12,13,14,15,16,17,18", attributionKey: "cy.attribution.dls", minzoom: 14, opacity: 0.35 },
  { id: "cy-pd-quarter", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popQuarter", url: svc("PD_PopulationDistribution"), layers: "show:20,21,22,23,24,25,26,27", attributionKey: "cy.attribution.dls", minzoom: 15, opacity: 0.35 },
  { id: "cy-pd-postcode", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popPostcode", url: svc("PD_PopulationDistribution"), layers: "show:29,30,31,32,33,34,35,36", attributionKey: "cy.attribution.dls", minzoom: 16, opacity: 0.35 },
  { id: "cy-pd-employed", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popEmployed", url: svc("PD_PopulationDistribution"), layers: "show:39,40,42,43", attributionKey: "cy.attribution.dls", opacity: 0.35 },
  { id: "cy-pd-unemployed", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popUnemployed", url: svc("PD_PopulationDistribution"), layers: "show:46,47,49,50", attributionKey: "cy.attribution.dls", opacity: 0.35 },
  { id: "cy-pd-workplace", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.popWorkplace", url: svc("PD_PopulationDistribution"), layers: "show:53,54,55,56,57,58,60,61,62,63,64,65", attributionKey: "cy.attribution.dls", opacity: 0.35 },
  { id: "cy-crime", kind: "arcgis", role: "overlay", group: "statistics", titleKey: "cy.layer.crime", url: svc("SU_StatisticalUnits"), layers: "show:4", attributionKey: "cy.attribution.dls", minzoom: 13, opacity: 0.4 },
];
