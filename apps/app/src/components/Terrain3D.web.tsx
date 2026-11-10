import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { Parcel } from "@plotcheck/core";
import { api, ApiError, type TerrainResponse } from "../lib/api";
import { fmtNumber } from "../lib/format";
import { toRoot } from "../lib/portal";
import { colors } from "../theme";
import { download } from "./MapControls";

/**
 * 3D view of a plot and its surroundings: DLS terrain model (ground) or surface model (with
 * buildings and trees), the 2019 orthophoto draped on it, the plot boundary in 3D.
 */

const ORTHO_2019 = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/BASEMAPS/Orthoimagery_2019_WebMercator/MapServer";
const NODATA = -32768;
const PLOT_COLOR = colors.plot;

interface Model {
  t: TerrainResponse;
  ground: Float32Array;
  surface?: Float32Array;
  /** metres per degree */
  mLng: number;
  mLat: number;
  /** centre of the grid (lng, lat) */
  cx: number;
  cy: number;
}

function decode(b64: string, baseM: number, n: number): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = new Int16Array(bytes.buffer, 0, Math.min(n, bytes.length >> 1));
  const out = new Float32Array(n).fill(NaN);
  for (let i = 0; i < raw.length; i++) if (raw[i] !== NODATA) out[i] = baseM + raw[i]! / 10;
  return out;
}

/** Fill cells without data from their neighbours (a few passes), the rest with the lowest value. */
function fillGaps(v: Float32Array, cols: number, rows: number) {
  for (let pass = 0; pass < 6; pass++) {
    let missing = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!Number.isNaN(v[i]!)) continue;
        let s = 0, k = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const x = v[rr * cols + cc]!;
          if (!Number.isNaN(x)) { s += x; k++; }
        }
        if (k) v[i] = s / k;
        else missing++;
      }
    if (!missing) return;
  }
  let min = Infinity;
  for (const x of v) if (!Number.isNaN(x) && x < min) min = x;
  for (let i = 0; i < v.length; i++) if (Number.isNaN(v[i]!)) v[i] = Number.isFinite(min) ? min : 0;
}

function toModel(t: TerrainResponse): Model {
  const n = t.cols * t.rows;
  const ground = decode(t.ground, t.baseM, n);
  fillGaps(ground, t.cols, t.rows);
  let surface: Float32Array | undefined;
  if (t.surface) {
    surface = decode(t.surface, t.baseM, n);
    // the surface is never below the ground (and fills from it where missing)
    for (let i = 0; i < n; i++) surface[i] = Number.isNaN(surface[i]!) ? ground[i]! : Math.max(surface[i]!, ground[i]!);
  }
  const cx = t.x0 + ((t.cols - 1) * t.dx) / 2, cy = t.y0 - ((t.rows - 1) * t.dy) / 2;
  return { t, ground, surface, mLng: t.cellM[0] / t.dx, mLat: t.cellM[1] / t.dy, cx, cy };
}

/** Height at a lng/lat (bilinear). */
function heightAt(m: Model, h: Float32Array, lng: number, lat: number): number {
  const { cols, rows, x0, y0, dx, dy } = m.t;
  const fc = Math.max(0, Math.min(cols - 1.001, (lng - x0) / dx)), fr = Math.max(0, Math.min(rows - 1.001, (y0 - lat) / dy));
  const c = Math.floor(fc), r = Math.floor(fr), u = fc - c, w = fr - r;
  const a = h[r * cols + c]!, b = h[r * cols + c + 1]!, d = h[(r + 1) * cols + c]!, e = h[(r + 1) * cols + c + 1]!;
  return a * (1 - u) * (1 - w) + b * u * (1 - w) + d * (1 - u) * w + e * u * w;
}

const rings = (g: Parcel["geometry"]) => (g.type === "Polygon" ? [g.coordinates[0]!] : g.coordinates.map((p) => p[0]!));

function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

function webMercator(lng: number, lat: number): [number, number] {
  return [(lng * Math.PI * 6378137) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137];
}

/** Ground figures inside the plot and over the whole view. */
function stats(m: Model, plot: Parcel) {
  const { cols, rows, x0, y0, dx, dy } = m.t;
  const rs = rings(plot.geometry);
  let pMin = Infinity, pMax = -Infinity, aMin = Infinity, aMax = -Infinity, tall = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const g = m.ground[r * cols + c]!;
      aMin = Math.min(aMin, g); aMax = Math.max(aMax, g);
      const x = x0 + c * dx, y = y0 - r * dy;
      if (rs.some((ring) => inRing(x, y, ring))) {
        pMin = Math.min(pMin, g); pMax = Math.max(pMax, g);
        if (m.surface) tall = Math.max(tall, m.surface[r * cols + c]! - g);
      }
    }
  // surveyed buildings standing on the plot (centre inside it)
  const onPlot = (m.t.buildings ?? []).filter((b) => {
    const r = b.rings[0]!.slice(0, -1);
    const x = r.reduce((a, p) => a + p[0], 0) / r.length, y = r.reduce((a, p) => a + p[1], 0) / r.length;
    return rs.some((ring) => inRing(x, y, ring));
  });
  return { pMin, pMax, aMin, aMax, tall, bCount: onPlot.length, bRoof: Math.max(0, ...onPlot.map((b) => b.roofM)), bFloors: Math.max(0, ...onPlot.map((b) => b.floors ?? 0)) };
}

type Building = NonNullable<TerrainResponse["buildings"]>[number];
const DRACO = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
/** Height of the geoid above the WGS84 ellipsoid near Larnaca (approx.): start value, corrected by ray casting. */
const GEOID_N = 25;

/** Clean building blocks from surveyed outlines and heights: walls to the eave, flat or hipped roofs (orthophoto on the roofs). */
function buildingsGroup(m: Model, list: Building[], yGround: (g: number) => number, wallMat: THREE.Material, roofMat: THREE.Material): THREE.Group {
  const { cols, rows, x0, y0, dx, dy } = m.t;
  const west = x0, east = x0 + (cols - 1) * dx, north = y0, south = y0 - (rows - 1) * dy;
  const X = (lng: number) => (lng - m.cx) * m.mLng, Z = (lat: number) => -(lat - m.cy) * m.mLat;
  const UV = (lng: number, lat: number) => [(lng - west) / (east - west), (lat - south) / (north - south)];
  const wp: number[] = [], rp: number[] = [], ruv: number[] = [];
  const roofTri = (a: number[], b: number[], c: number[]) => {
    for (const v of [a, b, c]) {
      rp.push(X(v[0]!), v[2]!, Z(v[1]!));
      ruv.push(...UV(v[0]!, v[1]!));
    }
  };
  for (const b of list) {
    const rs = b.rings.map((r) => r.slice(0, -1)).filter((r) => r.length >= 3);
    if (!rs.length) continue;
    const outer = rs[0]!;
    const c = [outer.reduce((a, p) => a + p[0], 0) / outer.length, outer.reduce((a, p) => a + p[1], 0) / outer.length] as const;
    const base = yGround(b.groundM ?? heightAt(m, m.ground, c[0], c[1]));
    const wallTop = b.roof === "flat" ? b.roofM : b.roof === "mixed" ? Math.min(b.roofM, Math.max(b.eaveM, b.typicalM ?? b.roofM)) : b.eaveM;
    const top = base + Math.max(1, wallTop);
    for (const ring of rs)
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        const [ax, az, bx, bz] = [X(p[0]), Z(p[1]), X(q[0]), Z(q[1])];
        wp.push(ax, base, az, bx, base, bz, bx, top, bz, ax, base, az, bx, top, bz, ax, top, az);
      });
    const hip = b.roof === "pitched" && b.roofM - b.eaveM > 0.3 && rs.length === 1;
    if (hip) {
      const ridge = base + b.roofM, k = 0.3;
      const inner = outer.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]);
      outer.forEach((p, i) => {
        const j = (i + 1) % outer.length;
        const o1 = [p[0], p[1], top], o2 = [outer[j]![0], outer[j]![1], top], i1 = [inner[i]![0]!, inner[i]![1]!, ridge], i2 = [inner[j]![0]!, inner[j]![1]!, ridge];
        roofTri(o1, o2, i2);
        roofTri(o1, i2, i1);
      });
      const tris = THREE.ShapeUtils.triangulateShape(inner.map((p) => new THREE.Vector2(p[0], p[1])), []);
      for (const [a, bb, cc] of tris) roofTri([...inner[a]!, ridge], [...inner[bb]!, ridge], [...inner[cc]!, ridge]);
    } else {
      const all = rs.flat();
      const tris = THREE.ShapeUtils.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), rs.slice(1).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
      for (const [a, bb, cc] of tris) roofTri([...all[a]!, top], [...all[bb]!, top], [...all[cc]!, top]);
    }
  }
  const g = new THREE.Group();
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
  wg.computeVertexNormals();
  g.add(new THREE.Mesh(wg, wallMat));
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
  rg.setAttribute("uv", new THREE.Float32BufferAttribute(ruv, 2));
  rg.computeVertexNormals();
  g.add(new THREE.Mesh(rg, roofMat));
  return g;
}

/** ECEF (Google 3D Tiles) → this view's local frame (x east, y up, z south) at lat/lng/ellipsoid height. */
function ecefToLocal(latDeg: number, lngDeg: number, h: number): THREE.Matrix4 {
  const a = 6378137, e2 = 6.69437999014e-3;
  const φ = (latDeg * Math.PI) / 180, λ = (lngDeg * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const O = new THREE.Vector3((N + h) * Math.cos(φ) * Math.cos(λ), (N + h) * Math.cos(φ) * Math.sin(λ), (N * (1 - e2) + h) * Math.sin(φ));
  const e = new THREE.Vector3(-Math.sin(λ), Math.cos(λ), 0);
  const n = new THREE.Vector3(-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ));
  const u = new THREE.Vector3(Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ));
  const m = new THREE.Matrix4().set(e.x, e.y, e.z, -e.dot(O), u.x, u.y, u.z, -u.dot(O), -n.x, -n.y, -n.z, n.dot(O), 0, 0, 0, 1);
  return m;
}

type Mode = "ground" | "buildings" | "surface" | "google";
interface TilesLike {
  group: THREE.Group;
  update(): void;
  dispose(): void;
  getAttributions?(): { type: string; value: unknown }[];
  setCamera(c: THREE.Camera): void;
  setResolutionFromRenderer(c: THREE.Camera, r: THREE.WebGLRenderer): void;
  registerPlugin(p: unknown): void;
  addEventListener(type: string, cb: (e: { error?: unknown; url?: string | URL; tile?: unknown }) => void): void;
}

export function Terrain3D({ country, parcel, onClose }: { country: string; parcel: Parcel; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const host = useRef<HTMLDivElement | null>(null);
  const [model, setModel] = useState<Model>();
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<Mode>("buildings");
  const surfaceOn = mode === "surface";
  const [gKey, setGKey] = useState<string>();
  const [gNote, setGNote] = useState<string>();
  const [gCredits, setGCredits] = useState<string>("");
  const buildings = useRef<THREE.Group | null>(null);
  const mats = useRef<{ wall: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial } | null>(null);
  const tilesRef = useRef<TilesLike | null>(null);
  const [ex, setEx] = useState(1.5);
  const [north, setNorth] = useState(0);
  const [busy, setBusy] = useState<string>();
  const view = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; reset(): void } | null>(null);
  const terrainMesh = useRef<THREE.Mesh | null>(null);
  const skirtMesh = useRef<THREE.Mesh | null>(null);
  const outline = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.terrain(country, parcel.nationalRef, 100, ac.signal).then((r) => { setModel(toModel(r)); if (!r.buildings?.length) setMode(r.surface ? "surface" : "ground"); }).catch((e) => !ac.signal.aborted && setError(e instanceof ApiError ? e.code : "generic"));
    return () => ac.abort();
  }, [country, parcel.nationalRef]);

  useEffect(() => {
    api.googleTiles(i18n.language).then((g) => setGKey(g.key)).catch(() => undefined);
  }, [i18n.language]);

  const figures = useMemo(() => (model ? stats(model, parcel) : undefined), [model, parcel]);

  // scene: built once the model is here
  useEffect(() => {
    const el = host.current;
    if (!model || !el) return;
    const { cols, rows, cellM } = model.t;
    const w = (cols - 1) * cellM[0], d = (rows - 1) * cellM[1];
    const size = Math.max(w, d);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("data-testid", "terrain-canvas");
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#DCE6EC");
    scene.fog = new THREE.Fog("#DCE6EC", size * 2.2, size * 5);
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.5, size * 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = size * 0.15;
    controls.maxDistance = size * 5;
    const reset = () => {
      // portrait screens (phones) need to stand further back to see the whole block
      const k = Math.max(1, 1.15 / camera.aspect);
      camera.position.set(-size * 0.55 * k, size * 0.6 * k, size * 0.85 * k);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    reset();
    scene.add(new THREE.HemisphereLight("#ffffff", "#8a7a66", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-size, size * 1.2, -size * 0.4); // from the south-west, as in the afternoon
    scene.add(sun);

    // terrain mesh: one vertex per cell, x east, z south, y up
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        pos[i * 3] = c * cellM[0] - w / 2;
        pos[i * 3 + 2] = r * cellM[1] - d / 2;
        uv[i * 2] = c / (cols - 1);
        uv[i * 2 + 1] = 1 - r / (rows - 1);
      }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, e = a + cols, f = e + 1;
        idx.push(a, e, b, b, e, f);
      }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: "#C9C1A8", roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    terrainMesh.current = mesh;

    // orthophoto 2019 for exactly the grid's extent (cell centres)
    const west = model.t.x0, east = model.t.x0 + (cols - 1) * model.t.dx, north_ = model.t.y0, south = model.t.y0 - (rows - 1) * model.t.dy;
    const [mx0, my0] = webMercator(west, south), [mx1, my1] = webMercator(east, north_);
    const iw = Math.min(2048, Math.round(cols * 4)), ih = Math.round((iw * d) / w);
    new THREE.TextureLoader().setCrossOrigin("anonymous").load(
      `${ORTHO_2019}/export?bbox=${mx0},${my0},${mx1},${my1}&bboxSR=3857&imageSR=3857&size=${iw},${ih}&format=jpg&f=image`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        mat.map = tex;
        mat.color.set("#ffffff");
        mat.needsUpdate = true;
        if (mats.current) {
          mats.current.roof.map = tex;
          mats.current.roof.color.set("#ffffff");
          mats.current.roof.needsUpdate = true;
        }
      },
    );

    // sides of the block, down to below the lowest point
    const skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: "#8B6B4A", roughness: 1, side: THREE.DoubleSide }));
    scene.add(skirt);
    skirtMesh.current = skirt;

    const group = new THREE.Group();
    scene.add(group);
    outline.current = group;
    mats.current = {
      wall: new THREE.MeshStandardMaterial({ color: "#EFE9DD", roughness: 0.9, side: THREE.DoubleSide }),
      roof: new THREE.MeshStandardMaterial({ color: "#B9AFA0", roughness: 1, side: THREE.DoubleSide }),
    };
    const bg = new THREE.Group();
    scene.add(bg);
    buildings.current = bg;

    let raf = 0;
    let credits = 0;
    const loop = () => {
      controls.update();
      const tiles = tilesRef.current;
      if (tiles) {
        camera.updateMatrixWorld();
        tiles.update();
        if (++credits % 60 === 0) setGCredits((tiles.getAttributions?.() ?? []).filter((x) => x.type === "string").map((x) => String(x.value)).join(" · "));
      }
      setNorth(controls.getAzimuthalAngle());
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    view.current = { renderer, scene, camera, controls, reset };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((x: THREE.Material & { map?: THREE.Texture | null }) => { x.map?.dispose(); x.dispose(); });
        }
      });
      renderer.domElement.remove();
      view.current = null;
    };
  }, [model]);

  // heights: ground or surface, with vertical exaggeration
  useEffect(() => {
    const mesh = terrainMesh.current, skirt = skirtMesh.current, group = outline.current;
    if (!model || !mesh || !skirt || !group) return;
    const { cols, rows, cellM } = model.t;
    const w = (cols - 1) * cellM[0], d = (rows - 1) * cellM[1];
    const surf = surfaceOn ? model.surface : undefined;
    const base = figures?.aMin ?? model.t.baseM;
    const google = mode === "google";
    const exv = google ? 1 : ex; // Google's model is true to scale
    mesh.visible = !google;
    skirt.visible = !google;
    // the exaggeration applies to the lie of the land only: buildings and trees keep their real height
    const yOf = (g: number, sv?: number) => (g - base) * exv + (sv !== undefined ? Math.max(0, sv - g) : 0);
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < cols * rows; i++) pos.setY(i, yOf(model.ground[i]!, surf?.[i]));
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();

    // skirt: the four edges down to the floor
    const floor = -Math.max(3, (figures ? figures.aMax - figures.aMin : 10) * exv * 0.12);
    const edge: number[] = [];
    for (let c = 0; c < cols; c++) edge.push(c);
    for (let r = 1; r < rows; r++) edge.push(r * cols + cols - 1);
    for (let c = cols - 2; c >= 0; c--) edge.push((rows - 1) * cols + c);
    for (let r = rows - 2; r >= 0; r--) edge.push(r * cols);
    const sp: number[] = [], si: number[] = [];
    edge.forEach((i, k) => {
      const x = pos.getX(i), z = pos.getZ(i);
      sp.push(x, pos.getY(i), z, x, floor, z);
      if (k < edge.length - 1) si.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3);
    });
    skirt.geometry.dispose();
    skirt.geometry = new THREE.BufferGeometry();
    skirt.geometry.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    skirt.geometry.setIndex(si);
    skirt.geometry.computeVertexNormals();

    // plot boundary: a tube on the surface and a see-through fence above it
    group.children.forEach((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    group.clear();
    const local = (lngV: number, latV: number, lift: number) =>
      new THREE.Vector3((lngV - model.cx) * model.mLng, yOf(heightAt(model, model.ground, lngV, latV), surf ? heightAt(model, surf, lngV, latV) : undefined) + lift, -(latV - model.cy) * model.mLat);
    for (const ring of rings(parcel.geometry)) {
      const pts: THREE.Vector3[] = [], top: THREE.Vector3[] = [];
      for (let k = 0; k < ring.length - 1; k++) {
        const [a0, a1] = ring[k]!, [b0, b1] = ring[k + 1]!;
        const lenM = Math.hypot((b0! - a0!) * model.mLng, (b1! - a1!) * model.mLat);
        const n = Math.max(1, Math.ceil(lenM / 0.6));
        for (let j = 0; j < n; j++) {
          const f = j / n, lo = a0! + (b0! - a0!) * f, la = a1! + (b1! - a1!) * f;
          pts.push(local(lo, la, 0.35));
          top.push(local(lo, la, 4));
        }
      }
      pts.push(pts[0]!.clone());
      top.push(top[0]!.clone());
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0), pts.length * 2, Math.max(0.25, Math.min(w, d) / 400), 6, false),
        // drawn over everything, so the plot is never lost behind a building
        new THREE.MeshBasicMaterial({ color: PLOT_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
      );
      tube.renderOrder = 10;
      group.add(tube);
      const fp: number[] = [], fi: number[] = [];
      pts.forEach((p, k) => {
        fp.push(p.x, p.y, p.z, top[k]!.x, top[k]!.y, top[k]!.z);
        if (k < pts.length - 1) fi.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3);
      });
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
      fg.setIndex(fi);
      group.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: PLOT_COLOR, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));
    }
    // clean buildings
    const bg = buildings.current;
    if (bg && mats.current) {
      bg.children.forEach((o) => o.children.forEach((x) => { if (x instanceof THREE.Mesh) x.geometry.dispose(); }));
      bg.clear();
      if (mode === "buildings" && model.t.buildings?.length) bg.add(buildingsGroup(model, model.t.buildings, (g) => (g - base) * exv, mats.current.wall, mats.current.roof));
    }
  }, [model, surfaceOn, mode, ex, figures, parcel]);

  // Google Photorealistic 3D Tiles (Map Tiles API), placed in this view's frame and levelled on our terrain model
  useEffect(() => {
    const v = view.current;
    if (mode !== "google" || !gKey || !v || !model || !figures) return;
    let alive = true;
    let tiles: TilesLike | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let failed = false;
    setGNote(t("t3d.googleLoading"));
    (async () => {
      const [{ TilesRenderer }, plugins, { DRACOLoader }] = await Promise.all([
        import("3d-tiles-renderer"),
        import("3d-tiles-renderer/plugins"),
        import("three/examples/jsm/loaders/DRACOLoader.js"),
      ]);
      if (!alive) return;
      const tr = new TilesRenderer() as unknown as TilesLike;
      tr.registerPlugin(new plugins.GoogleCloudAuthPlugin({ apiToken: gKey, autoRefreshToken: true }));
      tr.registerPlugin(new plugins.GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath(DRACO) }));
      tr.registerPlugin(new plugins.TileCompressionPlugin());
      tr.registerPlugin(new plugins.TilesFadePlugin());
      // the root tileset failing (bad key, API not enabled, quota) is reported as an event
      tr.addEventListener("load-error", (e) => {
        if (!alive) return;
        if (!e.tile || /root\.json/.test(String(e.url ?? ""))) {
          failed = true;
          setGNote(t("t3d.googleError"));
          if (timer) clearInterval(timer);
        }
      });
      tr.setCamera(v.camera);
      tr.setResolutionFromRenderer(v.camera, v.renderer);
      const base = figures.aMin;
      const frame = ecefToLocal(model.cy, model.cx, base + GEOID_N);
      tr.group.matrixAutoUpdate = false;
      tr.group.matrix.copy(frame);
      tr.group.matrixWorldNeedsUpdate = true;
      v.scene.add(tr.group);
      tiles = tr;
      tilesRef.current = tr;
      // level Google's model on ours: cast rays at bare-ground cells, shift by the median difference
      const ray = new THREE.Raycaster();
      const { cols, rows, x0, y0, dx, dy } = model.t;
      const bare: [number, number, number][] = [];
      for (let k = 0; k < 400 && bare.length < 25; k++) {
        const c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows), i = r * cols + c;
        if (model.surface && model.surface[i]! - model.ground[i]! > 0.4) continue;
        const lng0 = x0 + c * dx, lat0 = y0 - r * dy;
        bare.push([(lng0 - model.cx) * model.mLng, model.ground[i]! - base, -(lat0 - model.cy) * model.mLat]);
      }
      let tries = 0;
      if (failed) return;
      timer = setInterval(() => {
        if (!alive || !tiles || failed) return;
        tries++;
        tiles.group.updateMatrixWorld(true);
        const diffs: number[] = [];
        for (const [x, y, z] of bare) {
          ray.set(new THREE.Vector3(x, y + 500, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(tiles.group, true)[0];
          if (hit) diffs.push(hit.point.y - y);
        }
        if (diffs.length >= 5) {
          diffs.sort((a, b) => a - b);
          const off = diffs[Math.floor(diffs.length / 2)]!;
          if (Math.abs(off) > 0.05) {
            tiles.group.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, -off, 0));
            tiles.group.matrixWorldNeedsUpdate = true;
          }
          setGNote(undefined);
          if (Math.abs(off) < 0.3) clearInterval(timer);
        } else if (tries > 20) {
          setGNote(t("t3d.googleNone"));
          clearInterval(timer);
        }
      }, 1000);
    })().catch(() => alive && setGNote(t("t3d.googleError")));
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      if (tiles) {
        v.scene.remove(tiles.group);
        tiles.dispose();
      }
      tilesRef.current = null;
      setGNote(undefined);
      setGCredits("");
    };
  }, [mode, gKey, model, figures, t]);

  const name = `plotcheck-3d-${parcel.nationalRef.replace(/[^\w-]+/g, "_")}`;
  const savePng = () => {
    const v = view.current;
    if (!v || !model || !figures) return;
    v.renderer.render(v.scene, v.camera);
    const src = v.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext("2d")!;
    g.drawImage(src, 0, 0);
    const s = src.width / 1000;
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(16 * s, 16 * s, 560 * s, 118 * s);
    g.fillStyle = "#1C2321";
    g.font = `700 ${26 * s}px system-ui, sans-serif`;
    g.fillText(t("plot.title", { label: parcel.label ?? "" }) + `  ·  ${parcel.nationalRef}`, 30 * s, 52 * s);
    g.font = `${19 * s}px system-ui, sans-serif`;
    g.fillText(t("t3d.groundOnPlot", { min: fmtNumber(figures.pMin, lng, 1), max: fmtNumber(figures.pMax, lng, 1) }), 30 * s, 84 * s);
    g.fillText(`${t(`t3d.mode.${mode}`)} · ${t("t3d.around", { m: model.t.bufferM })}${mode === "google" ? "" : ` · ${t("t3d.exaggeration")} ${ex}×`}`, 30 * s, 112 * s);
    g.font = `${15 * s}px system-ui, sans-serif`;
    g.fillStyle = "rgba(255,255,255,0.85)";
    const credit = mode === "google" ? `Google · ${gCredits}` : t("t3d.credit");
    g.fillRect(16 * s, out.height - 40 * s, g.measureText(credit).width + 24 * s, 28 * s);
    g.fillStyle = "#1C2321";
    g.fillText(credit, 28 * s, out.height - 21 * s);
    out.toBlob(async (b) => b && download(`${name}.png`, "image/png", new Uint8Array(await b.arrayBuffer())), "image/png");
  };
  const saveGlb = () => {
    const v = view.current;
    if (!v) return;
    setBusy("glb");
    const root = new THREE.Group();
    v.scene.children.forEach((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.Group) root.add(o.clone()); });
    new GLTFExporter().parse(
      root,
      (res) => { download(`${name}.glb`, "model/gltf-binary", new Uint8Array(res as ArrayBuffer)); setBusy(undefined); },
      () => setBusy(undefined),
      { binary: true },
    );
  };

  const chip = (on: boolean) => ({ paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.allowedBg : "rgba(255,255,255,0.95)" });
  const chipText = (on: boolean) => ({ fontSize: 13, fontWeight: "700" as const, color: on ? colors.accent : colors.ink });

  return toRoot(
    <View testID="terrain3d" style={{ position: "fixed" as "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 2000, backgroundColor: "#DCE6EC" }}>
      <div ref={host} style={{ position: "absolute", inset: 0, touchAction: "none" }} />
      {!model && (
        <View style={{ position: "absolute", left: 0, right: 0, top: "45%", alignItems: "center" }}>
          <Text testID="terrain3d-status" style={{ fontSize: 16, color: colors.ink, backgroundColor: "rgba(255,255,255,0.9)", padding: 12, borderRadius: 10 }}>
            {error ? t(`error.${error}`, { defaultValue: t("t3d.error") }) : t("t3d.loading")}
          </Text>
        </View>
      )}
      {/* top bar */}
      <View pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 10, top: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 12, padding: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.ink }}>{t("t3d.title", { label: parcel.label ?? "" })}</Text>
          {model && figures && (
            <>
              <Text testID="t3d-plot-heights" style={{ fontSize: 13, color: colors.ink }}>{t("t3d.groundOnPlot", { min: fmtNumber(figures.pMin, lng, 1), max: fmtNumber(figures.pMax, lng, 1) })} · {t("t3d.fall", { m: fmtNumber(figures.pMax - figures.pMin, lng, 1) })}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{t("t3d.area", { m: model.t.bufferM, min: fmtNumber(figures.aMin, lng, 1), max: fmtNumber(figures.aMax, lng, 1) })}{figures.tall > 2.5 ? ` · ${t("t3d.tallest", { m: fmtNumber(figures.tall, lng, 1) })}` : ""}</Text>
              {figures.bCount > 0 && (
                <Text testID="t3d-buildings-on-plot" style={{ fontSize: 12, color: colors.muted }}>
                  {t("t3d.onPlot", { count: figures.bCount, m: fmtNumber(figures.bRoof, lng, 1) })}{figures.bFloors ? ` · ${t("t3d.floors", { n: figures.bFloors })}` : ""}
                </Text>
              )}
            </>
          )}
        </View>
        <Pressable testID="t3d-close" accessibilityLabel={t("map.close")} onPress={onClose}
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 22, color: colors.ink }}>✕</Text>
        </Pressable>
      </View>
      {/* north arrow */}
      {model && (
        <View pointerEvents="none" style={{ position: "absolute", right: 14, top: 72, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: "#C0392B", transform: [{ rotate: `${(north * 180) / Math.PI}deg` }] }}>▲N</Text>
        </View>
      )}
      {/* controls */}
      {model && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 10, bottom: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {([
              ["ground", "⛰", true],
              ["buildings", "🏠", !!model.t.buildings?.length],
              ["surface", "🌳", !!model.surface],
              ["google", "🌐", !!gKey],
            ] as const).filter((x) => x[2]).map(([id, icon]) => (
              <Pressable key={id} testID={`t3d-${id}`} onPress={() => setMode(id)} style={chip(mode === id)}><Text style={chipText(mode === id)}>{icon} {t(`t3d.mode.${id}`)}</Text></Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {mode !== "google" && [1, 1.5, 2, 3].map((x) => (
              <Pressable key={x} testID={`t3d-ex-${x}`} onPress={() => setEx(x)} style={chip(ex === x)}><Text style={chipText(ex === x)}>↕ {x}×</Text></Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Pressable testID="t3d-reset" onPress={() => view.current?.reset()} style={chip(false)}><Text style={chipText(false)}>⟲ {t("t3d.reset")}</Text></Pressable>
            <Pressable testID="t3d-png" onPress={savePng} style={chip(false)}><Text style={chipText(false)}>🖼 {t("t3d.png")}</Text></Pressable>
            <Pressable testID="t3d-streetview" onPress={() => { const r = rings(parcel.geometry)[0]!.slice(0, -1); window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${(r.reduce((a, p) => a + p[1]!, 0) / r.length).toFixed(6)},${(r.reduce((a, p) => a + p[0]!, 0) / r.length).toFixed(6)}`, "_blank"); }} style={chip(false)}><Text style={chipText(false)}>🚶 {t("plot.streetView")}</Text></Pressable>
            <Pressable testID="t3d-glb" onPress={saveGlb} style={chip(false)}><Text style={chipText(false)}>{busy === "glb" ? "…" : "🧊"} {t("t3d.glb")}</Text></Pressable>
          </View>
          {gNote && <Text testID="t3d-google-note" style={{ fontSize: 13, color: colors.ink, backgroundColor: "rgba(255,255,255,0.92)", alignSelf: "flex-start", padding: 6, borderRadius: 6 }}>{gNote}</Text>}
          {mode === "google" ? (
            <Text testID="t3d-google-credits" style={{ fontSize: 11, color: colors.ink, backgroundColor: "rgba(255,255,255,0.85)", alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ fontWeight: "800" }}>Google</Text> · {gCredits || t("t3d.googleCredit")}
            </Text>
          ) : (
            <Text style={{ fontSize: 11, color: colors.ink, backgroundColor: "rgba(255,255,255,0.8)", alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              {t("t3d.hint")} · {model.t.source}{mode === "buildings" ? ` · ${t("t3d.buildingsSource")}` : ""} · {t("t3d.credit")}
            </Text>
          )}
        </View>
      )}
    </View>,
  );
}
