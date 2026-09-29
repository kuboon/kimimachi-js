/** Abstraction: high-res semantic raster -> coarse grid of game terrain kinds. */
import { blockAny, blockMean, dilate, label, uniformFilter3 } from "./ndimage.ts";
import * as R from "./raster.ts";

// --- game terrain kinds ----------------------------------------------------
export const KINDS = [
  "grass",
  "forest",
  "paddy",
  "field",
  "water",
  "road",
  "bridge",
  "rail",
  "rail_bridge",
  "crossing",
  "park",
  "parking",
  "yard",
  "plaza",
  "bare",
  "house",
  "shop",
  "factory",
  "public",
  "road_diag",
  "rail_diag",
] as const;
export type Kind = typeof KINDS[number];
export const K = Object.fromEntries(KINDS.map((n, i) => [n, i])) as Record<Kind, number>;
export const BUILDING_KINDS = new Set([K.house, K.shop, K.factory, K.public]);
export const BLOCKING_KINDS = new Set([K.water, K.rail, K.rail_bridge, K.forest, K.rail_diag, ...BUILDING_KINDS]);
export const ROADLIKE = new Set([K.road, K.bridge, K.crossing, K.road_diag]);

/** land class -> ground kind when nothing structural sits on the cell */
const GROUND_OF_CLASS: Record<number, number> = {
  [R.NONE]: K.grass,
  [R.GRASS]: K.grass,
  [R.FOREST]: K.forest,
  [R.PADDY]: K.paddy,
  [R.FIELD]: K.field,
  [R.WATER]: K.water,
  [R.PARK]: K.park,
  [R.PARKING]: K.parking,
  [R.LOT_RES]: K.yard,
  [R.LOT_COM]: K.plaza,
  [R.LOT_IND]: K.plaza,
  [R.LOT_PUB]: K.plaza,
  [R.BARE]: K.bare,
  [R.ROAD]: K.road,
  [R.RAIL]: K.rail,
  [R.BLDG]: K.house,
  [R.PAVED]: K.plaza,
};
const BUILDING_OF_LOT: Record<number, number> = {
  [R.LOT_RES]: K.house,
  [R.LOT_COM]: K.shop,
  [R.LOT_IND]: K.factory,
  [R.LOT_PUB]: K.public,
};
const GROUND_CANDIDATES = Array.from({ length: R.N_CLASSES }, (_, c) => c).filter((c) => ![R.ROAD, R.RAIL, R.BLDG].includes(c));

/** A rows x cols grid of kind ids. */
export interface KindGrid {
  rows: number;
  cols: number;
  data: Int32Array;
}

export interface AbstractOptions {
  roadThresh?: number;
  bldgThresh?: number;
  railThresh?: number;
  waterThresh?: number;
}

/**
 * Downsample the rasterizer's layers into a (rows, cols) kind grid.
 *
 * Each cell covers k x k raster pixels. Thin features (roads, rails) use their
 * centerlines so they stay connected; area features use coverage fractions.
 */
export function abstract(rast: R.Rasterizer, k: number, opts: AbstractOptions = {}): KindGrid {
  const { roadThresh = 0.5, bldgThresh = 0.4, railThresh = 0.3, waterThresh = 0.5 } = opts;
  const rows = Math.floor(rast.H / k), cols = Math.floor(rast.W / k);
  const h = rows * k, w = cols * k;
  const crop = (src: Uint8Array): Uint8Array => {
    if (w === rast.W && h === rast.H) return src;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * rast.W, y * rast.W + w), y * w);
    return out;
  };
  const cls = crop(rast.layers.cls), land = crop(rast.layers.land);
  const n = rows * cols;
  const eq = (a: Uint8Array, c: number) => a.map((v) => (v === c ? 1 : 0));
  const frac: Float64Array[] = [];
  for (let c = 0; c < R.N_CLASSES; c++) frac.push(blockMean(eq(cls, c), w, h, k));
  const waterUnder = blockMean(crop(rast.layers.water), w, h, k);
  const roadCl = blockAny(crop(rast.layers.road_cl), w, h, k);
  const railCl = blockAny(crop(rast.layers.rail_cl), w, h, k);

  // 1. ground: majority of non-structural classes
  let kinds: Int32Array = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let best = GROUND_CANDIDATES[0], bv = -1;
    for (const c of GROUND_CANDIDATES) if (frac[c][i] > bv) bv = frac[c][i], best = c;
    kinds[i] = GROUND_OF_CLASS[best];
  }
  kinds = modeSmooth(kinds, rows, cols);

  // 2. buildings, typed by the surrounding land-use lots
  const isBldg = new Uint8Array(n);
  for (let i = 0; i < n; i++) isBldg[i] = frac[R.BLDG][i] >= bldgThresh ? 1 : 0;
  const lotFrac = R.LOT_CLASSES.map((c) => uniformFilter3(blockMean(eq(land, c), w, h, k), cols, rows));
  for (let i = 0; i < n; i++) {
    if (!isBldg[i]) continue;
    let best = 0, bv = -1;
    for (let j = 0; j < lotFrac.length; j++) if (lotFrac[j][i] > bv) bv = lotFrac[j][i], best = j;
    kinds[i] = bv === 0 ? K.house : BUILDING_OF_LOT[R.LOT_CLASSES[best]];
  }

  // 3. water / rail / road, in increasing priority
  const isWater = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (frac[R.WATER][i] >= waterThresh && !isBldg[i]) isWater[i] = 1, kinds[i] = K.water;
  let isRail: Uint8Array = new Uint8Array(n), isRoad: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    isRail[i] = frac[R.RAIL][i] >= railThresh || railCl[i] ? 1 : 0;
    isRoad[i] = frac[R.ROAD][i] >= roadThresh || roadCl[i] ? 1 : 0;
  }
  isRail = repairDiagonals(isRail, rows, cols, isBldg);
  isRoad = repairDiagonals(isRoad, rows, cols, or(isBldg, isRail));
  isRoad = dropSmall(isRoad, rows, cols, 3);
  for (let i = 0; i < n; i++) {
    if (isRail[i]) kinds[i] = K.rail;
    if (isRoad[i]) kinds[i] = K.road;
  }
  // Where a road runs *along* the railway (under a viaduct, beside the tracks) the rail wins;
  // only roads that cross it become level crossings.
  const both = and(isRoad, isRail);
  const rh = run(isRail, rows, cols, 1), rv = run(isRail, rows, cols, 0);
  const roadV = run(isRoad, rows, cols, 0), roadH = run(isRoad, rows, cols, 1);
  const crossing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!both[i]) continue;
    const railH = rh[i] >= rv[i];
    const perp = railH ? roadV[i] : roadH[i], along = railH ? roadH[i] : roadV[i];
    crossing[i] = perp > along ? 1 : 0;
    kinds[i] = crossing[i] ? K.crossing : K.rail;
    if (!crossing[i]) isRoad[i] = 0;
  }
  // bridges: road/rail over water, but only spans that actually touch open water
  // (streams culverted under a street would otherwise become long "bridges")
  const overWater = new Uint8Array(n);
  for (let i = 0; i < n; i++) overWater[i] = waterUnder[i] >= 0.4 && (isRoad[i] || isRail[i]) ? 1 : 0;
  const { lab, n: count } = label(overWater, cols, rows);
  if (count) {
    const nearWater = dilate(kinds.map((v) => (v === K.water ? 1 : 0)), cols, rows);
    const ok = new Uint8Array(count + 1);
    for (let i = 0; i < n; i++) if (lab[i] && nearWater[i]) ok[lab[i]] = 1;
    for (let i = 0; i < n; i++) {
      if (!ok[lab[i]]) continue;
      if (isRoad[i] && !isRail[i]) kinds[i] = K.bridge;
      else if (isRail[i] && !isRoad[i]) kinds[i] = K.rail_bridge;
    }
  }
  return { rows, cols, data: kinds };
}

const or = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => (v | b[i]));
const and = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => (v & b[i]));

/** Length of the straight run of set cells through each cell along axis (0 = vertical, 1 = horizontal), capped. */
export function run(mask: Uint8Array, rows: number, cols: number, axis: 0 | 1, cap = 8): Int32Array {
  const total = Int32Array.from(mask);
  const at = (y: number, x: number) => (y < 0 || x < 0 || y >= rows || x >= cols ? 0 : mask[y * cols + x]);
  for (const sign of [1, -1]) {
    const alive = Uint8Array.from(mask);
    for (let d = 1; d < cap; d++) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const s = axis === 0 ? at(y - sign * d, x) : at(y, x - sign * d);
          alive[i] &= s;
          total[i] += alive[i];
        }
      }
    }
  }
  return total;
}

/** Replace a cell by the kind held by >= minVotes of its 8 neighbours (removes speckle). */
function modeSmooth(kinds: Int32Array, rows: number, cols: number, minVotes = 5): Int32Array {
  const out = kinds.slice();
  const counts = new Int32Array(KINDS.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dy && !dx) continue;
          const yy = Math.min(Math.max(y + dy, 0), rows - 1), xx = Math.min(Math.max(x + dx, 0), cols - 1);
          counts[kinds[yy * cols + xx]]++;
        }
      }
      const cur = kinds[y * cols + x];
      for (let k = 0; k < counts.length; k++) if (counts[k] >= minVotes && k !== cur) out[y * cols + x] = k;
    }
  }
  return out;
}

/** Make diagonal-only links 4-connected so a walker can follow them. */
function repairDiagonals(mask: Uint8Array, rows: number, cols: number, avoid: Uint8Array): Uint8Array {
  const m = mask.slice();
  const g = (y: number, x: number) => mask[y * cols + x];
  const need1: [number, number][] = [], need2: [number, number][] = [];
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = g(y, x), b = g(y + 1, x + 1), c = g(y, x + 1), d = g(y + 1, x);
      if (a && b && !c && !d) need1.push([y, x]);
      if (c && d && !a && !b) need2.push([y, x]);
    }
  }
  for (const [need, [r1, c1], [r2, c2]] of [[need1, [0, 1], [1, 0]], [need2, [0, 0], [1, 1]]] as const) {
    for (const [y, x] of need) {
      // fill whichever of the two empty corners is not a building
      if (!avoid[(y + r1) * cols + x + c1]) m[(y + r1) * cols + x + c1] = 1;
      else m[(y + r2) * cols + x + c2] = 1;
    }
  }
  return m;
}

function dropSmall(mask: Uint8Array, rows: number, cols: number, minSize: number): Uint8Array {
  const { lab, n } = label(mask, cols, rows);
  if (!n) return mask;
  const sizes = new Int32Array(n + 1);
  for (const l of lab) sizes[l]++;
  return mask.map((_, i) => (lab[i] && sizes[lab[i]] >= minSize ? 1 : 0));
}

/** Label building footprints so each gets its own roof; long house rows are split into small houses. */
export function buildingGroups(kinds: KindGrid, houseBlock: [number, number] = [2, 3]): Int32Array {
  const { rows, cols, data } = kinds;
  const groups = new Int32Array(rows * cols);
  let nextId = 1;
  for (const kind of [...BUILDING_KINDS].sort((a, b) => a - b)) {
    const { lab, n } = label(data.map((v) => (v === kind ? 1 : 0)), cols, rows);
    if (!n) continue;
    if (kind === K.house) {
      const [bh, bw] = houseBlock;
      const keyOf = (i: number) => lab[i] * 1_000_000 + Math.floor(Math.floor(i / cols) / bh) * 1000 + Math.floor((i % cols) / bw);
      const keys = [...new Set(Array.from(lab, (l, i) => (l ? keyOf(i) : -1)).filter((k) => k >= 0))].sort((a, b) => a - b);
      const rank = new Map(keys.map((k, i) => [k, i + 1]));
      for (let i = 0; i < groups.length; i++) if (lab[i]) groups[i] = rank.get(keyOf(i))! + nextId - 1;
      nextId += keys.length + 1;
    } else {
      for (let i = 0; i < groups.length; i++) if (lab[i]) groups[i] = lab[i] + nextId;
      nextId += n + 1;
    }
  }
  return groups;
}
