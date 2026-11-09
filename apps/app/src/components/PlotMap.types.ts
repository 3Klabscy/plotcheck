import type { PolygonGeometry } from "@plotcheck/core";
import type { MapLayerDef } from "../lib/api";

export interface PlotMapProps {
  layers: MapLayerDef[];
  initialView: { center: { lng: number; lat: number }; zoom: number };
  selected?: PolygonGeometry;
  neighbours?: { id: string; geometry: PolygonGeometry }[];
  footprint?: PolygonGeometry;
  tapped?: { lng: number; lat: number };
  basemap: "aerial" | "streets";
  showZones: boolean;
  onTap(p: { lng: number; lat: number }): void;
  onSelectNeighbour?(id: string): void;
  attribution: string;
}

export interface PlotMapHandle {
  flyTo(p: { lng: number; lat: number }, zoom?: number): void;
}
