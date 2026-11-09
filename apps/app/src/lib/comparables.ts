// Read comparable sales from a table (CSV, or an Excel sheet read into rows): a land-registry
// comparable-sales export, a valuer's list, or the user's own. Columns are found by their names
// (Greek or English); numbers in Greek (250.000,50) or English (250,000.50) format; dates as
// dd/mm/yyyy, yyyy-mm-dd or Excel serial numbers.
import type { ComparableKind, ComparableSale } from "@plotcheck/engine";

export type Cell = string | number | Date | boolean | null | undefined;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-zα-ω0-9²]+/g, " ").trim();

const COLUMNS: Record<"date" | "price" | "area" | "kind" | "label", RegExp> = {
  date: /^(ημερομηνια|ημ νια|ημ|date|sale date|contract date)(\s|$)/,
  price: /(τιμη|τιμημα|ποσο|αξια|ανταλλαγμα|price|amount|consideration|value)(?!.*(m2|m²|τ μ|ανα))/,
  area: /(εμβαδ|εκτασ|area|size|m2|m²|τ μ|sq)/,
  kind: /^(τυπος|ειδος|κατηγορια|type|kind|category|property type)(\s|$)/,
  label: /(διευθυνσ|address|τεμαχ|plot|ref|αναφορα|περιγραφ|description|τοποθεσ|location|δημος|ενορια)/,
};

export function parseNumber(v: Cell): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[€\s\u00a0]|eur|m2|m²|τ\.?μ\.?/gi, "");
  if (!s) return undefined;
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma > -1 && dot > -1) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma > -1) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (dot > -1 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 250.000 (Greek thousands)
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function parseDate(v: Cell): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10); // Excel serial
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s); // month/year only
  if (m) return `${m[2]}-${m[1]!.padStart(2, "0")}-15`;
  return undefined;
}

export function parseKind(v: Cell, fallback: ComparableKind): ComparableKind {
  const s = typeof v === "string" ? fold(v) : "";
  if (!s) return fallback;
  if (/διαμερ|apartment|flat|penthouse|ρετιρε|studio|στουντιο/.test(s)) return "apartment";
  if (/κατοικ|οικια|σπιτι|μονοκατοικ|βιλα|house|villa|maisonette|μεζονετ|townhouse/.test(s)) return "house";
  if (/καταστημ|γραφει|εμπορ|shop|office|retail|commercial|αποθηκ|warehouse/.test(s)) return "commercial";
  if (/χωραφ|οικοπεδ|τεμαχ|(^|\s)γη(\s|$)|land|plot|field|site/.test(s)) return "land";
  return "other";
}

/** Split CSV text into rows (comma, semicolon or tab; quoted fields). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export interface ParsedComparables {
  sales: ComparableSale[];
  skipped: number;
  /** Which column each field came from (header text). */
  columns: Partial<Record<keyof typeof COLUMNS, string>>;
}

export class ComparablesError extends Error {}

/** Rows (first row with recognisable headers is the header) → comparable sales. */
export function rowsToComparables(rows: Cell[][], fallbackKind: ComparableKind): ParsedComparables {
  const headerAt = rows.slice(0, 15).findIndex((r) => {
    const h = r.map((c) => fold(String(c ?? "")));
    return h.some((x) => COLUMNS.price.test(x)) && h.some((x) => COLUMNS.area.test(x));
  });
  if (headerAt < 0) throw new ComparablesError("no_columns");
  const header = rows[headerAt]!.map((c) => fold(String(c ?? "")));
  const col: Partial<Record<keyof typeof COLUMNS, number>> = {};
  for (const key of ["date", "kind", "area", "price", "label"] as const) {
    const i = header.findIndex((h, k) => COLUMNS[key].test(h) && !Object.values(col).includes(k));
    if (i >= 0) col[key] = i;
  }
  if (col.price === undefined || col.area === undefined) throw new ComparablesError("no_columns");
  const sales: ComparableSale[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const price = parseNumber(r[col.price]), area = parseNumber(r[col.area]);
    const date = col.date !== undefined ? parseDate(r[col.date]) : undefined;
    if (!price || !area || price <= 0 || area <= 0 || !date) { skipped++; continue; }
    const label = col.label !== undefined ? String(r[col.label] ?? "").trim() : "";
    sales.push({ date, price, areaM2: area, kind: col.kind !== undefined ? parseKind(r[col.kind], fallbackKind) : fallbackKind, ...(label ? { label } : {}) });
  }
  if (sales.length === 0) throw new ComparablesError("no_rows");
  const columns = Object.fromEntries(Object.entries(col).map(([k, i]) => [k, String(rows[headerAt]![i!] ?? "")])) as ParsedComparables["columns"];
  return { sales, skipped, columns };
}

/** The kind of comparable that matches a building use. */
export const kindForUse = (use: string): ComparableKind =>
  use === "house" || use === "row_houses" ? "house" : use === "commercial" ? "commercial" : "apartment";
