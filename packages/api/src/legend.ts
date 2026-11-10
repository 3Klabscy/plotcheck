import { cached, type Cache } from "./cache.ts";

export interface LegendItem {
  label: string;
  /** data: URL of the swatch */
  image: string;
}

interface ArcgisLegend {
  layers?: { layerId: number; legend: { label: string; imageData: string; contentType: string }[] }[];
}

/** "0,000000 - 66,000000" → "0 – 66"; "66,000001 - 220,000000" → "67 – 220" (counts are whole numbers). */
export function tidyLabel(label: string): string {
  const m = /^\s*([\d.,]+)\s*-\s*([\d.,]+)\s*$/.exec(label);
  if (!m) return label.trim();
  const num = (s: string) => Number(s.replace(",", "."));
  const lo = num(m[1]!), hi = num(m[2]!);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return label.trim();
  return `${Math.ceil(lo)} – ${Math.round(hi)}`;
}

/** Legend swatches of the given sublayers of an ArcGIS MapServer (only catalogue URLs reach here). */
export async function arcgisLegend(deps: { fetch: typeof fetch; cache: Cache }, url: string, ids: number[]): Promise<LegendItem[]> {
  const { value } = await cached(deps.cache, `legend:${url}`, 7 * 24 * 3600, async () => {
    const r = await deps.fetch(`${url}/legend?f=json`);
    if (!r.ok) throw new Error(`legend ${r.status}`);
    return (await r.json()) as ArcgisLegend;
  });
  return (value.layers ?? [])
    .filter((l) => ids.includes(l.layerId))
    .flatMap((l) => l.legend.map((x) => ({ label: tidyLabel(x.label), image: `data:${x.contentType};base64,${x.imageData}` })));
}
