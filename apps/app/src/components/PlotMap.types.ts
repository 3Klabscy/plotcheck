import type { PolygonGeometry } from "@plotcheck/core";
import type { MapLayerDef } from "../lib/api";

export type MeasureTool = "none" | "distance" | "area";
export interface MeasureResult { tool: Exclude<MeasureTool, "none">; points: number; lengthM: number; areaM2: number }

export interface PlotMapProps {
  layers: MapLayerDef[];
  initialView: { center: { lng: number; lat: number }; zoom: number };
  selected?: PolygonGeometry;
  neighbours?: { id: string; geometry: PolygonGeometry }[];
  footprint?: PolygonGeometry;
  tapped?: { lng: number; lat: number };
  /** "streets", "blank" or the id of a basemap layer. */
  basemap: string;
  /** Ids of the overlays to show. */
  overlays: string[];
  measure: MeasureTool;
  /** Bumped by the parent to clear the measurement. */
  measureReset: number;
  onMeasure?(r: MeasureResult | null): void;
  onTap(p: { lng: number; lat: number }): void;
  onSelectNeighbour?(id: string): void;
  onMove?(v: { lng: number; lat: number; zoom: number }): void;
  /** Credit line for a layer's attribution key (already translated). */
  attribution(key: string, date?: string): string;
}

export interface PlotMapHandle {
  flyTo(p: { lng: number; lat: number }, zoom?: number): void;
  fitBounds(b: [number, number, number, number]): void;
}
