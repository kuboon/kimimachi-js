/** Serialize a generated map: game JSON, Tiled (.tmj) and preview images. */
import { BLOCKING_KINDS, KINDS } from "./abstract.ts";
import type { Label } from "./sources/gsi.ts";
import { type Image, ROWS, T } from "./tileset.ts";

export const KIND_COLORS: Record<string, [number, number, number]> = {
  grass: [104, 176, 72],
  forest: [40, 104, 56],
  paddy: [118, 178, 132],
  field: [168, 120, 72],
  water: [56, 120, 208],
  road: [120, 120, 128],
  bridge: [150, 132, 112],
  rail: [80, 72, 72],
  rail_bridge: [80, 72, 72],
  crossing: [230, 200, 40],
  park: [132, 206, 104],
  parking: [160, 160, 168],
  yard: [150, 204, 112],
  plaza: [214, 204, 186],
  bare: [196, 168, 120],
  house: [192, 80, 64],
  shop: [170, 150, 200],
  factory: [110, 130, 150],
  public: [224, 170, 90],
  road_diag: [120, 120, 128],
  rail_diag: [80, 72, 72],
};

export interface MapLabel {
  name: string;
  kind: string;
  code: number;
  /** position in tile units */
  tile: [number, number];
}

export interface MapMeta {
  place: string;
  source: string;
  city: string | null;
  center: [number, number];
  /** [lon0, lat0, lon1, lat1] */
  bounds: [number, number, number, number];
  tile_m: number;
  layout: string;
  attribution: string;
}

/** Compact data for a game / the viewer. */
export interface GameMap {
  meta: MapMeta;
  width: number;
  height: number;
  tileSize: number;
  kinds: string[];
  blockingKinds: string[];
  kindGrid: number[];
  tileGrid: number[];
  overlayGrid: number[];
  labels: MapLabel[];
}

export function labelsToTiles(labels: Label[], tileSize: number, cols: number, rows: number): MapLabel[] {
  const out: MapLabel[] = [];
  for (const l of labels) {
    const tx = l.px[0] / tileSize, ty = l.px[1] / tileSize;
    if (tx < cols && ty < rows) {
      out.push({ name: l.name, kind: l.kind, code: l.code, tile: [Math.round(tx * 100) / 100, Math.round(ty * 100) / 100] });
    }
  }
  return out;
}

export function kindsImage(kindGrid: ArrayLike<number>, cols: number, scale = 1): Image {
  const rows = kindGrid.length / cols;
  const width = cols * scale, height = rows * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = KIND_COLORS[KINDS[kindGrid[Math.floor(y / scale) * cols + Math.floor(x / scale)]]];
      data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const rowKind = (i: number) => ROWS[i][0].replace(/\d+$/, "");
const blockingRows = () => new Set(ROWS.map((_, i) => i).filter((i) => BLOCKING_KINDS.has(KINDS.indexOf(rowKind(i) as never))));

/** Tiled map (.tmj) with the tileset referenced as tileset.png. */
export function toTiled(map: GameMap, tileset: Image): unknown {
  const blocking = blockingRows();
  const tileProps = Array.from({ length: 16 * ROWS.length }, (_, id) => ({
    id,
    properties: [
      { name: "kind", type: "string", value: rowKind(Math.floor(id / 16)) },
      { name: "collides", type: "bool", value: blocking.has(Math.floor(id / 16)) },
    ],
  }));
  const objects = map.labels.map((l, i) => ({
    id: i + 1,
    name: l.name,
    type: l.kind,
    point: true,
    x: l.tile[0] * T,
    y: l.tile[1] * T,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
  }));
  const layer = (id: number, name: string, data: number[]) => ({
    id,
    name,
    type: "tilelayer",
    width: map.width,
    height: map.height,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data: data.map((v) => v + 1),
  });
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: map.width,
    height: map.height,
    tilewidth: T,
    tileheight: T,
    nextlayerid: 4,
    nextobjectid: objects.length + 1,
    properties: Object.entries(map.meta).map(([name, v]) => ({ name, type: "string", value: String(v) })),
    tilesets: [{
      firstgid: 1,
      name: "kimimachi",
      image: "tileset.png",
      imagewidth: tileset.width,
      imageheight: tileset.height,
      tilewidth: T,
      tileheight: T,
      columns: 16,
      tilecount: 16 * ROWS.length,
      margin: 0,
      spacing: 0,
      tiles: tileProps,
    }],
    layers: [
      layer(1, "ground", map.tileGrid),
      layer(3, "overlay", map.overlayGrid),
      { id: 2, name: "labels", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects },
    ],
  };
}
