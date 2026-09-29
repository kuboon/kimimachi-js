/** Orchestration: (lat, lon) -> pixel-art game map. */
import { abstract, BLOCKING_KINDS, buildingGroups, KINDS } from "./abstract.ts";
import * as diagonal from "./diagonal.ts";
import { type GameMap, KIND_COLORS, labelsToTiles, type MapMeta } from "./export.ts";
import { Frame, type Pt } from "./geo.ts";
import { defaultFetcher, type Fetcher } from "./net.ts";
import * as R from "./raster.ts";
import { type RailAxis, type RotateMode, Schematizer } from "./schematic.ts";
import * as gsi from "./sources/gsi.ts";
import * as plateau from "./sources/plateau.ts";
import { assignTiles, buildTileset, type Image, overlayTiles } from "./tileset.ts";

/** Raster pixels per game tile. */
export const SUBPX = 8;

export interface GenerateOptions {
  lat: number;
  lon: number;
  /** width of the area [m] (default 2000) */
  size?: number;
  /** height of the area [m] (default = size) */
  height?: number;
  /** distance one tile stands for [m] (default 8) */
  tileM?: number;
  /** "plateau": PLATEAU land use + roads (+ GSI buildings/rails), "gsi": GSI only */
  source?: "plateau" | "gsi";
  /** schematic: straightened "mental map" (default), real: real shapes */
  layout?: "schematic" | "real";
  rotate?: RotateMode;
  railAxis?: RailAxis;
  /** sideways shift allowed to straighten one segment [tiles] (default 3) */
  straighten?: number;
  /** use 45° diagonal pieces (default true) */
  diagonal?: boolean;
  seed?: number;
  /** map name; defaults to the address found by the GSI reverse geocoder */
  title?: string;
  fetch?: Fetcher;
  log?: (message: string) => void;
}

export interface GeneratedMap {
  map: GameMap;
  tileset: Image;
  /** the semantic class image (1px = tileM/8 m) */
  semantic: Image;
}

const clsImage = (cls: Uint8Array, w: number, h: number): Image => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < cls.length; i++) data.set([...R.CLASS_COLORS[cls[i]], 255], i * 4);
  return { width: w, height: h, data };
};

export async function generateMap(o: GenerateOptions): Promise<GeneratedMap> {
  const {
    lat,
    lon,
    size = 2000,
    tileM = 8,
    layout = "schematic",
    rotate = "auto",
    railAxis = "auto",
    straighten = 3.0,
    seed = 7,
    fetch: fetcher = defaultFetcher,
    log = () => {},
  } = o;
  const height = o.height ?? size;
  const useDiagonal = o.diagonal ?? true;
  const schematic = layout === "schematic";
  let source = o.source ?? "plateau";

  const frame = new Frame(lat, lon, size, height, tileM / SUBPX);
  log(
    `🗺  ${size.toFixed(0)}m x ${height.toFixed(0)}m, ${tileM}m/tile -> ${Math.floor(frame.W / SUBPX)} x ${
      Math.floor(frame.H / SUBPX)
    } tiles`,
  );
  // schematic mode reads a larger area so that rotation/warping never exposes empty corners
  const margin = schematic ? 1.5 : 1.0;
  const src = new Frame(lat, lon, size * margin + (schematic ? 300 : 0), height * margin + (schematic ? 300 : 0), frame.mpp);
  const rast = new R.Rasterizer(frame);
  const attributions: string[] = [];

  log("⬇  地理院ベクトルタイル (建物・鉄道・道路中心線・水域・注記)");
  const gfeats = await gsi.load(fetcher, src);
  const roads = gsi.roadLines(gfeats), rails = gsi.railLines(gfeats);

  let tf: Schematizer | null = null;
  const diagRoads: [Pt, Pt][] = [], diagRails: [Pt, Pt][] = [];
  const segRoads: gsi.Road[] = [], segRails: Pt[][] = [];
  if (schematic) {
    log("📐 模式化 (斜めの道が最も少ない角度に回転し、道路を水平/垂直/45°に整列)");
    tf = new Schematizer(src, frame, roads.map(([l]) => l), roads.map(([, w]) => w), rails, {
      tilePx: SUBPX,
      railAxis,
      straighten,
      rotate,
    });
    rast.transform = tf.transform;
    log(
      `   回転 ${
        (tf.phi * 180 / Math.PI).toFixed(1)
      }°, 道路 ${tf.roadSegments.length} 区間, 線路 ${tf.railSegments.length} 区間, 最大移動 ${(tf.maxDisp * frame.mpp).toFixed(0)}m`,
    );
    const isDiag = (a: Pt, b: Pt) => useDiagonal && diagonal.isDiagonal(a, b, SUBPX * 0.75);
    // 45° segments are placed later as diagonal tile pieces, the rest is rasterized
    for (const [pa, pb, w] of tf.roadSegments) {
      const [a, b] = tf.out([pa, pb]);
      if (isDiag(a, b)) diagRoads.push([a, b]);
      else segRoads.push([[a, b], w]);
    }
    for (const [pa, pb] of tf.railSegments) {
      const [a, b] = tf.out([pa, pb]);
      if (isDiag(a, b)) diagRails.push([a, b]);
      else segRails.push([a, b]);
    }
    log(`   45°斜めパーツ: 道路 ${diagRoads.length} 区間, 線路 ${diagRails.length} 区間`);
  }

  const drawNetwork = (fillMinW: number) => {
    if (schematic) {
      gsi.drawRoads(rast, segRoads, true, Math.max(fillMinW, tileM * 0.5), true);
      gsi.drawRails(rast, segRails, tileM * 0.6, true);
    } else {
      gsi.drawRails(rast, rails, tileM * 0.6);
    }
  };

  let city: string | null = null;
  if (source === "plateau") {
    const ds = await plateau.findDatasets(fetcher, src).catch((e) => {
      log(`⚠  PLATEAU に接続できません (${e instanceof Error ? e.message : e})`);
      return null;
    });
    if (!ds) {
      log("⚠  PLATEAU土地利用/道路データが使えないため gsi ソースで生成します");
      source = "gsi";
    } else {
      city = ds.city;
      log(`⬇  PLATEAU ${ds.city} ${ds.years}`);
      gsi.drawWater(rast, gfeats);
      if (!schematic) gsi.drawRoads(rast, roads, true); // outside PLATEAU coverage
      const nLuse = await plateau.drawLanduse(fetcher, rast, ds, src, !schematic);
      if (nLuse === 0) { // every land-use tile failed to load (e.g. blocked): don't claim PLATEAU as a source
        log("⚠  PLATEAU の土地利用タイルを取得できないため gsi ソースで生成します");
        source = "gsi";
        city = null;
      } else {
        const nTran = schematic ? 0 : await plateau.drawRoads(fetcher, rast, ds, src);
        log(`   土地利用 ${nLuse} 面, 道路 ${nTran} 面`);
        gsi.drawBuildings(rast, gfeats);
        drawNetwork(0);
        attributions.push(ds.attribution, gsi.ATTRIBUTION);
      }
    }
  }
  if (source === "gsi") {
    gsi.drawWater(rast, gfeats);
    gsi.drawBuildings(rast, gfeats);
    if (!schematic) gsi.drawRoads(rast, roads, true, tileM * 0.5);
    drawNetwork(tileM * 0.5);
    attributions.push(gsi.ATTRIBUTION);
  }

  const semantic = clsImage(rast.layers.cls, rast.W, rast.H);

  log("🧩 抽象化");
  const abs = abstract(rast, SUBPX);
  const d = diagonal.apply(abs, diagRoads, diagRails, SUBPX);
  const groups = buildingGroups(d.base);
  const tiles = assignTiles(d.base, groups, {
    seed,
    extraRoad: Uint8Array.from(d.fam, (f) => (f === 1 ? 1 : 0)),
    extraRail: Uint8Array.from(d.fam, (f) => (f === 2 ? 1 : 0)),
  });
  const overlay = overlayTiles(d.fam, d.col);
  const tileset = buildTileset(seed);

  const { rows, cols } = d.kinds;
  const labels = labelsToTiles(gsi.labels(gfeats, frame, tf?.transform), SUBPX, cols, rows);

  let title = o.title;
  if (!title) {
    title = (await plateau.reverseGeocode(fetcher, lat, lon).catch(() => ({}) as plateau.Address)).lv01Nm ||
      `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
  const meta: MapMeta = {
    place: title,
    source,
    city,
    center: [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6],
    bounds: frame.boundsLonlat(),
    tile_m: tileM,
    layout,
    attribution: attributions.join(" / "),
  };
  const map: GameMap = {
    meta,
    width: cols,
    height: rows,
    tileSize: 16,
    kinds: [...KINDS],
    blockingKinds: [...BLOCKING_KINDS].map((k) => KINDS[k]).sort(),
    kindGrid: Array.from(d.kinds.data),
    tileGrid: Array.from(tiles),
    overlayGrid: Array.from(overlay),
    labels,
  };

  const counts = new Array(KINDS.length).fill(0);
  for (const k of d.kinds.data) counts[k]++;
  log(
    "   " + counts.map((c, i) => [i, c] as const).filter(([, c]) => c).sort((a, b) => b[1] - a[1])
      .map(([i, c]) => `${KINDS[i]} ${Math.round(c / d.kinds.data.length * 100)}%`).join(", "),
  );
  return { map, tileset, semantic };
}

export { KIND_COLORS };
