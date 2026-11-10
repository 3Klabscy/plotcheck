import { cached, type Cache } from "./cache.ts";

/**
 * Google basemaps through the official Map Tiles API (2D tiles), only when GOOGLE_MAPS_API_KEY is set.
 * The key is sent to the browser inside the tile URLs, so it must be restricted in Google Cloud to
 * the Map Tiles API and to the app's web addresses (HTTP referrers). Sessions last ~2 weeks; we renew daily.
 */
export type GoogleMapType = "roadmap" | "satellite" | "hybrid";
export const GOOGLE_TYPES: GoogleMapType[] = ["roadmap", "satellite", "hybrid"];

export interface GoogleTiles {
  available: boolean;
  /** Tile URL templates ({z}/{x}/{y}) per map type. */
  tiles?: Partial<Record<GoogleMapType, string>>;
  /** Browser key (restricted to the app's addresses) for Photorealistic 3D Tiles. */
  key?: string;
}

const CREATE = "https://tile.googleapis.com/v1/createSession";

export async function googleTiles(deps: { fetch: typeof fetch; env(k: string): string | undefined; cache: Cache }, lang: "el" | "en"): Promise<GoogleTiles> {
  const key = deps.env("GOOGLE_MAPS_API_KEY");
  if (!key) return { available: false };
  const { value } = await cached(deps.cache, `google-tiles:${lang}`, 24 * 3600, async () => {
    const tiles: Partial<Record<GoogleMapType, string>> = {};
    for (const type of GOOGLE_TYPES) {
      const body = {
        mapType: type === "roadmap" ? "roadmap" : "satellite",
        language: lang === "el" ? "el-GR" : "en-GB",
        region: "CY",
        ...(type === "hybrid" ? { layerTypes: ["layerRoadmap"] } : {}),
      };
      const r = await deps.fetch(`${CREATE}?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) continue;
      const j = (await r.json()) as { session?: string };
      if (j.session) tiles[type] = `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(j.session)}&key=${encodeURIComponent(key)}`;
    }
    if (Object.keys(tiles).length === 0) throw new Error("google_tiles_unavailable");
    return tiles;
  });
  return { available: true, tiles: value, key };
}
