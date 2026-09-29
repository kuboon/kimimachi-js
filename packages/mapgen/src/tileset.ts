/**
 * Procedurally painted 16x16 pixel-art tileset and autotile assignment.
 *
 * Layout: one row per tile family, 16 columns.
 *  - autotiled families: column = 4-bit mask of same-family neighbours (N=1, E=2, S=4, W=8)
 *  - textured families : column = random variant
 */
import { BUILDING_KINDS, K, type KindGrid, ROADLIKE, run } from "./abstract.ts";
import { Rng } from "./rng.ts";

export const T = 16;
const N = 1, E = 2, S = 4, W = 8;

export type RGB = readonly [number, number, number];

/** RGBA image, row-major. */
export interface Image {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

class Tile {
  a = new Uint8ClampedArray(T * T * 4);

  constructor(bg: RGB, alpha = 255) {
    for (let i = 0; i < T * T; i++) this.a.set([bg[0], bg[1], bg[2], alpha], i * 4);
  }

  px(x: number, y: number, c: RGB) {
    if (x >= 0 && x < T && y >= 0 && y < T) this.a.set([c[0], c[1], c[2], 255], (y * T + x) * 4);
  }

  /** inclusive-exclusive */
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    for (let y = Math.max(0, y0); y < Math.min(T, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(T, x1); x++) this.px(x, y, c);
    }
  }

  speckle(rng: Rng, colors: RGB[], n: number) {
    for (let i = 0; i < n; i++) {
      const x = rng.int(T), y = rng.int(T);
      this.px(x, y, colors[rng.int(colors.length)]);
    }
  }
}

const shade = (c: RGB, f: number): RGB => c.map((v) => Math.trunc(Math.max(0, Math.min(255, v * f)))) as unknown as RGB;

// ---------------------------------------------------------------- palettes
const GRASS: RGB = [104, 176, 72], GRASS_D: RGB = [84, 150, 60], GRASS_L: RGB = [136, 200, 96];
const WATER: RGB = [56, 120, 208], WATER_L: RGB = [104, 160, 232], WATER_D: RGB = [40, 96, 176];
const SHORE: RGB = [216, 232, 248];
const ASPHALT: RGB = [116, 116, 124], CURB: RGB = [196, 196, 188];
const RAILC: RGB = [210, 210, 220], SLEEPER: RGB = [112, 80, 56], GRAVEL: RGB = [146, 138, 128];
const WALL: RGB = [236, 228, 208], WINDOW: RGB = [112, 168, 216], OUTLINE: RGB = [52, 44, 48];

type Painter = (v: number, rng: Rng) => Tile;

// ---------------------------------------------------------------- painters
function pGrass(v: number, rng: Rng, base = GRASS, dark = GRASS_D, light = GRASS_L): Tile {
  const t = new Tile(base);
  t.speckle(rng, [dark, light], 14);
  if (v % 4 === 0) { // tuft
    const x = rng.int(2, 13), y = rng.int(3, 13);
    for (const [dx, dy] of [[0, 0], [1, -1], [2, 0]]) t.px(x + dx, y + dy, dark);
  }
  if (v === 5) t.px(rng.int(2, 13), rng.int(2, 13), [248, 240, 200]); // tiny flower
  return t;
}

function pForest(mask: number, rng: Rng): Tile {
  const t = pGrass(1, rng);
  const dark: RGB = [32, 88, 48], mid: RGB = [48, 116, 60], light: RGB = [84, 152, 76];
  // canopy fills the tile, pulled back where the forest ends
  const x0 = mask & W ? 0 : 2, x1 = mask & E ? 16 : 14;
  const y0 = mask & N ? 0 : 2, y1 = mask & S ? 16 : 13;
  t.rect(x0, y0, x1, y1, mid);
  for (let i = 0; i < 9; i++) { // leaf clumps
    const cx = rng.int(x0, x1), cy = rng.int(y0, y1);
    t.rect(cx - 1, cy - 1, cx + 2, cy + 1, light);
    t.px(cx, cy + 1, dark);
  }
  t.speckle(rng, [dark], 10);
  if (!(mask & S)) { // trunks / shadow at the forest edge
    t.rect(x0, y1, x1, y1 + 1, dark);
    for (let x = x0 + 2; x < x1 - 1; x += 5) t.rect(x, y1, x + 2, Math.min(16, y1 + 3), [96, 64, 40]);
  }
  if (!(mask & N)) t.rect(x0 + 1, y0, x1 - 1, y0 + 1, light);
  return t;
}

function pPaddy(v: number, rng: Rng): Tile {
  const t = new Tile([118, 178, 132]);
  t.speckle(rng, [[136, 196, 170], [100, 160, 150]], 10);
  for (let y = 2; y < 16; y += 4) {
    for (let x = 1 + (Math.floor(y / 4) % 2); x < 16; x += 3) {
      t.px(x, y, [60, 132, 60]);
      t.px(x, y - 1, [84, 156, 72]);
    }
  }
  if (v % 3 === 0) t.rect(0, 15, 16, 16, [150, 130, 90]); // levee
  return t;
}

function pField(v: number, rng: Rng): Tile {
  const t = new Tile([168, 120, 72]);
  for (let y = 1; y < 16; y += 3) t.rect(0, y, 16, y + 1, [136, 92, 56]);
  t.speckle(rng, [[188, 140, 90]], 8);
  if (v % 2) { for (let y = 0; y < 16; y += 3) for (let x = 1; x < 16; x += 3) t.px(x, y, [96, 164, 64]); }
  return t;
}

function pWater(mask: number, rng: Rng, base = WATER): Tile {
  const t = new Tile(base);
  for (let i = 0; i < 4; i++) {
    const x = rng.int(1, 12), y = rng.int(2, 14);
    t.rect(x, y, x + 3, y + 1, WATER_L);
  }
  t.speckle(rng, [WATER_D], 6);
  // shoreline where neighbours are dry
  if (!(mask & N)) t.rect(0, 0, 16, 2, SHORE), t.rect(0, 2, 16, 3, WATER_L);
  if (!(mask & S)) t.rect(0, 14, 16, 16, SHORE), t.rect(0, 13, 16, 14, WATER_D);
  if (!(mask & W)) t.rect(0, 0, 2, 16, SHORE), t.rect(2, 0, 3, 16, WATER_L);
  if (!(mask & E)) t.rect(14, 0, 16, 16, SHORE), t.rect(13, 0, 14, 16, WATER_D);
  return t;
}

function pRoad(mask: number, rng: Rng, base = ASPHALT): Tile {
  const t = new Tile(base);
  t.speckle(rng, [shade(base, 1.12), shade(base, 0.9)], 12);
  // curbs where the road ends
  const sides: [number, [number, number, number, number]][] = [
    [N, [0, 0, 16, 1]],
    [S, [0, 15, 16, 16]],
    [W, [0, 0, 1, 16]],
    [E, [15, 0, 16, 16]],
  ];
  for (const [bit, r] of sides) if (!(mask & bit)) t.rect(...r, CURB);
  // centre dashes on straight 2-way segments
  const dash: RGB = [232, 220, 150];
  if (mask === (E | W)) t.rect(3, 7, 7, 8, dash), t.rect(11, 7, 15, 8, dash);
  else if (mask === (N | S)) t.rect(7, 3, 8, 7, dash), t.rect(7, 11, 8, 15, dash);
  return t;
}

function pBridge(mask: number, rng: Rng): Tile {
  const t = pRoad(mask | N | S | E | W, rng, [150, 132, 112]);
  const rail: RGB = [84, 60, 44];
  const sides: [number, [number, number, number, number]][] = [
    [N, [0, 0, 16, 2]],
    [S, [0, 14, 16, 16]],
    [W, [0, 0, 2, 16]],
    [E, [14, 0, 16, 16]],
  ];
  for (const [bit, r] of sides) if (!(mask & bit)) t.rect(...r, rail);
  if (!(mask & N) || !(mask & S)) {
    for (let x = 1; x < 16; x += 4) {
      if (!(mask & N)) t.px(x, 2, OUTLINE);
      if (!(mask & S)) t.px(x, 13, OUTLINE);
    }
  }
  return t;
}

/** Draw rails from the tile centre towards each connected side. */
function tracks(t: Tile, mask: number) {
  if (mask === 0) mask = E | W;
  if (mask & (E | W)) {
    const xa = mask & W ? 0 : 5, xb = mask & E ? 16 : 11;
    for (let x = xa + 1; x < xb; x += 3) t.rect(x, 3, x + 2, 13, SLEEPER);
    t.rect(xa, 5, xb, 6, RAILC), t.rect(xa, 10, xb, 11, RAILC);
  }
  if (mask & (N | S)) {
    const ya = mask & N ? 0 : 5, yb = mask & S ? 16 : 11;
    for (let y = ya + 1; y < yb; y += 3) t.rect(3, y, 13, y + 2, SLEEPER);
    t.rect(5, ya, 6, yb, RAILC), t.rect(10, ya, 11, yb, RAILC);
  }
}

function pRail(mask: number, rng: Rng): Tile {
  const t = new Tile(GRAVEL);
  t.speckle(rng, [[170, 162, 150], [120, 112, 104]], 30);
  tracks(t, mask);
  return t;
}

function pRailBridge(mask: number, rng: Rng): Tile {
  const t = pWater(0b1111, rng);
  if (mask & (E | W) || mask === 0) t.rect(0, 3, 16, 13, [96, 84, 76]);
  if (mask & (N | S)) t.rect(3, 0, 13, 16, [96, 84, 76]);
  tracks(t, mask);
  return t;
}

function pCrossing(v: number, rng: Rng): Tile {
  const t = pRoad(N | S | E | W, rng);
  const stripe: RGB[] = [[240, 200, 40], [40, 40, 40]];
  if (v === 0) { // rails run east-west, road north-south
    for (let x = 0; x < 16; x++) t.px(x, 0, stripe[Math.floor(x / 2) % 2]), t.px(x, 15, stripe[Math.floor(x / 2) % 2]);
    t.rect(0, 5, 16, 6, RAILC), t.rect(0, 10, 16, 11, RAILC);
  } else {
    for (let y = 0; y < 16; y++) t.px(0, y, stripe[Math.floor(y / 2) % 2]), t.px(15, y, stripe[Math.floor(y / 2) % 2]);
    t.rect(5, 0, 6, 16, RAILC), t.rect(10, 0, 11, 16, RAILC);
  }
  return t;
}

function pPark(v: number, rng: Rng): Tile {
  const t = pGrass(v, rng, [120, 196, 96], [96, 170, 80], [152, 216, 120]);
  const flowers: RGB[] = [[248, 224, 80], [240, 128, 168], [255, 255, 255]];
  for (let i = 0; i < (v % 3 ? 2 : 0); i++) t.px(rng.int(1, 15), rng.int(1, 15), flowers[rng.int(3)]);
  if (v === 7) { // small tree
    t.rect(5, 3, 11, 9, [56, 128, 64]), t.rect(6, 4, 9, 6, [96, 168, 88]), t.rect(7, 9, 9, 12, [104, 72, 48]);
  }
  return t;
}

function pParking(v: number, rng: Rng): Tile {
  const t = new Tile([150, 150, 158]);
  t.speckle(rng, [[160, 160, 168], [138, 138, 146]], 10);
  t.rect(0, 0, 1, 7, [236, 236, 236]), t.rect(8, 0, 9, 7, [236, 236, 236]);
  if (v % 5 === 1) { // parked car
    const c: RGB = ([[200, 60, 60], [60, 100, 200], [230, 230, 230], [40, 40, 48]] as RGB[])[v % 4];
    t.rect(2, 1, 7, 9, c), t.rect(3, 3, 6, 5, [150, 200, 230]);
  }
  return t;
}

function pYard(v: number, rng: Rng): Tile {
  const t = pGrass(v, rng, [140, 196, 104], [116, 172, 88], [168, 212, 128]);
  if (v % 4 === 1) t.rect(0, 12, 16, 15, [64, 136, 72]), t.rect(0, 12, 16, 13, [96, 168, 88]); // hedge
  if (v % 4 === 2) { for (const x of [3, 8, 12]) t.rect(x, 7, x + 2, 9, [200, 196, 180]); // stepping stones
   }
  return t;
}

function pPlaza(_v: number, rng: Rng): Tile {
  const t = new Tile([212, 202, 184]);
  for (let i = 0; i < 16; i += 4) t.rect(0, i, 16, i + 1, [190, 180, 164]), t.rect(i, 0, i + 1, 16, [190, 180, 164]);
  t.speckle(rng, [[224, 216, 200]], 5);
  return t;
}

function pBare(_v: number, rng: Rng): Tile {
  const t = new Tile([196, 168, 120]);
  t.speckle(rng, [[176, 148, 104], [214, 190, 146], [150, 130, 100]], 22);
  return t;
}

function makeBuilding(roof: RGB, wall: RGB = WALL, style: "gable" | "flat" | "sawtooth" = "gable") {
  const roofD = shade(roof, 0.78), roofL = shade(roof, 1.18);
  return (mask: number, rng: Rng): Tile => {
    const t = new Tile(roof);
    const wallH = mask & S ? 0 : 6;
    const top = 16 - wallH;
    if (style === "gable") { // tiled roof rows
      for (let y = 2; y < top; y += 3) t.rect(0, y, 16, y + 1, roofD);
      if (!(mask & N)) t.rect(0, 0, 16, 1, roofL);
    } else if (style === "flat") { // concrete roof with parapet and AC units
      t.speckle(rng, [shade(roof, 0.94), shade(roof, 1.05)], 10);
      if (rng.random() < 0.35 && top > 8) {
        const x = rng.int(3, 10), y = rng.int(3, top - 5);
        t.rect(x, y, x + 4, y + 3, [168, 172, 180]), t.rect(x + 1, y + 1, x + 3, y + 2, [120, 124, 132]);
      }
      const edges: [number, [number, number, number, number]][] = [
        [N, [0, 0, 16, 2]],
        [W, [0, 0, 2, top]],
        [E, [14, 0, 16, top]],
      ];
      for (const [bit, r] of edges) if (!(mask & bit)) t.rect(...r, roofL);
    } else { // sawtooth: factory
      for (let x = 0; x < 16; x += 4) t.rect(x, 0, x + 1, top, roofD), t.rect(x + 1, 0, x + 2, top, roofL);
    }
    if (wallH) {
      t.rect(0, top, 16, 16, wall);
      t.rect(0, top, 16, top + 1, shade(roof, 0.55));
      t.rect(0, 15, 16, 16, shade(wall, 0.7));
      if (style === "sawtooth") {
        t.rect(3, top + 2, 13, 15, [150, 156, 164]);
        for (let y = top + 3; y < 15; y += 2) t.rect(3, y, 13, y + 1, [126, 132, 140]);
      } else if (rng.random() < 0.3) {
        t.rect(6, top + 2, 10, 15, [132, 92, 64]), t.px(9, top + 7, [232, 200, 96]);
      } else {
        t.rect(3, top + 2, 6, top + 4, WINDOW), t.rect(10, top + 2, 13, top + 4, WINDOW);
      }
    }
    if (!(mask & W)) t.rect(0, 0, 1, 16, OUTLINE);
    if (!(mask & E)) t.rect(15, 0, 16, 16, OUTLINE);
    if (!(mask & N)) t.rect(0, 0, 16, 1, OUTLINE);
    return t;
  };
}

/** Overlay piece of a 45° band (see diagonal.ts). col: 0-5 pieces, +6 = variant flag. */
function diagPiece(col: number, rng: Rng, paint: (d: number, a: number, variant: number, rng: Rng) => RGB | null): Tile {
  const t = new Tile([0, 0, 0], 0);
  if (col >= 12) return t;
  const piece = col % 6, variant = Math.floor(col / 6);
  const mirror = piece >= 3;
  const k = [0, 16, -16][piece % 3]; // d offset of centre / right(left) / below cell
  const along = [0, 16, 16][piece % 3];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const c = paint(x - y + k, x + y + along, variant, rng);
      if (c) t.px(mirror ? T - 1 - x : x, y, c);
    }
  }
  return t;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

function roadPx(d: number, a: number, noCurb: number, rng: Rng, w = 11): RGB | null {
  if (Math.abs(d) > w) return null;
  if (Math.abs(d) === w && !noCurb) return CURB;
  if (d === 0 && mod(Math.floor(a / 4), 2) === 0 && !noCurb) return [232, 220, 150];
  const r = rng.random();
  return r < 0.06 ? shade(ASPHALT, 1.12) : r < 0.12 ? shade(ASPHALT, 0.9) : ASPHALT;
}

function railPx(d: number, a: number, _v: number, rng: Rng, w = 9): RGB | null {
  if (Math.abs(d) > w) return null;
  if (Math.abs(d) === 4) return RAILC;
  if (Math.abs(d) <= 7 && mod(a, 5) === 0) return SLEEPER;
  const r = rng.random();
  return r < 0.15 ? [170, 162, 150] : r < 0.3 ? [120, 112, 104] : GRAVEL;
}

const HOUSE_ROOFS: RGB[] = [[192, 72, 64], [72, 104, 176], [80, 136, 96], [152, 100, 68]];

/** (family name, painter) — one row each */
export const ROWS: readonly (readonly [string, Painter])[] = [
  ["grass", (v, r) => pGrass(v, r)],
  ["forest", pForest],
  ["paddy", pPaddy],
  ["field", pField],
  ["water", (v, r) => pWater(v, r)],
  ["road", (v, r) => pRoad(v, r)],
  ["bridge", pBridge],
  ["rail", pRail],
  ["rail_bridge", pRailBridge],
  ["crossing", pCrossing],
  ["park", pPark],
  ["parking", pParking],
  ["yard", pYard],
  ["plaza", pPlaza],
  ["bare", pBare],
  ...HOUSE_ROOFS.map((c, i) => [`house${i}`, makeBuilding(c)] as const),
  ["shop0", makeBuilding([150, 164, 184], [212, 222, 236], "flat")],
  ["shop1", makeBuilding([184, 170, 160], [236, 226, 214], "flat")],
  ["factory", makeBuilding([128, 148, 168], [196, 200, 204], "sawtooth")],
  ["public", makeBuilding([216, 176, 112], [244, 240, 228], "flat")],
  // overlay rows (transparent outside the band)
  ["road_diag", (v, r) => diagPiece(v, r, roadPx)],
  ["rail_diag", (v, r) => diagPiece(v, r, railPx)],
];
export const ROW: Record<string, number> = Object.fromEntries(ROWS.map(([name], i) => [name, i]));

export function buildTileset(seed = 7): Image {
  const width = T * 16, height = T * ROWS.length;
  const data = new Uint8ClampedArray(width * height * 4);
  ROWS.forEach(([, painter], r) => {
    for (let col = 0; col < 16; col++) {
      const tile = painter(col, new Rng(seed * 1000 + r * 16 + col));
      for (let y = 0; y < T; y++) {
        data.set(tile.a.subarray(y * T * 4, (y + 1) * T * 4), ((r * T + y) * width + col * T) * 4);
      }
    }
  });
  return { width, height, data };
}

/** 4-bit mask of same neighbours (map edge counts as same). */
function neighMask(same: Uint8Array, rows: number, cols: number): Int32Array {
  const at = (y: number, x: number) => (y < 0 || x < 0 || y >= rows || x >= cols ? 1 : same[y * cols + x]);
  const out = new Int32Array(rows * cols);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out[y * cols + x] = at(y - 1, x) * N + at(y, x + 1) * E + at(y + 1, x) * S + at(y, x - 1) * W;
    }
  }
  return out;
}

/** Return a grid of tile indices (row*16 + col) into the tileset. */
export function assignTiles(
  kinds: KindGrid,
  groups: Int32Array,
  opts: { seed?: number; extraRoad?: Uint8Array | boolean[]; extraRail?: Uint8Array | boolean[] } = {},
): Int32Array {
  const { rows, cols, data } = kinds;
  const n = data.length;
  const rng = new Rng(opts.seed ?? 7);
  const variant = Int32Array.from({ length: n }, () => rng.int(16));
  const tiles = new Int32Array(n);
  const names = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k]));

  const isin = (list: number[], extra?: ArrayLike<unknown>) =>
    Uint8Array.from(data, (v, i) => (list.includes(v) || (extra && extra[i]) ? 1 : 0));
  const families = {
    forest: isin([K.forest]),
    water: isin([K.water, K.bridge, K.rail_bridge]),
    road: isin([...ROADLIKE], opts.extraRoad),
    rail: isin([K.rail, K.rail_bridge, K.crossing], opts.extraRail),
  };
  const masks = {
    forest: neighMask(families.forest, rows, cols),
    water: neighMask(families.water, rows, cols),
    road: neighMask(families.road, rows, cols),
    rail: neighMask(families.rail, rows, cols),
  };
  // buildings: neighbours are "same" only inside the same roof group
  const gAt = (y: number, x: number) => (y < 0 || x < 0 || y >= rows || x >= cols ? -1 : groups[y * cols + x]);
  const gmask = Int32Array.from(data, (_, i) => {
    const y = Math.floor(i / cols), x = i % cols, g = groups[i];
    return (gAt(y - 1, x) === g ? N : 0) + (gAt(y, x + 1) === g ? E : 0) + (gAt(y + 1, x) === g ? S : 0) + (gAt(y, x - 1) === g ? W : 0);
  });
  // Where tracks run in parallel (station yards) neighbour masks become junction soup;
  // draw straight track along the longer run direction instead.
  const rail = families.rail;
  const runH = run(rail, rows, cols, 1), runV = run(rail, rows, cols, 0);
  const railEw = Int32Array.from(masks.rail, (m) => m & (E | W));
  for (let i = 0; i < n; i++) {
    const rm = masks.rail[i];
    const nbits = (rm & 1) + ((rm >> 1) & 1) + ((rm >> 2) & 1) + ((rm >> 3) & 1);
    const wide = Math.min(runH[i], runV[i]) >= 2 || nbits >= 3;
    if (wide) {
      const straight = runH[i] >= runV[i] ? E | W : N | S;
      masks.rail[i] = straight;
      railEw[i] = straight & (E | W);
    }
  }

  for (let i = 0; i < n; i++) {
    const kid = data[i], name = names[kid];
    if (name === "forest") tiles[i] = ROW.forest * 16 + masks.forest[i];
    else if (name === "water") tiles[i] = ROW.water * 16 + masks.water[i];
    else if (name === "road" || name === "bridge") tiles[i] = ROW[name] * 16 + masks.road[i];
    else if (name === "rail" || name === "rail_bridge") tiles[i] = ROW[name] * 16 + masks.rail[i];
    else if (name === "crossing") tiles[i] = ROW.crossing * 16 + (railEw[i] > 0 ? 0 : 1);
    else if (BUILDING_KINDS.has(kid)) {
      const h = Number((BigInt(groups[i]) * 2654435761n) % 4294967296n);
      const row = name === "house" ? ROW.house0 + (h % HOUSE_ROOFS.length) : name === "shop" ? ROW.shop0 + (h % 2) : ROW[name];
      tiles[i] = row * 16 + gmask[i];
    } else tiles[i] = ROW[name] * 16 + variant[i];
  }
  return tiles;
}

/** Overlay tile indices (-1 = empty) from diagonal.apply output. */
export function overlayTiles(fam: Int8Array, col: Int16Array): Int32Array {
  const rows = [-1, ROW.road_diag, ROW.rail_diag];
  return Int32Array.from(fam, (f, i) => (f > 0 ? rows[f] * 16 + col[i] : -1));
}

/** Compose the whole map into one RGBA image (ground, then overlay). */
export function renderMap(tileGrid: Int32Array, cols: number, tileset: Image, overlay?: Int32Array): Image {
  const rows = tileGrid.length / cols;
  const width = cols * T, height = rows * T;
  const data = new Uint8ClampedArray(width * height * 4);
  const blit = (t: number, cx: number, cy: number, alpha: boolean) => {
    const sx = (t % 16) * T, sy = Math.floor(t / 16) * T;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const s = ((sy + y) * tileset.width + sx + x) * 4, d = ((cy * T + y) * width + cx * T + x) * 4;
        const a = alpha ? tileset.data[s + 3] / 255 : 1;
        if (a === 0) continue;
        for (let c = 0; c < 3; c++) data[d + c] = tileset.data[s + c] * a + data[d + c] * (1 - a);
        data[d + 3] = 255;
      }
    }
  };
  for (let i = 0; i < tileGrid.length; i++) blit(tileGrid[i], i % cols, Math.floor(i / cols), false);
  if (overlay) { for (let i = 0; i < overlay.length; i++) if (overlay[i] >= 0) blit(overlay[i], i % cols, Math.floor(i / cols), true); }
  return { width, height, data };
}
