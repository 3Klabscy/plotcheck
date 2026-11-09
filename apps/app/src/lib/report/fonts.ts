// Noto Sans (SIL Open Font License, see assets/fonts/OFL.txt): Latin + Greek for the PDF report.
import { Asset } from "expo-asset";
import regular from "../../../assets/fonts/NotoSans-Regular.ttf";
import bold from "../../../assets/fonts/NotoSans-Bold.ttf";
import type { Fonts } from "./doc";

let cache: Promise<Fonts> | undefined;

async function bytes(mod: number): Promise<Uint8Array> {
  const a = Asset.fromModule(mod);
  await a.downloadAsync();
  const res = await fetch(a.localUri ?? a.uri);
  return new Uint8Array(await res.arrayBuffer());
}

export function loadFonts(): Promise<Fonts> {
  cache ??= Promise.all([bytes(regular), bytes(bold)]).then(([r, b]) => ({ regular: r, bold: b }));
  cache.catch(() => (cache = undefined));
  return cache;
}
