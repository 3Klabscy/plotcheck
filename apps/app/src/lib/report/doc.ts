// A small layout helper over pdf-lib: A4 pages, wrapped text, headings, label/value rows,
// bullets and page footers. Fonts are passed in as bytes (Noto Sans covers Greek).
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const A4 = { w: 595.28, h: 841.89 };
export const C = {
  ink: rgb(0.11, 0.137, 0.129),
  muted: rgb(0.37, 0.42, 0.4),
  line: rgb(0.886, 0.878, 0.847),
  accent: rgb(0.043, 0.431, 0.31),
  plot: rgb(0.91, 0.349, 0.047),
  footprint: rgb(0.184, 0.502, 0.929),
  warn: rgb(0.541, 0.353, 0),
  bad: rgb(0.706, 0.137, 0.094),
  violet: rgb(0.357, 0.247, 0.659),
  panel: rgb(0.965, 0.961, 0.945),
};

// Symbols used on screen that Noto Sans does not have → nearest it does.
const FALLBACK: Record<string, string> = { "✓": "✔", "✔": "+", "✕": "×", "⚠": "!", "⛔": "×", "ℹ": "i", "☐": "□", "□": "–", "▱": "", "📏": "", "🔗": "", "…": "...", " ": " ", " ": " " };

export interface Fonts { regular: Uint8Array; bold: Uint8Array }

export class ReportDoc {
  readonly margin = 42;
  readonly contentW = A4.w - 2 * 42;
  pdf!: PDFDocument;
  page!: PDFPage;
  y = 0;
  regular!: PDFFont;
  bold!: PDFFont;
  private chars = new Set<number>();
  private footerText = "";

  static async create(fonts: Fonts, meta: { title: string; subject: string; footer: string; lang: string }): Promise<ReportDoc> {
    const d = new ReportDoc();
    d.pdf = await PDFDocument.create();
    d.pdf.registerFontkit(fontkit);
    d.regular = await d.pdf.embedFont(fonts.regular, { subset: true });
    d.bold = await d.pdf.embedFont(fonts.bold, { subset: true });
    for (const c of d.regular.getCharacterSet()) d.chars.add(c);
    d.pdf.setTitle(meta.title);
    d.pdf.setSubject(meta.subject);
    d.pdf.setLanguage(meta.lang);
    d.pdf.setProducer("PlotCheck");
    d.pdf.setCreator("PlotCheck");
    d.footerText = meta.footer;
    d.newPage();
    return d;
  }

  /** Replace characters the font cannot draw. */
  clean(s: string): string {
    let out = "";
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp === 10 || this.chars.has(cp)) { out += ch; continue; }
      let alt = FALLBACK[ch];
      while (alt !== undefined && alt.length === 1 && !this.chars.has(alt.codePointAt(0)!) && FALLBACK[alt] !== undefined) alt = FALLBACK[alt];
      out += alt ?? "";
    }
    return out;
  }

  newPage() {
    this.page = this.pdf.addPage([A4.w, A4.h]);
    this.y = A4.h - this.margin;
  }

  ensure(h: number) {
    if (this.y - h < this.margin + 26) this.newPage();
  }

  /** Split text into lines that fit `width` (keeps explicit newlines; breaks words longer than a line). */
  wrap(text: string, size: number, width: number, font = this.regular): string[] {
    const fits = (x: string) => font.widthOfTextAtSize(x.trimEnd(), size) <= width;
    const lines: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      const words: string[] = [];
      for (const w of para.split(/(?<=\s)/)) {
        if (fits(w)) { words.push(w); continue; }
        let part = "";
        for (const ch of w) {
          if (!fits(part + ch)) { words.push(part); part = ""; }
          part += ch;
        }
        if (part) words.push(part);
      }
      let line = "";
      for (const w of words) {
        if (line === "" || fits(line + w)) line += w;
        else { lines.push(line.trimEnd()); line = w.trimStart(); }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  text(s: string, o: { size?: number; bold?: boolean; color?: RGB; indent?: number; gapAfter?: number; width?: number; lineGap?: number } = {}) {
    const size = o.size ?? 9.5, font = o.bold ? this.bold : this.regular, x = this.margin + (o.indent ?? 0);
    const width = o.width ?? this.contentW - (o.indent ?? 0);
    const lh = size * (o.lineGap ?? 1.35);
    for (const line of this.wrap(s, size, width, font)) {
      this.ensure(lh);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? C.ink });
      this.y -= lh;
    }
    this.y -= o.gapAfter ?? 2;
  }

  heading(s: string) {
    this.ensure(40);
    this.y -= 8;
    this.page.drawText(this.clean(s.toLocaleUpperCase()).normalize("NFD").replace(/[́̈]/g, "").normalize("NFC"), { x: this.margin, y: this.y - 10, size: 10, font: this.bold, color: C.accent });
    this.y -= 15;
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: A4.w - this.margin, y: this.y }, thickness: 0.6, color: C.line });
    this.y -= 7;
  }

  /** Label on the left, value on the right (both wrap). */
  row(label: string, value: string, o: { strong?: boolean; color?: RGB } = {}) {
    const size = 9.5, lw = this.contentW * 0.48, vw = this.contentW * 0.5;
    const ll = this.wrap(label, size, lw), vl = this.wrap(value, size, vw, o.strong ? this.bold : this.regular);
    const h = Math.max(ll.length, vl.length) * size * 1.3 + 4;
    this.ensure(h);
    ll.forEach((l, i) => this.page.drawText(l, { x: this.margin, y: this.y - size - i * size * 1.3, size, font: this.regular, color: C.muted }));
    vl.forEach((l, i) => {
      const font = o.strong ? this.bold : this.regular;
      this.page.drawText(l, { x: A4.w - this.margin - font.widthOfTextAtSize(l, size), y: this.y - size - i * size * 1.3, size, font, color: o.color ?? C.ink });
    });
    this.y -= h;
    this.page.drawLine({ start: { x: this.margin, y: this.y + 1.5 }, end: { x: A4.w - this.margin, y: this.y + 1.5 }, thickness: 0.3, color: C.line });
  }

  bullet(s: string, o: { mark?: string; color?: RGB; markColor?: RGB; size?: number; bold?: boolean } = {}) {
    const size = o.size ?? 9.5, indent = 13;
    const lines = this.wrap(s, size, this.contentW - indent, o.bold ? this.bold : this.regular);
    this.ensure(size * 1.35 * Math.min(lines.length, 3));
    this.page.drawText(this.clean(o.mark ?? "•"), { x: this.margin, y: this.y - size, size, font: this.bold, color: o.markColor ?? C.muted });
    for (const line of lines) {
      this.ensure(size * 1.35);
      this.page.drawText(line, { x: this.margin + indent, y: this.y - size, size, font: o.bold ? this.bold : this.regular, color: o.color ?? C.ink });
      this.y -= size * 1.35;
    }
    this.y -= 2;
  }

  /** Coloured box with text (headline, warnings). */
  box(s: string, o: { color: RGB; fill: RGB; size?: number; bold?: boolean }) {
    const size = o.size ?? 10.5, pad = 8;
    const lines = this.wrap(s, size, this.contentW - 2 * pad - 4, o.bold ? this.bold : this.regular);
    const h = lines.length * size * 1.38 + 2 * pad;
    this.ensure(h + 6);
    this.page.drawRectangle({ x: this.margin, y: this.y - h, width: this.contentW, height: h, color: o.fill });
    this.page.drawRectangle({ x: this.margin, y: this.y - h, width: 3, height: h, color: o.color });
    lines.forEach((l, i) => this.page.drawText(l, { x: this.margin + pad + 4, y: this.y - pad - size - i * size * 1.38 + 2, size, font: o.bold ? this.bold : this.regular, color: C.ink }));
    this.y -= h + 8;
  }

  space(h: number) {
    this.y -= h;
  }

  /** Footer on every page: short notice + page n / N. */
  finish(pageLabel: (n: number, of: number) => string) {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const size = 7;
      p.drawLine({ start: { x: this.margin, y: 34 }, end: { x: A4.w - this.margin, y: 34 }, thickness: 0.4, color: C.line });
      const label = this.clean(pageLabel(i + 1, pages.length));
      const foot = this.wrap(this.footerText, size, this.contentW - this.regular.widthOfTextAtSize(label, size) - 20).slice(0, 2);
      foot.forEach((line, k) => p.drawText(line, { x: this.margin, y: 24 - k * 9, size, font: this.regular, color: C.muted }));
      p.drawText(label, { x: A4.w - this.margin - this.regular.widthOfTextAtSize(label, size), y: 24, size, font: this.regular, color: C.muted });
    });
  }
}
