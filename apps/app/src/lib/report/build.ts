// The plot report (PDF): everything the result screen shows, in one document the user can keep,
// print or send. Built on the device from the data already loaded, with the user's own finance
// assumptions. Country-agnostic: labels come from i18n, country specifics from the API's data.
import type { TFunction } from "i18next";
import { toGrid } from "@plotcheck/core";
import type { AnalysisResult, ComparableStats } from "@plotcheck/engine";
import type { OptionRow } from "../options";
import type { AnalyseResponse, CountryConfig, ZonesResponse } from "../api";
import type { FinanceSnapshot } from "../../components/Finance";
import { fmtArea, fmtMoney, fmtNumber, fmtPercent } from "../format";
import { contributionText, dedupeReview, headline, reasonText, relaxedHeadline, usedSummary } from "../text";
import { C, ReportDoc, type Fonts } from "./doc";
import { drawMapFigure } from "./map";

export interface ReportInput {
  t: TFunction;
  lng: string;
  config: CountryConfig;
  zones: ZonesResponse;
  data: AnalyseResponse;
  result: AnalysisResult;
  finance?: FinanceSnapshot;
  /** Comparable sales behind the sale price (last N months). */
  comparables?: ComparableStats;
  /** All allowed building types side by side. */
  options?: OptionRow[];
  fonts: Fonts;
  generatedAt: Date;
  /** Injected in tests (offline); defaults to fetch. */
  fetchBytes?(url: string): Promise<Uint8Array | undefined>;
}

export async function buildReport(i: ReportInput): Promise<Uint8Array> {
  const { t, lng, data, zones, result } = i;
  const parcel = data.parcel;
  const zone = data.zone;
  const site = zones.site;
  const f = result.figures;
  const when = new Intl.DateTimeFormat(lng.startsWith("el") ? "el-GR" : "en-GB", { dateStyle: "long", timeStyle: "short" }).format(i.generatedAt);
  const title = t("report.title", { label: parcel.label ?? parcel.nationalRef });

  const doc = await ReportDoc.create(i.fonts, {
    title,
    subject: `${parcel.nationalRef} · ${t(`use.${result.use}`)}`,
    footer: `PlotCheck · ${parcel.nationalRef} · ${when} · ${t("report.footer")}`,
    lang: lng,
  });

  // ---------- title ----------
  doc.text("PlotCheck", { size: 9, bold: true, color: C.accent, gapAfter: 0 });
  doc.text(title, { size: 18, bold: true, gapAfter: 1 });
  doc.text(`${t(`use.${result.use}`)} · ${zone.zoneCode}${zone.planName ? ` · ${zone.planName}` : ""}`, { size: 10.5, color: C.muted, gapAfter: 0 });
  doc.text(t("report.generated", { date: when }), { size: 8.5, color: C.muted, gapAfter: 8 });
  const statusColor = result.status === "allowed" ? C.accent : result.status === "maybe" ? C.warn : C.bad;
  doc.box(`${t(`status.${result.status}`)} — ${headline(t, lng, result)}`, { color: statusColor, fill: C.panel, bold: false, size: 10.5 });

  // ---------- map ----------
  const base = i.config.mapLayers.find((l) => l.role === "basemap" && l.defaultOn && l.kind === "xyz");
  await drawMapFigure(
    doc,
    {
      ...(base && base.kind === "xyz" ? { tileUrl: base.url, maxZoom: base.maxzoom ?? 19 } : {}),
      plot: parcel.geometry,
      ...(result.buildableFootprint && result.status !== "not_allowed" ? { footprint: result.buildableFootprint } : {}),
      ...(i.fetchBytes ? { fetchBytes: i.fetchBytes } : {}),
    },
    290,
    {
      scale: (m) => m,
      north: t("report.north"),
      legend: [
        { label: t("report.legend.plot"), color: "plot" },
        ...(result.buildableFootprint && result.status !== "not_allowed" ? [{ label: t("result.footprintLegend"), color: "footprint" as const }] : []),
      ],
    },
  );
  if (base) doc.text(`${t("report.basemap")}: ${t(base.attributionKey)}`, { size: 7, color: C.muted, gapAfter: 4 });

  // ---------- plot ----------
  doc.heading(t("report.section.plot"));
  doc.row(t("plot.ref"), parcel.nationalRef);
  if (parcel.officialAreaM2 !== undefined) doc.row(t("plot.area"), fmtArea(parcel.officialAreaM2, lng));
  const grid = i.config.nationalGrid;
  const ring = (parcel.geometry.type === "Polygon" ? parcel.geometry.coordinates[0] : parcel.geometry.coordinates[0]?.[0]) ?? [];
  const pts = ring.slice(0, -1);
  if (pts.length) {
    const c = [pts.reduce((a, p) => a + p[0]!, 0) / pts.length, pts.reduce((a, p) => a + p[1]!, 0) / pts.length] as const;
    if (grid) {
      const [e, n] = toGrid(grid, c[0], c[1]);
      doc.row(t("plot.coords", { grid: grid.name }), `E ${e.toFixed(2)}  N ${n.toFixed(2)}`);
    }
    doc.row(t("report.wgs84"), `${c[1].toFixed(6)}, ${c[0].toFixed(6)}`);
  }
  if (site) {
    for (const fr of site.frontage.filter((x) => x.name)) doc.row(t("plot.frontage"), `${fr.name} · ${fmtNumber(fr.lengthM, lng)} m`);
    if (site.postcodes.length) doc.row(t("plot.postcode"), site.postcodes.join(" / "));
    if (site.roadAccess === "no") doc.row(t("report.roadAccess"), t("plot.noRoad"), { color: C.bad });
    if (site.elevation) {
      const e = site.elevation;
      doc.row(t("plot.elevation"), `${e.maxM - e.minM < 0.5 ? fmtNumber(e.meanM, lng, 1) : `${fmtNumber(e.minM, lng, 1)}–${fmtNumber(e.maxM, lng, 1)}`} m · ${t("plot.elevationSource", { source: e.source })}`);
    }
    if (site.structures) {
      const s = site.structures;
      doc.row(t("plot.structures"), s.raisedShare < 0.03 ? t("plot.structuresNone") : t("plot.structuresValue", { area: fmtArea(s.raisedM2, lng), share: fmtPercent(s.raisedShare, lng), height: fmtNumber(s.maxHeightM, lng, 1) }));
    }
  }

  // ---------- zone ----------
  doc.heading(t("report.section.zone"));
  doc.row(t("plot.zone"), zone.zoneCode, { strong: true });
  if (zone.planName) doc.row(t("plot.plan"), zone.planName);
  if (zone.description) doc.text(zone.description, { size: 9, color: C.muted });
  const pc = zone.publishedConstraints;
  if (pc && (pc.far !== undefined || pc.lot_cov_bldg !== undefined)) {
    doc.text(
      t("plot.coefficients", {
        far: pc.far !== undefined ? fmtNumber(pc.far, lng, 2) : "–",
        cov: pc.lot_cov_bldg !== undefined ? fmtPercent(pc.lot_cov_bldg, lng) : "–",
        stories: pc.stories ?? "–",
        height: pc.height !== undefined ? fmtNumber(pc.height, lng, 1) : "–",
      }),
      { size: 9.5 },
    );
  }
  doc.text(t(`coverage.${data.coverage}`), { size: 8.5, color: data.coverage === "curated" ? C.accent : C.warn });
  if (zones.zones.length > 1) doc.text(t("plot.straddles", { zones: zones.zones.map((z) => `${z.zoneCode} (${Math.round(z.share * 100)}%)`).join(", ") }), { size: 8.5, color: C.warn });
  for (const m of data.mismatches) doc.text(t("mismatch", { constraint: t(`constraint.${m.constraint}`), published: m.published, curated: m.curated }), { size: 8.5, color: C.bad });

  // ---------- restrictions ----------
  doc.heading(t("restrict.title"));
  if (zones.restrictions.length === 0) doc.text(t("restrict.none"), { size: 9, color: C.muted });
  for (const r of [...zones.restrictions].sort((a, b) => ["critical", "warning", "info"].indexOf(a.severity) - ["critical", "warning", "info"].indexOf(b.severity))) {
    doc.bullet(reasonText(t, lng, { reasonKey: r.messageKey, params: r.params }), {
      mark: r.severity === "critical" ? "×" : r.severity === "warning" ? "!" : "i",
      markColor: r.severity === "critical" ? C.bad : r.severity === "warning" ? C.warn : C.muted,
    });
  }

  // ---------- options ----------
  const money0 = (n: number) => fmtMoney(n, lng);
  if (i.options && i.options.length > 1) {
    doc.heading(t("opt.title"));
    doc.text(t("opt.intro"), { size: 8.5, color: C.muted });
    doc.table(
      [t("report.opt.use"), t("report.opt.what"), t("opt.price"), t("opt.gdv"), t("opt.buildCost"), t("opt.residual")],
      i.options.map((o) => [
        `${t(`use.${o.use}`)}${o.relaxed ? " *" : ""}`,
        `${o.units !== undefined ? t("opt.units", { count: o.units }) : o.houses !== undefined ? t("opt.houses", { count: o.houses }) : t("opt.space")} · ${fmtArea(o.gfaM2, lng)}`,
        `${money0(o.price.perM2)}/m²`,
        money0(o.finance.gdv),
        money0(o.finance.hardCost),
        money0(o.finance.residualLandValue),
      ]),
      [0.2, 0.22, 0.13, 0.15, 0.15, 0.15],
      { boldFirstCol: true, textCols: 2, highlightRow: i.options.findIndex((o) => o.use === result.use) },
    );
    if (i.options.some((o) => o.relaxed)) doc.text(`* ${t("report.opt.relaxedNote")}`, { size: 7.5, color: C.muted, gapAfter: 0 });
    doc.text(t("opt.note", { profit: fmtNumber((data.finance?.byUse[result.use].targetProfitPctOfGdv ?? 0) * 100, lng) }), { size: 7.5, color: C.muted });
  }

  // ---------- result ----------
  doc.heading(`${t("report.section.result")} — ${t(`use.${result.use}`)}`);
  if (result.checks.length) {
    for (const c of result.checks)
      doc.bullet(reasonText(t, lng, c), {
        mark: c.status === "allowed" ? "+" : c.status === "maybe" ? "?" : "×",
        markColor: c.status === "allowed" ? C.accent : c.status === "maybe" ? C.warn : C.bad,
      });
    doc.space(4);
  }
  doc.row(t("fig.plotArea"), fmtArea(f.plotAreaM2, lng));
  doc.row(t("fig.far"), fmtNumber(f.far, lng, 2));
  doc.row(t("fig.coverageRatio"), fmtPercent(f.coverageRatio, lng));
  doc.row(t("fig.maxGfa"), fmtArea(f.maxGfaM2, lng, 1), { strong: true });
  doc.row(t("fig.maxCoverage"), fmtArea(f.maxCoverageM2, lng, 1));
  if (f.setbackM !== undefined) doc.row(t("fig.setback"), `${fmtNumber(f.setbackM, lng, 1)} m`);
  if (f.netFootprintM2 !== undefined) doc.row(t("fig.netFootprint"), fmtArea(f.netFootprintM2, lng, 1));
  doc.row(t("fig.footprint"), fmtArea(f.footprintM2, lng, 1));
  if (f.maxStories !== undefined) doc.row(t("fig.maxStories"), String(f.maxStories));
  if (f.maxHeightM !== undefined) doc.row(t("fig.maxHeight"), `${fmtNumber(f.maxHeightM, lng, 1)} m`);
  doc.row(t("fig.feasibleFloors"), String(f.feasibleFloors));
  doc.row(t("fig.buildingHeight"), `~${fmtNumber(f.buildingHeightM, lng, 1)} m`);
  if (f.perFloorM2.length > 0 && result.status !== "not_allowed") {
    doc.text(t("result.perFloor"), { size: 9, bold: true, gapAfter: 0 });
    doc.text(f.perFloorM2.map((a, k) => `${k === 0 ? t("result.ground") : t("result.floorN", { n: k })}: ${fmtArea(a, lng, 1)}`).join(" · "), { size: 9 });
  }
  if (result.units && result.status !== "not_allowed") {
    const u = result.units;
    doc.text(t("result.units"), { size: 9, bold: true, gapAfter: 0 });
    doc.text(
      (["studio", "bed1", "bed2", "bed3"] as const).filter((k) => u.byType[k] > 0).map((k) => `${t(`unit.${k}`)}: ${u.byType[k]} × ~${fmtArea(data.params.unitSizeM2[k], lng)}`).join(" · ") +
        ` · ${t("result.parking")}: ${u.parking.min}–${u.parking.max}`,
      { size: 9 },
    );
  }

  // ---------- relaxations ----------
  const x = result.relaxed;
  if (x) {
    doc.heading(t("relax.title"));
    doc.box(relaxedHeadline(t, lng, result) ?? "", { color: C.violet, fill: C.panel, size: 10 });
    const used = usedSummary(t, lng, result);
    if (used) doc.text(used, { size: 9, gapAfter: 4 });
    if (x.applied.length) doc.text(t("relax.applied"), { size: 9, bold: true, gapAfter: 1 });
    for (const a of x.applied) {
      doc.bullet(`${t(a.titleKey)} (${t(`tier.${a.tier}`)})`, { bold: true, markColor: C.violet });
      for (const c of contributionText(t, lng, a)) doc.text(`→ ${c}`, { size: 9, indent: 13, color: C.violet, gapAfter: 0 });
      doc.text(t(a.grantKey), { size: 8.5, indent: 13, gapAfter: 0 });
      doc.text(t(a.conditionsKey), { size: 8.5, indent: 13, color: C.muted, gapAfter: 0 });
      if (a.cost?.noteKey) doc.text(t(a.cost.noteKey), { size: 8.5, indent: 13, color: C.warn, gapAfter: 0 });
      if (a.statusNoteKey) doc.text(t(a.statusNoteKey), { size: 8.5, indent: 13, color: C.bad, gapAfter: 0 });
      doc.text(`${t("relax.instrument")}: ${a.instrument}${a.provenance.sourceRef ? ` · ${a.provenance.sourceRef}` : ""}`, { size: 7.5, indent: 13, color: C.muted, gapAfter: 4 });
    }
    if (x.notes.length) {
      doc.text(t("relax.notes"), { size: 9, bold: true, gapAfter: 1 });
      for (const a of x.notes) doc.bullet(`${t(a.titleKey)} — ${t(a.grantKey)} (${a.instrument})`, { size: 8.5 });
    }
  }

  // ---------- finance ----------
  const fs = i.finance && i.finance.use === result.use ? i.finance : undefined;
  if (fs) {
    const fr = fs.result, p = fs.params;
    const money = (n: number) => fmtMoney(n, lng, fr.currency);
    const perM2 = (n: number) => `${money(n)}/m²`;
    doc.heading(t("fin.title"));
    doc.box(fr.residualLandValue > 0 ? t("fin.headline.pays", { land: money(fr.residualLandValue), gdv: money(fr.gdv) }) : t("fin.headline.not_pays", { gdv: money(fr.gdv), cost: money(fr.devCost) }), {
      color: fr.residualLandValue > 0 ? C.accent : C.bad,
      fill: C.panel,
      size: 10,
    });
    doc.text(t("report.finAssumptions"), { size: 9, bold: true, gapAfter: 1 });
    doc.row(t("fin.scenario"), t(`fin.scenario.${fs.scenario}`));
    if (fs.areas.residentialNetM2 > 0) doc.row(t("fin.salePrice"), perM2(p.salePricePerM2));
    doc.text(fs.priceSource.edited ? t("fin.priceEdited") : fs.priceSource.source === "comparables" ? t("fin.priceFromComparables", { count: fs.priceSource.count ?? 0 }) : t("fin.priceEstimate"), { size: 8, color: C.muted, gapAfter: 2 });
    if (fs.areas.commercialNetM2 > 0) doc.row(t("fin.commercialPrice"), perM2(p.commercialPricePerM2));
    doc.row(`${t("fin.buildCost")} · ${t(`fin.finish.${fs.finish}`)}`, perM2(p.constructionCostPerM2));
    if (p.basementLevels) doc.row(t("fin.basement"), String(p.basementLevels));
    doc.row(t("fin.profitTarget"), fmtPercent(p.targetProfitPctOfGdv, lng));
    doc.space(4);
    if (fs.areas.residentialNetM2 > 0) doc.row(t(p.affordableBuildableM2 ? "fin.residentialMarket" : "fin.residential", { area: fmtArea(fs.areas.residentialNetM2, lng) }), money(fr.gdvBreakdown.residential));
    if (fr.gdvBreakdown.affordable > 0) doc.row(t("fin.affordable", { area: fmtArea(p.affordableBuildableM2 ?? 0, lng), price: perM2(p.affordablePricePerM2Buildable ?? 0) }), money(fr.gdvBreakdown.affordable));
    if (fs.areas.commercialNetM2 > 0) doc.row(t("fin.commercial", { area: fmtArea(fs.areas.commercialNetM2, lng) }), money(fr.gdvBreakdown.commercial));
    if (fs.areas.verandaM2 > 0) doc.row(t("fin.verandas", { area: fmtArea(fs.areas.verandaM2, lng) }), money(fr.gdvBreakdown.verandas));
    doc.row(t("fin.gdv"), money(fr.gdv), { strong: true });
    doc.row(t("fin.building", { area: fmtArea(fs.areas.gfaM2, lng), rate: perM2(p.constructionCostPerM2) }), money(fr.hardBreakdown.building));
    if (fr.hardBreakdown.verandas > 0) doc.row(t("fin.verandaCost"), money(fr.hardBreakdown.verandas));
    if (fr.hardBreakdown.basement > 0) doc.row(t("fin.basementCost", { count: p.basementLevels }), money(fr.hardBreakdown.basement));
    doc.row(t("fin.external"), money(fr.hardBreakdown.external));
    doc.row(t("fin.soft"), money(fr.softBreakdown.design + fr.softBreakdown.permits + fr.softBreakdown.legal));
    doc.row(t("fin.contingency"), money(fr.softBreakdown.contingency));
    doc.row(t("fin.marketing"), money(fr.softBreakdown.marketing));
    if (fr.softBreakdown.compensation > 0) doc.row(t("fin.compensation"), money(fr.softBreakdown.compensation));
    doc.row(t("fin.financeCost"), money(fr.softBreakdown.finance));
    doc.row(t("fin.devCost"), money(fr.devCost), { strong: true });
    doc.row(t("fin.surplus"), money(fr.surplusBeforeLand), { strong: true });
    doc.row(t("fin.residual", { profit: fmtPercent(p.targetProfitPctOfGdv, lng) }), money(fr.residualLandValue), { strong: true });
    const olv = data.finance?.officialLandValue;
    if (olv) {
      doc.row(t("fin.official", { date: new Date(olv.date).toLocaleDateString(lng.startsWith("el") ? "el-GR" : "en-GB") }), money(olv.total));
      doc.text(t("fin.officialDetail", { rate: perM2(olv.perM2Buildable), far: fmtNumber(olv.far, lng, 2) }), { size: 8, color: C.muted, gapAfter: 0 });
      if (fr.residualLandValue < olv.total) doc.text(t("fin.belowOfficial"), { size: 8, color: C.warn });
    }
    if (fr.withLand) {
      doc.row(t("report.landPrice"), money(fr.withLand.landPrice));
      doc.row(t("fin.landFees"), money(fr.withLand.landFees));
      doc.row(t("fin.profit"), money(fr.withLand.profit), { strong: true });
      doc.row(t("fin.marginGdv"), fmtPercent(fr.withLand.marginOnGdv, lng));
      doc.row(t("fin.marginCost"), fmtPercent(fr.withLand.marginOnCost, lng));
    }
    if (fs.areas.residentialNetM2 > 0) {
      doc.row(t("fin.rentNet", { pct: fmtPercent(p.rentCostsPct, lng) }), money(fr.rental.netAnnual));
      doc.row(t("fin.yieldCost"), fmtPercent(fr.rental.onCost, lng));
    }
    for (const n of data.finance?.notes ?? []) doc.text(`• ${t(`fin.note.${n}`)}`, { size: 8, color: C.muted, gapAfter: 0 });
    doc.space(2);
    for (const s of data.finance?.sources ?? []) doc.text(`${s.label} — ${s.url}`, { size: 7, color: C.muted, gapAfter: 0 });
  }

  // ---------- comparables & market ----------
  const cs = i.comparables;
  const market = data.finance?.market;
  if (cs || market) {
    doc.heading(t("comp.title", { months: cs?.months ?? 6 }));
    if (cs) {
      doc.text(t("comp.average", { value: `${money0(cs.meanPerM2)}/m²` }), { size: 10, bold: true, gapAfter: 0 });
      doc.text(t("comp.detail", { median: `${money0(cs.medianPerM2)}/m²`, min: money0(cs.minPerM2), max: money0(cs.maxPerM2), count: cs.used.length, from: cs.from, to: cs.to }), { size: 8.5 });
      if (cs.excluded.length) doc.text(t("comp.excluded", { count: cs.excluded.length }), { size: 8, color: C.muted });
      doc.table(
        [t("comp.f.date"), t("report.comp.what"), t("comp.f.area"), t("comp.f.price"), "€/m²"],
        [...cs.used, ...cs.excluded].sort((a, b) => b.date.localeCompare(a.date)).map((x) => [
          x.date,
          `${t(`comp.kind.${x.kind}`)}${x.label ? ` · ${x.label}` : ""}${cs.excluded.includes(x) ? ` (${t("report.comp.excluded")})` : ""}`,
          fmtArea(x.areaM2, lng),
          money0(x.price),
          money0(x.price / x.areaM2),
        ]),
        [0.14, 0.44, 0.12, 0.16, 0.14],
        { textCols: 2 },
      );
    } else doc.text(t("comp.none"), { size: 8.5, color: C.muted });
    if (market) {
      doc.text(t("comp.market.title", { area: market.area, from: market.from, to: market.to }), { size: 9, bold: true, gapAfter: 0 });
      doc.text(
        `${t("comp.market.line", { sales: fmtNumber(market.sales, lng), avg: money0(market.avgValuePerSale) })}${market.changeVsYearBefore !== undefined ? ` ${t("comp.market.change", { pct: `${market.changeVsYearBefore >= 0 ? "+" : ""}${fmtPercent(market.changeVsYearBefore, lng)}` })}` : ""}`,
        { size: 8.5, gapAfter: 0 },
      );
      doc.text(`${t("comp.market.note")} ${market.source.label} — ${market.source.url}`, { size: 7.5, color: C.muted });
    }
  }

  // ---------- engineer / unverified ----------
  doc.heading(t("result.toBeChecked"));
  for (const k of result.toBeChecked) doc.bullet(t(k), { mark: "□" });
  const review = dedupeReview(result);
  if (review.length) {
    doc.heading(t("report.section.review"));
    doc.text(t("review.banner"), { size: 9, color: C.warn });
    for (const g of review) doc.bullet(`${g.constraints.map((c) => t(`constraint.${c}`)).join(", ")} — ${g.source}`, { size: 8.5 });
  }

  // ---------- disclaimer & sources ----------
  doc.heading(t("result.disclaimerTitle"));
  doc.text(t(data.disclaimerKey), { size: 8.5 });
  doc.text(`${t("result.sources")}: ${[...new Set([parcel.provenance.source, zone.provenance.source])].join(" · ")}${zone.provenance.sourceUpdatedAt ? ` (${zone.provenance.sourceUpdatedAt})` : ""}`, { size: 8, color: C.muted });
  doc.text(i.config.legal.attributionKeys.map((k) => t(k)).join(" · "), { size: 8, color: C.muted });

  doc.finish((n, of) => t("report.page", { n, of }));
  return doc.pdf.save();
}
