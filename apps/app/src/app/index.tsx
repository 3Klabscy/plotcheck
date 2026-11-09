import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import type { Parcel, UseType } from "@plotcheck/core";
import { PlotMap } from "../components/PlotMap";
import type { PlotMapHandle } from "../components/PlotMap.types";
import { ResultView, UseOptions } from "../components/Result";
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
  const [basemap, setBasemap] = useState<"aerial" | "streets">("aerial");
  const [showZones, setShowZones] = useState(false);
  // Deep link: /?lng=33.615&lat=34.93&z=18 opens the map there (shareable view).
  const q = useLocalSearchParams<{ lng?: string; lat?: string; z?: string }>();
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
        setConfig(cy);
      })
      .catch((e: ApiError) => setError(e.code ?? "generic"));
  }, []);

  const selected = useMemo(() => parcels.find((p) => p.nationalRef === selectedRef), [parcels, selectedRef]);
  const result = analysis?.results.find((r) => r.use === use);

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

  const panel = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.h1}>{t("app.name")}</Text>
          <Text style={styles.muted}>{t("app.tagline")}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
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

      {step === "tap" && !busy && (
        <Card>
          <Text style={styles.h2}>{t("step.tap")}</Text>
          <Text style={[styles.muted, { marginBottom: 6 }]}>{t("step.tapHint")}</Text>
          <Button title={t("btn.locate")} onPress={locate} kind="secondary" testID="locate" />
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
          {zones?.site && (
            <>
              {zones.site.frontage.filter((f) => f.name).map((f) => (
                <Row key={f.name!} label={t("plot.frontage")} value={`${f.name} · ${fmtNumber(f.lengthM, lng)} m`} />
              ))}
              {zones.site.postcodes.length > 0 && <Row label={t("plot.postcode")} value={zones.site.postcodes.join(" / ")} />}
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
          {step === "parcel" && zone && !busy && <Button title={t("btn.confirm")} onPress={confirm} testID="confirm" />}
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
        </>
      )}

      {step === "result" && analysis && result && <ResultView data={analysis} result={result} />}

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
        layers={config.mapLayers}
        initialView={linkView ?? config.defaultView}
        selected={selected?.geometry}
        neighbours={step === "parcel" ? neighbours : []}
        footprint={step === "result" ? result?.buildableFootprint : undefined}
        tapped={tapped}
        basemap={basemap}
        showZones={showZones}
        onTap={onTap}
        onSelectNeighbour={(id) => {
          const p = parcels.find((x) => x.nationalRef === id);
          if (p) void selectParcel(p);
        }}
        attribution={t(config.mapLayers.find((l) => l.role === "basemap")?.attributionKey ?? "")}
      />
      <View style={{ position: "absolute", left: 10, top: 10, right: 52, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["aerial", "streets"] as const).map((b) => (
          <Pressable key={b} onPress={() => setBasemap(b)} style={{ backgroundColor: basemap === b ? colors.ink : "rgba(255,255,255,0.92)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 }}>
            <Text style={{ color: basemap === b ? "#fff" : colors.ink, fontSize: 12, fontWeight: "600" }}>{t(b === "aerial" ? "map.satellite" : "map.streets")}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setShowZones((s) => !s)} style={{ backgroundColor: showZones ? colors.ink : "rgba(255,255,255,0.92)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 }}>
          <Text style={{ color: showZones ? "#fff" : colors.ink, fontSize: 12, fontWeight: "600" }}>{t("map.zones")}</Text>
        </Pressable>
      </View>
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
