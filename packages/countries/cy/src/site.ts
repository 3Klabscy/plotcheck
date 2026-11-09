import type { Parcel, SiteContext } from "@plotcheck/core";
import { larnacaRoadContext, planGroupsFromRoads } from "./larnaca/roads.ts";
import { larnacaStreetFrontage } from "./larnaca/frontage.ts";

/** Road access, frontage and postcodes. Currently covers the Larnaca road-map area. */
export function cySiteContext(parcel: Parcel): SiteContext | undefined {
  const rc = larnacaRoadContext(parcel);
  if (!rc.covered) return undefined;
  const tags = new Set(planGroupsFromRoads(parcel, rc).map((g) => `cy.lca:${g}`));
  for (const f of larnacaStreetFrontage(parcel)) tags.add(`cy.lca:${f.group}`);
  return {
    roadAccess: rc.roadAccess,
    frontage: rc.frontage,
    postcodes: rc.postcodes,
    tags: [...tags],
    provenance: {
      source: "DLS INSPIRE road network + DLS Larnaca road map (names) + Cyprus Post postcodes",
      sourceRef: "https://portal.dls.moi.gov.cy/xartes_category/odikoi-chartes/",
      status: "needs_review",
    },
  };
}
