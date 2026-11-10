import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import type { Parcel, UseType } from "@plotcheck/core";
import { PlotMap } from "../components/PlotMap";
import { PlotSearch } from "../components/PlotSearch";
import { DrawingsPanel, LayerPanel, MapFabs, MapToolbar, download, type MapPanel } from "../components/MapControls";
import type { FinanceSnapshot } from "../components/Finance";
import { ComparablesCard, statsFor } from "../components/Comparables";
import { OptionsCompare } from "../components/OptionsCompare";
import type { ComparableKind, ComparableSale } from "@plotcheck/engine";
import { kindForUse } from "../lib/comparables";
import type { PriceChoice } from "../lib/options";
import { AccountButton, SavedPlotsCard, SavePlotBar, SignInCard } from "../components/Account";
import { useAccount, type SavedPlot } from "../lib/account";
import { Paywall, SubscriptionLine } from "../components/Paywall";
import type { AccessInfo, AreaInfo, MapLayerDef } from "../lib/api";
import { AreaStatsSheet } from "../components/AreaStats";
import { Terrain3D } from "../components/Terrain3D";
import { toGrid } from "@plotcheck/core";
import { allPositions, feature, importFile, ImportError, type UserCollection, type UserFeature } from "../lib/userLayer";
import type { MeasureResult, MeasureTool, PlotMapHandle } from "../components/PlotMap.types";
import { ResultView, UseOptions, reasonText } from "../components/Result";
import { Button, Card, Loading, Notice, Row, SectionTitle, styles } from "../components/ui";
import { api, ApiError, type AnalyseResponse, type CountryConfig, type ZonesResponse } from "../lib/api";
import { fmtArea, fmtNumber, fmtPercent } from "../lib/format";
import { addCountryMessages, setLanguage } from "../lib/i18n";
import { colors } from "../theme";

type Step = "tap" | "parcel" | "build" | "result";

export default function Home() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const mapRef = useRef<PlotMapHandle>(null);
  const abort = useRef<AbortController | null>(null);

  const [config, setConfig] = useState<CountryConfig | null>(null);
  const [step, setStep] = useState<Step>("tap");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tapped, setTapped] = useState<{ lng: number; lat: number }>();
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [selectedRef, setSelectedRef] = useState<string>();
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalyseResponse | null>(null);
  const [use, setUse] = useState<UseType>();
  const [basemap, setBasemap] = useState<string>();
  const [overlays, setOverlays] = useState<string[]>();
  const [mapPanel, setMapPanel] = useState<MapPanel>(null);
  const [measure, setMeasure] = useState<MeasureTool>("none");
  const [measureReset, setMeasureReset] = useState(0);
  const [measured, setMeasured] = useState<MeasureResult | null>(null);
  const [candidates, setCandidates] = useState(false);
  const view = useRef<{ lng: number; lat: number; zoom: number; bbox: [number, number, number, number] } | undefined>(undefined);
  const [drawings, setDrawings] = useState<UserCollection>({ type: "FeatureCollection", features: [] });
  const [financeSnap, setFinanceSnap] = useState<FinanceSnapshot>();
  const [reportBusy, setReportBusy] = useState(false);
  // comparable sales (session; saved with the account later) and how they are filtered
  const [comparables, setComparables] = useState<ComparableSale[]>([]);
  const [compKind, setCompKind] = useState<ComparableKind | "all">();
  const [compMonths, setCompMonths] = useState(6);
  const [showComp, setShowComp] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [mode, setMode] = useState<"map" | "details">("map");
  // Deep links: /?ref=<national ref> opens that plot; /?lng=33.615&lat=34.93&z=18 opens the map there.
  const q = useLocalSearchParams<{ lng?: string; lat?: string; z?: string; ref?: string; paid?: string }>();
  const linkView = useMemo(() => {
    const lngQ = Number(q.lng), latQ = Number(q.lat), zQ = Number(q.z ?? 18);
    return Number.isFinite(lngQ) && Number.isFinite(latQ) && q.lng && q.lat
      ? { center: { lng: lngQ, lat: latQ }, zoom: Number.isFinite(zQ) ? Math.min(20, Math.max(5, zQ)) : 18 }
      : undefined;
  }, [q.lng, q.lat, q.z]);

  useEffect(() => {
    api
      .countries()
      .then(({ countries }) => {
        const cy = countries[0];
        if (!cy) throw new ApiError("country_not_supported", 404);
        addCountryMessages(cy.messages);
        setBasemap(cy.mapLayers.find((l) => l.role === "basemap" && l.defaultOn)?.id ?? "streets");
        setOverlays(cy.mapLayers.filter((l) => l.role === "overlay" && l.defaultOn).map((l) => l.id));
        setConfig(cy);
      })
      .catch((e: ApiError) => setError(e.code ?? "generic"));
  }, []);

  const selected = useMemo(() => parcels.find((p) => p.nationalRef === selectedRef), [parcels, selectedRef]);

  // Google basemaps (Map Tiles API), offered when the server has a Google key
  const [googleLayers, setGoogleLayers] = useState<MapLayerDef[]>([]);
  useEffect(() => {
    api.googleTiles(i18n.language).then((g) => {
      const keys = { roadmap: "map.googleRoadmap", satellite: "map.googleSatellite", hybrid: "map.googleHybrid" } as const;
      setGoogleLayers(Object.entries(g.tiles ?? {}).map(([type, url]) => ({ id: `google-${type}`, kind: "xyz", role: "basemap", group: "basemap", titleKey: keys[type as keyof typeof keys], url: url!, attributionKey: "map.attribution.google", maxzoom: 22 }) as MapLayerDef));
    }).catch(() => setGoogleLayers([]));
  }, [i18n.language]);
  // layers with pickers (e.g. census level × indicator) draw the chosen sublayers
  const [choice, setChoice] = useState<Record<string, string[]>>({});
  const mapLayers = useMemo(() => {
    const ls = (config?.mapLayers ?? []).map((l) => {
      if (!l.choices || l.kind !== "arcgis") return l;
      const pick = l.choices.layers[(choice[l.id] ?? l.choices.initial).join("|")];
      return pick ? { ...l, layers: pick } : l;
    });
    return [...ls.filter((l) => l.role === "basemap"), ...googleLayers, ...ls.filter((l) => l.role !== "basemap")];
  }, [config, googleLayers, choice]);
  // an overlay with figures behind it (census): taps on the map show those figures instead of picking a plot
  const infoLayer = mapLayers.find((l) => l.info && (overlays ?? []).includes(l.id));
  const [show3d, setShow3d] = useState(false);
  const [areaStats, setAreaStats] = useState<{ loading: boolean; info?: AreaInfo; error?: string } | null>(null);
  const showAreaStats = async (p: { lng: number; lat: number }) => {
    if (!config || !infoLayer) return;
    setTapped(p);
    setMapPanel(null);
    setAreaStats({ loading: true });
    try {
      setAreaStats({ loading: false, info: await api.areaInfo(config.code, infoLayer.id, p.lng, p.lat) });
    } catch (e) {
      setAreaStats({ loading: false, error: e instanceof ApiError ? e.code : "generic" });
    }
  };
  const result = analysis?.results.find((r) => r.use === use);

  // ---------- account: sign-in, saved plots, auto-save of the open saved plot ----------
  const acc = useAccount();
  const [signIn, setSignIn] = useState<string | false>(false);
  const savedCurrent = acc.plots.find((p) => p.national_ref === selected?.nationalRef && p.country_code === config?.code);
  const savedId = savedCurrent?.id;
  useEffect(() => {
    if (!savedId) return;
    const h = setTimeout(() => void acc.updatePlot(savedId, { comparables, drawings, ...(use ? { use_type: use } : {}) }), 1200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparables, drawings, use, savedId]);

  const run = useCallback(async <T,>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(label);
    setError(null);
    try {
      return await fn(ac.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof ApiError ? e.code : "generic");
      return undefined;
    } finally {
      if (abort.current === ac) setBusy(null);
    }
  }, []);

  const selectParcel = useCallback(
    async (p: Parcel) => {
      if (!config) return;
      setSelectedRef(p.nationalRef);
      setZones(null);
      setAnalysis(null);
      setUse(undefined);
      setStep("parcel");
      const z = await run(t("loading.zone"), (signal) => api.zones(config.code, p.nationalRef, signal));
      if (z) setZones(z);
    },
    [config, run, t],
  );

  const onTap = useCallback(
    async (p: { lng: number; lat: number }) => {
      setTapped(p);
      setStep("tap");
      setZones(null);
      setAnalysis(null);
      setUse(undefined);
      const r = await run(t("loading.parcel"), (signal) => api.parcelsAtPoint(p.lng, p.lat, signal));
      if (!r) return;
      setParcels(r.parcels);
      const first = r.parcels[0];
      if (!first) {
        setSelectedRef(undefined);
        setError("parcel_not_found");
        return;
      }
      await selectParcel(first);
    },
    [run, selectParcel, t],
  );

  const locate = useCallback(() => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) return setError("location");
    geo.getCurrentPosition(
      (pos) => {
        const p = { lng: pos.coords.longitude, lat: pos.coords.latitude };
        mapRef.current?.flyTo(p, 18);
        void onTap(p);
      },
      () => setError("location"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }, [onTap]);

  const confirm = useCallback(async () => {
    if (!config || !selected) return;
    const a = await run(t("loading.analysis"), (signal) => api.analyse(config.code, selected.nationalRef, "all", undefined, signal));
    if (a) {
      setAnalysis(a);
      setStep("build");
    }
  }, [config, selected, run, t]);

  // ---------- paid access ----------
  /** Paid parts present (or billing not in force on this server). */
  const full = !analysis?.access || analysis.access.full || !analysis.access.billing;
  const [myAccess, setMyAccess] = useState<AccessInfo>();
  const [payNotice, setPayNotice] = useState<"ok" | "waiting" | "cancel">();
  useEffect(() => {
    if (!acc.session) return setMyAccess(undefined);
    api.access().then(setMyAccess).catch(() => undefined);
  }, [acc.session]);
  // signing in may bring access the analysis on screen did not have: load it again
  const prevSession = useRef(acc.session?.user.id);
  useEffect(() => {
    const id = acc.session?.user.id;
    if (id && id !== prevSession.current && analysis && !full) void confirm();
    prevSession.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc.session?.user.id]);
  // back from the payment page (?ref=…&paid=1): wait for the provider's confirmation, then open the full analysis
  const paidHandled = useRef(false);
  useEffect(() => {
    if (paidHandled.current || !config || !selected || !zones || !q.paid || selected.nationalRef !== q.ref) return;
    paidHandled.current = true;
    if (q.paid !== "1") return setPayNotice("cancel");
    setPayNotice("waiting");
    void (async () => {
      for (let i = 0; i < 12; i++) {
        const a = await api.access(config.code, selected.nationalRef).catch(() => undefined);
        if (a?.full) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      setPayNotice("ok");
      await confirm();
      api.access().then(setMyAccess).catch(() => undefined);
    })();
  }, [config, selected, zones, q.paid, q.ref, confirm]);

  // open a shared plot link once
  const openedRef = useRef(false);
  useEffect(() => {
    if (!config || !q.ref || openedRef.current) return;
    openedRef.current = true;
    void run(t("loading.parcel"), (signal) => api.parcelsById(config.code, { nationalRef: String(q.ref) }, signal)).then((r) => {
      const p = r?.parcels[0];
      if (!p) return;
      setParcels([p]);
      void selectParcel(p);
    });
  }, [config, q.ref, run, selectParcel, t]);

  const shareUrl = () => {
    const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
    if (selected) return `${base}?ref=${encodeURIComponent(selected.nationalRef)}`;
    const v = view.current;
    return v ? `${base}?lng=${v.lng.toFixed(6)}&lat=${v.lat.toFixed(6)}&z=${v.zoom.toFixed(1)}` : base;
  };

  const fitFeatures = (fs: UserFeature[]) => {
    const pts = fs.flatMap((f) => allPositions(f.geometry));
    if (pts.length === 0) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 0.0003;
    mapRef.current?.fitBounds([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
  };

  const importDrawings = () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".geojson,.json,.kml,.dxf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5_000_000) return setError("import_too_large");
      try {
        const fs = importFile(file.name, await file.text(), config?.nationalGrid);
        setDrawings((d) => ({ ...d, features: [...d.features, ...fs] }));
        setMapPanel("drawings");
        setError(null);
        fitFeatures(fs);
      } catch (e) {
        setError(e instanceof ImportError ? `import_${e.message}` : "import_bad_file");
      }
    };
    input.click();
  };

  const saveMeasure = () => {
    const c = measured?.coords ?? [];
    const geom = measure === "area" && c.length >= 3 ? { type: "Polygon" as const, coordinates: [[...c, c[0]!]] } : c.length === 1 ? { type: "Point" as const, coordinates: c[0]! } : { type: "LineString" as const, coordinates: c };
    const n = drawings.features.filter((f) => f.properties.source === "drawing").length + 1;
    setDrawings((d) => ({ ...d, features: [...d.features, feature(geom, `${t(`map.geom.${geom.type}`)} ${n}`, "drawing")] }));
    setMeasureReset((x) => x + 1);
  };

  const findInView = async (plot: string): Promise<string | undefined> => {
    const v = view.current;
    if (!config || !v) return "generic";
    if (v.zoom < 13) return "zoom_in";
    try {
      const r = await api.parcelsInBox(config.code, plot, v.bbox);
      if (r.parcels.length === 0) return "parcel_not_found_here";
      setTapped(undefined);
      setParcels(r.parcels);
      if (r.parcels.length === 1) {
        setCandidates(false);
        void selectParcel(r.parcels[0]!);
      } else {
        setStep("tap");
        setSelectedRef(undefined);
        setCandidates(true);
      }
      return undefined;
    } catch (e) {
      return e instanceof ApiError ? e.code : "generic";
    }
  };

  const makeReport = async () => {
    if (!config || !analysis || !result || !zones) return;
    setReportBusy(true);
    setError(null);
    try {
      // loaded on demand: pdf-lib and the fonts are only needed here
      const [{ buildReport }, { loadFonts }] = await Promise.all([import("../lib/report/build"), import("../lib/report/fonts")]);
      const comp = statsFor(comparables, compKind ?? kindForUse(result.use), compMonths);
      const options = (await import("../lib/options")).compareOptions(analysis, { relaxed: true, priceFor });
      const pdf = await buildReport({ t, lng, config, zones, data: analysis, result, ...(financeSnap ? { finance: financeSnap } : {}), ...(comp ? { comparables: comp } : {}), options, fonts: await loadFonts(), generatedAt: new Date() });
      const name = `plotcheck-${analysis.parcel.nationalRef.replace(/[^\w-]+/g, "_")}-${result.use}.pdf`;
      download(name, "application/pdf", pdf);
    } catch (e) {
      console.error(e);
      setError("report_failed");
    } finally {
      setReportBusy(false);
    }
  };

  /** Sale price for a use from the comparables of its kind (or the chosen kind), if any. */
  const priceFor = (u: UseType): PriceChoice | undefined => {
    const st = statsFor(comparables, compKind ?? kindForUse(u), compMonths);
    return st ? { perM2: st.meanPerM2, source: "comparables", count: st.used.length } : undefined;
  };

  const grid = config?.nationalGrid;
  const fmtGrid = (lng: number, lat: number) => {
    if (!grid) return "";
    const [e, n] = toGrid(grid, lng, lat);
    return `E ${e.toFixed(2)}  N ${n.toFixed(2)}`;
  };

  const savePlot = async () => {
    if (!config || !selected) return;
    const ring = (selected.geometry.type === "Polygon" ? selected.geometry.coordinates[0] : selected.geometry.coordinates[0]?.[0]) ?? [];
    const pts = ring.slice(0, -1);
    await acc.savePlot({
      country_code: config.code,
      national_ref: selected.nationalRef,
      label: selected.label ? t("plot.title", { label: selected.label }) : null,
      note: null,
      centroid_lng: pts.length ? pts.reduce((a, p) => a + p[0]!, 0) / pts.length : null,
      centroid_lat: pts.length ? pts.reduce((a, p) => a + p[1]!, 0) / pts.length : null,
      area_m2: selected.officialAreaM2 ?? null,
      zone_code: zones?.primary?.zone.zoneCode ?? null,
      use_type: use ?? null,
      comparables,
      drawings,
    });
  };

  const openSaved = async (sp: SavedPlot) => {
    if (!config) return;
    const r = await run(t("loading.parcel"), (signal) => api.parcelsById(config.code, { nationalRef: sp.national_ref }, signal));
    const p = r?.parcels[0];
    if (!p) return;
    setTapped(undefined);
    setCandidates(false);
    setComparables(sp.comparables ?? []);
    setDrawings(sp.drawings?.features ? sp.drawings : { type: "FeatureCollection", features: [] });
    setParcels([p]);
    await selectParcel(p);
    if (sp.use_type) {
      const a = await run(t("loading.analysis"), (signal) => api.analyse(config.code, p.nationalRef, "all", undefined, signal));
      if (a) {
        setAnalysis(a);
        setUse(sp.use_type);
        setStep("result");
      }
    }
  };

  if (!config) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 }}>
        {error ? <Text style={styles.body}>{t(`error.${error}`)}</Text> : <Loading label={t("loading.config")} />}
      </View>
    );
  }

  const neighbours = parcels.filter((p) => p.nationalRef !== selectedRef).map((p) => ({ id: p.nationalRef, geometry: p.geometry }));
  const zone = zones?.primary?.zone;
  const pc = zone?.publishedConstraints;

  const plotSearch = (close?: () => void) => config && (
    <PlotSearch
        country={config.code}
        region="4"
        onFound={(p) => {
          setTapped(undefined);
          setCandidates(false);
          setParcels([p]);
          close?.();
          void selectParcel(p);
        }}
        onCandidates={(ps) => {
          setTapped(undefined);
          setSelectedRef(undefined);
          setParcels(ps);
          setCandidates(true);
          close?.();
          const pts = ps.flatMap((p) => (p.geometry.type === "Polygon" ? p.geometry.coordinates.flat() : p.geometry.coordinates.flat(2)) as number[][]);
          mapRef.current?.fitBounds([Math.min(...pts.map((c) => c[0]!)), Math.min(...pts.map((c) => c[1]!)), Math.max(...pts.map((c) => c[0]!)), Math.max(...pts.map((c) => c[1]!))]);
        }}
        onStreet={(st) => {
          setTapped(undefined);
          close?.();
          mapRef.current?.fitBounds(st.bbox);
        }}
    />
  );

  const panel = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.h1}>{t("app.name")}</Text>
          <Text style={styles.muted}>{t("app.tagline")}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <AccountButton onSignIn={() => setSignIn(t("acc.why"))} />
          {config.locales.map((l) => (
            <Pressable key={l} testID={`lang-${l}`} onPress={() => setLanguage(l)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: lng === l ? colors.accent : colors.line, backgroundColor: lng === l ? colors.allowedBg : colors.panel }}>
              <Text style={{ fontWeight: "700", color: lng === l ? colors.accent : colors.muted }}>{t(`lang.${l}`)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {error && (
        <Notice tone="error">
          <Text style={styles.body}>{t(`error.${error}`, { defaultValue: t("error.generic") })}</Text>
        </Notice>
      )}
      {busy && <Loading label={busy} />}
      <SubscriptionLine {...(myAccess ? { access: myAccess } : {})} />
      {payNotice && (
        <Notice tone={payNotice === "cancel" ? "warn" : "info"}>
          <Text style={styles.body} testID="pay-notice">{t(`pay.notice.${payNotice}`)}</Text>
        </Notice>
      )}
      {signIn !== false && !acc.session && <SignInCard reason={signIn} onDone={() => setSignIn(false)} />}

      {step === "tap" && !busy && <SavedPlotsCard onOpen={(p) => void openSaved(p)} />}
      {step === "tap" && !busy && (
        <Card>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
            {(["map", "details"] as const).map((m) => (
              <Pressable key={m} testID={`mode-${m}`} onPress={() => setMode(m)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", borderWidth: 1, borderColor: mode === m ? colors.accent : colors.line, backgroundColor: mode === m ? colors.allowedBg : colors.panel }}>
                <Text style={{ fontWeight: "700", color: mode === m ? colors.accent : colors.muted, fontSize: 13 }}>{t(m === "map" ? "mode.map" : "mode.details")}</Text>
              </Pressable>
            ))}
          </View>
          {mode === "map" ? (
            <>
              <Text style={styles.h2}>{t("step.tap")}</Text>
              <Text style={[styles.muted, { marginBottom: 6 }]}>{t("step.tapHint")}</Text>
              <Button title={t("btn.locate")} onPress={locate} kind="secondary" testID="locate" />
            </>
          ) : (
            plotSearch()
          )}
        </Card>
      )}

      {selected && step !== "tap" && (
        <Card>
          <Text style={styles.h2} testID="plot-title">{t("plot.title", { label: selected.label ?? "" })}</Text>
          {(selected.distanceM ?? 0) > 0 && selected.nationalRef === parcels[0]?.nationalRef && step === "parcel" && (
            <Text style={[styles.small, { color: colors.maybe, marginBottom: 6 }]}>{t("plot.outside")}</Text>
          )}
          <Row label={t("plot.ref")} value={selected.nationalRef} />
          {selected.officialAreaM2 !== undefined && <Row label={t("plot.area")} value={fmtArea(selected.officialAreaM2, lng)} />}
          {grid && (() => {
            const ring = (selected.geometry.type === "Polygon" ? selected.geometry.coordinates[0] : selected.geometry.coordinates[0]?.[0]) ?? [];
            const pts = ring.slice(0, -1);
            if (pts.length === 0) return null;
            const c = [pts.reduce((a, p) => a + p[0]!, 0) / pts.length, pts.reduce((a, p) => a + p[1]!, 0) / pts.length] as const;
            return <Row label={t("plot.coords", { grid: grid.name })} value={fmtGrid(c[0], c[1])} />;
          })()}
          {(() => {
            const ring = (selected.geometry.type === "Polygon" ? selected.geometry.coordinates[0] : selected.geometry.coordinates[0]?.[0]) ?? [];
            const pts = ring.slice(0, -1);
            if (pts.length === 0) return null;
            const ll = `${(pts.reduce((a, p) => a + p[1]!, 0) / pts.length).toFixed(6)},${(pts.reduce((a, p) => a + p[0]!, 0) / pts.length).toFixed(6)}`;
            const link = (title: string, href: string, id: string) => (
              <Pressable key={id} testID={id} accessibilityRole="link" onPress={() => void Linking.openURL(href)}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 8, alignItems: "center", backgroundColor: colors.panel }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.accent, textAlign: "center" }}>{title}</Text>
              </Pressable>
            );
            return (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 4 }}>
                {link(`📍 ${t("plot.openGoogle")}`, `https://www.google.com/maps/search/?api=1&query=${ll}`, "google-open")}
                {link(`🧭 ${t("plot.directions")}`, `https://www.google.com/maps/dir/?api=1&destination=${ll}`, "google-directions")}
                {link(`🚶 ${t("plot.streetView")}`, `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}`, "google-streetview")}
              </View>
            );
          })()}
          <Pressable testID="open-3d" accessibilityRole="button" onPress={() => setShow3d(true)}
            style={{ borderWidth: 1, borderColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4, marginBottom: 6, backgroundColor: colors.allowedBg }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.accent }}>🏔 {t("t3d.open")}</Text>
          </Pressable>
          {zones?.site && (
            <>
              {zones.site.frontage.filter((f) => f.name).map((f) => (
                <Row key={f.name!} label={t("plot.frontage")} value={`${f.name} · ${fmtNumber(f.lengthM, lng)} m`} />
              ))}
              {zones.site.postcodes.length > 0 && <Row label={t("plot.postcode")} value={zones.site.postcodes.join(" / ")} />}
              {zones.site.structures && (
                <Row
                  label={t("plot.structures")}
                  value={zones.site.structures.raisedShare < 0.03 ? t("plot.structuresNone") : t("plot.structuresValue", { area: fmtArea(zones.site.structures.raisedM2, lng), share: fmtPercent(zones.site.structures.raisedShare, lng), height: fmtNumber(zones.site.structures.maxHeightM, lng, 1) })}
                />
              )}
              {zones.site.elevation && (
                <Row
                  label={t("plot.elevation")}
                  value={`${zones.site.elevation.maxM - zones.site.elevation.minM < 0.5 ? `${fmtNumber(zones.site.elevation.meanM, lng, 1)}` : `${fmtNumber(zones.site.elevation.minM, lng, 1)}–${fmtNumber(zones.site.elevation.maxM, lng, 1)}`} m · ${t("plot.elevationSource", { source: zones.site.elevation.source })}`}
                />
              )}
              {zones.site.roadAccess === "no" && (
                <Text style={[styles.small, { color: colors.notAllowed, marginTop: 6 }]} testID="no-road">{t("plot.noRoad")}</Text>
              )}
            </>
          )}
          {zone && (
            <>
              <Row label={t("plot.zone")} value={zone.zoneCode} strong />
              {zone.planName && <Row label={t("plot.plan")} value={zone.planName} />}
              {zone.description && <Text style={[styles.small, { marginTop: 6 }]}>{zone.description}</Text>}
              {pc && (pc.far !== undefined || pc.lot_cov_bldg !== undefined) && (
                <Text style={[styles.body, { marginTop: 6, fontSize: 14 }]} testID="coefficients">
                  {t("plot.coefficients", {
                    far: pc.far !== undefined ? fmtNumber(pc.far, lng, 2) : "–",
                    cov: pc.lot_cov_bldg !== undefined ? fmtPercent(pc.lot_cov_bldg, lng) : "–",
                    stories: pc.stories ?? "–",
                    height: pc.height !== undefined ? fmtNumber(pc.height, lng, 1) : "–",
                  })}
                </Text>
              )}
              <Text style={[styles.small, { marginTop: 8, color: zones?.primary?.coverage === "curated" ? colors.allowed : colors.maybe }]}>
                {t(`coverage.${zones?.primary?.coverage ?? "source_only"}`)}
              </Text>
              {zones && zones.zones.length > 1 && (
                <Text style={[styles.small, { marginTop: 6, color: colors.maybe }]}>{t("plot.straddles", { zones: zones.zones.map((z) => `${z.zoneCode} (${Math.round(z.share * 100)}%)`).join(", ") })}</Text>
              )}
              {zones?.primary?.mismatches.map((m) => (
                <Text key={m.constraint} style={[styles.small, { marginTop: 6, color: colors.notAllowed }]}>
                  {t("mismatch", { constraint: t(`constraint.${m.constraint}`), published: m.published, curated: m.curated })}
                </Text>
              ))}
            </>
          )}
          {zones && (
            <View style={{ marginTop: 12 }} testID="restrictions">
              <Text style={[styles.small, { fontWeight: "700", color: colors.ink, marginBottom: 4 }]}>{t("restrict.title")}</Text>
              {zones.restrictions.length === 0 && <Text style={styles.small}>{t("restrict.none")}</Text>}
              {[...zones.restrictions]
                .sort((a, b) => ["critical", "warning", "info"].indexOf(a.severity) - ["critical", "warning", "info"].indexOf(b.severity))
                .map((r, i) => (
                  <View key={`${r.layerId}-${i}`} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                    <Text style={{ color: r.severity === "critical" ? colors.notAllowed : r.severity === "warning" ? colors.maybe : colors.muted, fontWeight: "700" }}>
                      {r.severity === "critical" ? "⛔" : r.severity === "warning" ? "⚠" : "ℹ"}
                    </Text>
                    <Text style={[styles.small, { color: colors.ink, flex: 1 }]}>
                      {reasonText(t, lng, { reasonKey: r.messageKey, params: r.params })}
                    </Text>
                  </View>
                ))}
            </View>
          )}
          {step === "parcel" && zone && !busy && <Button title={t("btn.confirm")} onPress={confirm} testID="confirm" />}
          {zone && !busy && (full || savedCurrent) && (
            <SavePlotBar
              key={savedCurrent?.id ?? "new"}
              {...(savedCurrent ? { saved: savedCurrent } : {})}
              onSave={savePlot}
              onNote={(note) => savedCurrent && void acc.updatePlot(savedCurrent.id, { note })}
              onNeedSignIn={() => setSignIn(t("acc.whySave"))}
            />
          )}
          {neighbours.length > 0 && step === "parcel" && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.small}>{t("plot.neighbours")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {parcels
                  .filter((p) => p.nationalRef !== selectedRef)
                  .map((p) => (
                    <Pressable key={p.nationalRef} onPress={() => selectParcel(p)} style={{ borderWidth: 1, borderColor: colors.neighbour, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#FFFBEA" }}>
                      <Text style={{ fontSize: 13, color: colors.ink }}>
                        {p.label} · {fmtArea(p.officialAreaM2 ?? 0, lng)}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          )}
        </Card>
      )}

      {(step === "build" || step === "result") && analysis && (
        <>
          <SectionTitle>{step === "result" ? t("result.options") : t("build.question")}</SectionTitle>
          <UseOptions
            data={analysis}
            selected={use}
            onPick={(u) => {
              setUse(u);
              setStep("result");
            }}
          />
          {!full && selected && (
            <Paywall
              country={config.code}
              nationalRef={selected.nationalRef}
              {...((pv) => (pv ? { preview: pv } : {}))((result ?? analysis.results.find((r) => r.relaxedPreview))?.relaxedPreview)}
              onNeedSignIn={(reason) => setSignIn(reason)}
            />
          )}
          {full && step === "result" && (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <View style={{ flex: 1 }}><Button title={`${showComp ? "▾" : "▸"} ${t("comp.short", { count: comparables.length })}`} kind="secondary" onPress={() => setShowComp((x) => !x)} testID="toggle-comp" /></View>
              <View style={{ flex: 1 }}><Button title={`${showOptions ? "▾" : "▸"} ${t("opt.short")}`} kind="secondary" onPress={() => setShowOptions((x) => !x)} testID="toggle-options" /></View>
            </View>
          )}
          {full && (step === "build" || showComp) && (
            <ComparablesCard
              sales={comparables}
              onChange={setComparables}
              kind={compKind ?? kindForUse(use ?? "apartment_block")}
              onKind={setCompKind}
              months={compMonths}
              onMonths={setCompMonths}
              {...(analysis.finance?.market ? { market: analysis.finance.market } : {})}
              countryCode={config.code}
            />
          )}
          {full && (step === "build" || showOptions) && (
            <OptionsCompare
              data={analysis}
              priceFor={priceFor}
              {...(use ? { selected: use } : {})}
              onPick={(u) => {
                setUse(u);
                setStep("result");
                setShowOptions(false);
              }}
            />
          )}
        </>
      )}

      {step === "result" && analysis && result && (
        <>
          {full && <Button title={reportBusy ? t("report.making") : t("report.download")} onPress={makeReport} disabled={reportBusy} testID="report-pdf" />}
          <View style={{ height: 12 }} />
          <ResultView data={analysis} result={result} onFinance={setFinanceSnap} {...((p) => (p ? { marketPrice: p } : {}))(priceFor(result.use))} />
        </>
      )}

      {step !== "tap" && !busy && (
        <Button
          title={t("btn.change")}
          kind="secondary"
          onPress={() => {
            setStep("tap");
            setParcels([]);
            setSelectedRef(undefined);
            setZones(null);
            setAnalysis(null);
            setUse(undefined);
            setTapped(undefined);
          }}
        />
      )}
      <Text style={[styles.small, { marginTop: 16 }]}>{config.legal.attributionKeys.map((k) => t(k)).join(" · ")}</Text>
    </ScrollView>
  );

  const map = (
    <View style={{ flex: 1, position: "relative", minHeight: 280 }}>
      <PlotMap
        ref={mapRef}
        layers={mapLayers}
        initialView={linkView ?? config.defaultView}
        selected={selected?.geometry}
        neighbours={step === "parcel" || (step === "tap" && candidates) ? neighbours : []}
        footprint={step === "result" ? result?.buildableFootprint : undefined}
        tapped={tapped}
        basemap={basemap ?? "streets"}
        overlays={overlays ?? []}
        measure={measure}
        measureReset={measureReset}
        onMeasure={setMeasured}
        onMove={(v) => (view.current = v)}
        loadContours={(bbox, signal) => api.contours(config.code, bbox, signal)}
        drawings={drawings}
        formatCursor={(x, y) => `${grid ? `${grid.name}  ${fmtGrid(x, y)}  ·  ` : ""}${y.toFixed(6)}, ${x.toFixed(6)}`}
        onTap={(p) => {
          if (infoLayer && measure === "none") return void showAreaStats(p);
          setCandidates(false);
          void onTap(p);
        }}
        onSelectNeighbour={(id) => {
          const p = parcels.find((x) => x.nationalRef === id);
          if (p) void selectParcel(p);
        }}
        fmtLength={(m) => `${fmtNumber(m, lng, 1)} m`}
        fmtArea={(m2) => fmtArea(m2, lng, 1)}
        attribution={(k, date) => (date ? `${t("map.orthoCredit", { date })}` : t(k))}
      />
      <MapToolbar
        measure={measure}
        onMeasure={(m) => { setMeasure(m); setMapPanel(null); }}
        onClear={() => setMeasureReset((n) => n + 1)}
        result={measured}
        plot={step !== "tap" ? selected : undefined}
        shareUrl={shareUrl}
        panel={mapPanel}
        setPanel={setMapPanel}
        grid={grid}
        onImport={importDrawings}
        drawingsCount={drawings.features.length}
        onSaveMeasure={saveMeasure}
        onFindInView={findInView}
        onUndo={() => mapRef.current?.undoMeasure()}
        getView={() => mapRef.current?.view()}
        on3d={() => setShow3d(true)}
        searchContent={plotSearch(() => setMapPanel(null))}
      />
      {infoLayer && measure === "none" && mapPanel === null && !areaStats && (
        <View testID="stats-banner" pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 76, bottom: 10, zIndex: 9, alignItems: "flex-start" }}>
          <View style={{ backgroundColor: "rgba(255,255,255,0.97)", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.accent, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <Text style={{ fontSize: wide ? 13 : 15, color: colors.ink, fontWeight: "600" }}>{t("map.statsTap")}</Text>
            <Pressable testID="stats-off" onPress={() => setOverlays((o) => (o ?? []).filter((x) => x !== infoLayer.id))}>
              <Text style={{ fontSize: wide ? 13 : 15, color: colors.accent, fontWeight: "700" }}>{t("map.statsOff")}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {show3d && selected && <Terrain3D country={config.code} parcel={selected} onClose={() => setShow3d(false)} />}
      {areaStats && <AreaStatsSheet info={areaStats.info} loading={areaStats.loading} error={areaStats.error} onClose={() => { setAreaStats(null); setTapped(undefined); }} />}
      <MapFabs onZoomIn={() => mapRef.current?.zoomIn()} onZoomOut={() => mapRef.current?.zoomOut()} onLocate={locate} />
      {mapPanel === "drawings" && drawings.features.length > 0 && (
        <DrawingsPanel
          drawings={drawings}
          grid={grid}
          onDelete={(id) => setDrawings((d) => ({ ...d, features: d.features.filter((f) => f.id !== id) }))}
          onClearAll={() => { setDrawings({ type: "FeatureCollection", features: [] }); setMapPanel(null); }}
          onZoom={(f) => fitFeatures([f])}
          onClose={() => setMapPanel(null)}
        />
      )}
      {mapPanel === "layers" && (
        <LayerPanel
          layers={mapLayers}
          googleLocked={googleLayers.length === 0}
          country={config.code}
          choice={choice}
          onChoice={(id, sel) => setChoice((c) => ({ ...c, [id]: sel }))}
          zoom={view.current?.zoom}
          basemap={basemap ?? "streets"}
          overlays={overlays ?? []}
          onBasemap={setBasemap}
          onToggle={(id) => setOverlays((o) => ((o ?? []).includes(id) ? (o ?? []).filter((x) => x !== id) : [...(o ?? []), id]))}
          onClose={() => setMapPanel(null)}
        />
      )}
    </View>
  );

  return wide ? (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
      {map}
      <View style={{ width: 460, borderLeftWidth: 1, borderColor: colors.line }}>{panel}</View>
    </View>
  ) : (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: "48%" }}>{map}</View>
      <View style={{ flex: 1, borderTopWidth: 1, borderColor: colors.line }}>{panel}</View>
    </View>
  );
}
