import type { PolygonGeometry } from "@plotcheck/core";
import type { MapLayerDef } from "../lib/api";
import type { UserCollection } from "../lib/userLayer";

export type MeasureTool = "none" | "distance" | "area" | "point";
export interface MeasureResult {
  tool: Exclude<MeasureTool, "none">;
  points: number;
  coords: [number, number][];
  lengthM: number;
  areaM2: number;
  /** Length of each segment, in order (distance/area). */
  segmentsM: number[];
}

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
  onMove?(v: { lng: number; lat: number; zoom: number; bbox: [number, number, number, number] }): void;
  /** The user's imported files and drawings. */
  drawings?: UserCollection;
  /** Text for the cursor position readout (e.g. national grid + lng/lat); none = hidden. */
  formatCursor?(lng: number, lat: number): string;
  /** Contour lines for a view box (layer kind "contours"). */
  loadContours?(bbox: [number, number, number, number], signal: AbortSignal): Promise<GeoJSON.FeatureCollection>;
  /** Labels drawn on the map while measuring (localised numbers). */
  fmtLength?(m: number): string;
  fmtArea?(m2: number): string;
  /** Credit line for a layer's attribution key (already translated). */
  attribution(key: string, date?: string): string;
}

export interface PlotMapHandle {
  flyTo(p: { lng: number; lat: number }, zoom?: number): void;
  fitBounds(b: [number, number, number, number]): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Remove the last measured point. */
  undoMeasure(): void;
  /** Current centre and zoom (for "open this view in Google Maps"). */
  view(): { lng: number; lat: number; zoom: number } | undefined;
}
