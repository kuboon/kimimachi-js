/** 国土地理院 ベクトルタイル (experimental_bvmap): buildings, rails, roads, water, labels. Nationwide. */
import type { Frame, Pt } from "../geo.ts";
import { type Fetcher, fetchMany } from "../net.ts";
import { BLDG, type Feature, mvtFeatures, RAIL, type Rasterizer, ROAD, WATER } from "../raster.ts";

const URL_TEMPLATE = "https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf";
const Z = 16;
export const ATTRIBUTION = "国土地理院最適化ベクトルタイル";

/** road centerline width rank -> meters */
const RNK_WIDTH_M: Record<number, number> = { 0: 2.5, 1: 4.0, 2: 8.0, 3: 16.0, 4: 24.0 };
const SKIP_RAIL_STATES = new Set<string | number>(["トンネル", "地下", "建設中", "運休中", 2, 3]);

export type Road = [Pt[], number];

export async function load(fetcher: Fetcher, frame: Frame): Promise<Feature[]> {
  const tiles = frame.tiles(Z);
  const blobs = await fetchMany(
    fetcher,
    tiles.map(([z, x, y]) => URL_TEMPLATE.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))),
    8,
    true,
  );
  const feats: Feature[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const [z, x, y] = tiles[i];
    const tileFeats = await mvtFeatures(blobs[i], z, x, y, frame);
    // rails exist at two scales; prefer the detailed 1:2500 geometry when present
    const hasDetailRail = tileFeats.some((f) => f.layer === "railway" && f.props.orgGILvl === "2500");
    for (const f of tileFeats) {
      if (f.layer === "railway" && hasDetailRail && f.props.orgGILvl !== "2500") continue;
      feats.push(f);
    }
  }
  return feats;
}

export function drawWater(rast: Rasterizer, feats: Feature[]) {
  const mpp = rast.frame.mpp;
  for (const f of feats) {
    if (f.layer === "waterarea" && f.kind === "polygon") {
      for (const rings of f.parts as Pt[][][]) {
        rast.polygon(rings, WATER);
        rast.polygon(rings, 1, "water");
      }
    } else if (f.layer === "river" && f.kind === "line") {
      for (const line of f.parts as Pt[][]) {
        rast.line(line, 3.0 / mpp, WATER);
        rast.line(line, 3.0 / mpp, 1, "water");
      }
    }
  }
}

/** Road centerlines with their width in meters. */
export function roadLines(feats: Feature[]): Road[] {
  const out: Road[] = [];
  for (const f of feats) {
    // 2701 ordinary centerline, 2703 bridges/elevated sections, 2711 other; skip expressways (motorway=1)
    if (f.layer === "road" && f.kind === "line" && [2701, 2703, 2711].includes(f.props.ftCode as number) && f.props.motorway !== 1) {
      const w = RNK_WIDTH_M[f.props.rnkWidth as number] ?? 3.0;
      for (const line of f.parts as Pt[][]) out.push([line, w]);
    }
  }
  return out;
}

export function railLines(feats: Feature[]): Pt[][] {
  const out: Pt[][] = [];
  for (const f of feats) {
    if (f.layer !== "railway" || f.kind !== "line") continue;
    // railState is text at 1:2500 and a code at 1:25000 (2 = tunnel, 3 = underground / subway)
    if (SKIP_RAIL_STATES.has(f.props.railState as string | number)) continue;
    out.push(...(f.parts as Pt[][]));
  }
  return out;
}

/** Always burns thin centerlines; with fillArea also paints the road surface. */
export function drawRoads(rast: Rasterizer, lines: Road[], fillArea: boolean, minWidthM = 0, raw = false) {
  const mpp = rast.frame.mpp;
  for (const [line, width] of lines) {
    rast.line(line, 1, 1, "road_cl", raw);
    if (fillArea) rast.line(line, Math.max(width, minWidthM) / mpp, ROAD, "cls", raw);
  }
}

export function drawRails(rast: Rasterizer, lines: Pt[][], minWidthM = 4.0, raw = false) {
  const mpp = rast.frame.mpp;
  for (const line of lines) {
    rast.line(line, Math.max(4.0, minWidthM) / mpp, RAIL, "cls", raw);
    rast.line(line, 1, 1, "rail_cl", raw);
  }
}

export function drawBuildings(rast: Rasterizer, feats: Feature[]) {
  for (const f of feats) {
    if (f.layer !== "building") continue;
    if (f.kind === "polygon") {
      for (const rings of f.parts as Pt[][][]) rast.polygon(rings, BLDG);
    } else if (f.kind === "line") { // outlines delivered as (closed) lines
      for (const line of f.parts as Pt[][]) {
        const a = line[0], b = line[line.length - 1];
        if (line.length >= 4 && Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) < 1.0) rast.polygon([line], BLDG);
      }
    }
  }
}

export interface Label {
  name: string;
  kind: string;
  code: number;
  px: Pt;
}

export function labels(feats: Feature[], frame: Frame, transform?: ((pts: Pt[]) => Pt[]) | null): Label[] {
  const out: Label[] = [];
  for (const f of feats) {
    if (f.layer !== "label" || f.kind !== "point" || !f.props.knj) continue;
    const name = String(f.props.knj);
    const pt = (f.parts as Pt[][])[0].slice(0, 1);
    const [x, y] = transform ? transform(pt)[0] : pt[0];
    if (x >= 0 && x < frame.W && y >= 0 && y < frame.H) {
      const ctg = Math.trunc(Number(f.props.annoCtg ?? 0));
      let kind =
        ({ 4: "station", 8: "facility", 6: "facility", 3: "nature", 2: "area" } as Record<number, string>)[Math.trunc(ctg / 100)] ??
          "other";
      if (ctg === 800) kind = "district";
      if (kind === "station" && !name.endsWith("駅")) kind = "route"; // line / expressway names share the transport category
      out.push({ name, kind, code: ctg, px: [x, y] });
    }
  }
  // the same label can appear in several tiles
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = `${l.name}|${Math.round(l.px[0] / 20)}|${Math.round(l.px[1] / 20)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
