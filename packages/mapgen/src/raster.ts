/** Semantic classes and a rasterizer that burns vector features into class images. */
import type { Frame, Pt } from "./geo.ts";
import { decodeMvt, maybeGunzip, type MvtProps } from "./mvt.ts";

// --- semantic classes of the intermediate "abstract map image" -------------
export const NONE = 0,
  GRASS = 1,
  FOREST = 2,
  PADDY = 3,
  FIELD = 4,
  WATER = 5,
  ROAD = 6,
  RAIL = 7,
  PARK = 8,
  PARKING = 9,
  LOT_RES = 10,
  LOT_COM = 11,
  LOT_IND = 12,
  LOT_PUB = 13,
  BARE = 14,
  BLDG = 15,
  PAVED = 16;

export const CLASS_COLORS: [number, number, number][] = [
  [236, 236, 226],
  [170, 208, 140],
  [74, 132, 76],
  [160, 214, 190],
  [214, 196, 140],
  [96, 160, 230],
  [255, 255, 255],
  [90, 90, 100],
  [130, 200, 110],
  [200, 200, 205],
  [246, 222, 200],
  [248, 196, 196],
  [206, 196, 226],
  [200, 222, 246],
  [222, 212, 190],
  [150, 120, 110],
  [226, 226, 220],
];
export const N_CLASSES = CLASS_COLORS.length;
export const LOT_CLASSES = [LOT_RES, LOT_COM, LOT_IND, LOT_PUB];

export type LayerName = "cls" | "land" | "water" | "road_cl" | "rail_cl";
export type Transform = (pts: Pt[]) => Pt[];

// ---------------------------------------------------------------- primitives
function setPx(buf: Uint8Array, w: number, h: number, x: number, y: number, v: number) {
  if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = v;
}

/** 1px Bresenham line. */
function line1(buf: Uint8Array, w: number, h: number, a: Pt, b: Pt, v: number) {
  let x0 = Math.round(a[0]), y0 = Math.round(a[1]);
  const x1 = Math.round(b[0]), y1 = Math.round(b[1]);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // clip trivially-out-of-range lines so a stray coordinate cannot spin for millions of steps
  if (Math.max(dx, -dy) > 1e5) return;
  for (;;) {
    setPx(buf, w, h, x0, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) err += dy, x0 += sx;
    if (e2 <= dx) err += dx, y0 += sy;
  }
}

/** Even-odd scanline fill; pixel centres inside the polygon are set, edges are drawn too. */
export function fillPolygon(buf: Uint8Array, w: number, h: number, pts: Pt[], v: number) {
  const n = pts.length;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const ya = Math.max(0, Math.ceil(minY - 0.5)), yb = Math.min(h - 1, Math.floor(maxY - 0.5));
  const xs: number[] = [];
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p = pts[j], q = pts[i];
      if ((p[1] <= yc) !== (q[1] <= yc)) xs.push(p[0] + ((yc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      if (xb >= xa) buf.fill(v, y * w + xa, y * w + xb + 1); // (a negative `end` would count from the array's tail)
    }
  }
  for (let i = 0; i < n; i++) line1(buf, w, h, pts[i], pts[(i + 1) % n], v);
}

function fillDisc(buf: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, v: number) {
  const ya = Math.max(0, Math.ceil(cy - r)), yb = Math.min(h - 1, Math.floor(cy + r));
  for (let y = ya; y <= yb; y++) {
    const dx = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
    const xa = Math.max(0, Math.ceil(cx - dx)), xb = Math.min(w - 1, Math.floor(cx + dx));
    if (xb >= xa) buf.fill(v, y * w + xa, y * w + xb + 1);
  }
}

/** A thick segment as a quad. */
function fillSegment(buf: Uint8Array, w: number, h: number, a: Pt, b: Pt, width: number, v: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len === 0) return;
  const nx = (-dy / len) * width / 2, ny = (dx / len) * width / 2;
  fillPolygon(buf, w, h, [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], v);
}

// ---------------------------------------------------------------- rasterizer
/**
 * Draws features onto several aligned layers.
 *
 * - cls: the semantic map (later draws win)
 * - land: lot type from land use, kept separately so buildings can be typed
 * - water: every water polygon, even if something was drawn over it (bridges)
 * - road_cl / rail_cl: thin centerlines (guarantee connectivity after downsampling)
 */
export class Rasterizer {
  readonly W: number;
  readonly H: number;
  readonly layers: Record<LayerName, Uint8Array>;
  /** maps source px -> this frame's px (schematic warp) */
  transform: Transform | null;

  constructor(readonly frame: Frame, transform: Transform | null = null) {
    this.transform = transform;
    this.W = frame.W;
    this.H = frame.H;
    const mk = () => new Uint8Array(this.W * this.H);
    this.layers = { cls: mk(), land: mk(), water: mk(), road_cl: mk(), rail_cl: mk() };
  }

  private tf(pts: Pt[], raw: boolean): Pt[] {
    return raw || !this.transform ? pts : this.transform(pts);
  }

  /** rings: first is the exterior. Holes are left to later draws. */
  polygon(rings: Pt[][], value: number, layer: LayerName = "cls", raw = false) {
    const ext = this.tf(rings[0], raw);
    if (ext.length >= 3) fillPolygon(this.layers[layer], this.W, this.H, ext, value);
  }

  line(pts: Pt[], widthPx: number, value: number, layer: LayerName = "cls", raw = false) {
    if (pts.length < 2) return;
    pts = this.tf(pts, raw);
    const w = Math.max(1, Math.round(widthPx));
    const buf = this.layers[layer];
    if (w === 1) {
      for (let i = 0; i + 1 < pts.length; i++) line1(buf, this.W, this.H, pts[i], pts[i + 1], value);
      return;
    }
    for (let i = 0; i + 1 < pts.length; i++) fillSegment(buf, this.W, this.H, pts[i], pts[i + 1], w, value);
    if (w > 2) { // round joints / caps so segments join cleanly
      for (const p of pts) fillDisc(buf, this.W, this.H, p[0], p[1], w / 2, value);
    }
  }
}

// --------------------------------------------------------- vector tile helpers
export interface Feature {
  layer: string;
  props: MvtProps;
  kind: "polygon" | "line" | "point";
  /** polygon: list of polygons (each a list of rings); line: list of lines; point: [points] */
  parts: Pt[][][] | Pt[][];
}

/** Decode a tile and return features with coordinates in frame px. */
export async function mvtFeatures(
  data: Uint8Array | null,
  z: number,
  tx: number,
  ty: number,
  frame: Frame,
): Promise<Feature[]> {
  if (!data || !data.length) return [];
  const n = 2 ** z;
  const out: Feature[] = [];
  for (const layer of decodeMvt(await maybeGunzip(data))) {
    const ext = layer.extent;
    const conv = (c: [number, number][]): Pt[] => c.map(([x, y]) => frame.mercToPx((tx + x / ext) / n, (ty + y / ext) / n));
    for (const f of layer.features) {
      const g = f.geom;
      if (g.type === "point") {
        out.push({ layer: layer.name, props: f.props, kind: "point", parts: [conv(g.points)] });
      } else if (g.type === "line") {
        const lines = g.lines.map(conv).filter((l) => l.length);
        if (lines.length) out.push({ layer: layer.name, props: f.props, kind: "line", parts: lines });
      } else {
        const polys = g.polygons.map((p) => p.map(conv).filter((r) => r.length)).filter((p) => p.length);
        if (polys.length) out.push({ layer: layer.name, props: f.props, kind: "polygon", parts: polys });
      }
    }
  }
  return out;
}

export function ringArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + r.length - 1) % r.length];
    s += p[0] * q[1] - p[1] * q[0];
  }
  return Math.abs(s) / 2;
}
