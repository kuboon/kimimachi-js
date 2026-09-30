import { assert, assertEquals, assertGreater } from "@std/assert";
import { encodePng, generateMap, renderMap } from "../src/mod.ts";
import { Frame, lonlatToMerc, mercToLonlat } from "../src/geo.ts";
import { decodeMvt } from "../src/mvt.ts";
import { Rasterizer, WATER } from "../src/raster.ts";
import { Rng } from "../src/rng.ts";
import { buildTileset } from "../src/tileset.ts";

Deno.test("mercator round trip", () => {
  const [x, y] = lonlatToMerc(138.85, 37.44);
  const [lon, lat] = mercToLonlat(x, y);
  assert(Math.abs(lon - 138.85) < 1e-9 && Math.abs(lat - 37.44) < 1e-9);
});

Deno.test("frame covers the requested size", () => {
  const f = new Frame(37.44, 138.85, 1000, 500, 1);
  assertEquals([f.W, f.H], [1000, 500]);
  assertGreater(f.tiles(16).length, 0);
});

Deno.test("rng is deterministic", () => {
  const a = new Rng(7), b = new Rng(7);
  assertEquals([a.int(100), a.int(5, 9)], [b.int(100), b.int(5, 9)]);
});

Deno.test("polygons outside the frame draw nothing", () => {
  const r = new Rasterizer(new Frame(37.44, 138.85, 100, 100, 1));
  r.polygon([[[-50, -50], [-10, -50], [-10, -10], [-50, -10]]], WATER);
  assertEquals(r.layers.cls.filter((v) => v).length, 0);
  r.polygon([[[10, 10], [30, 10], [30, 30], [10, 30]]], WATER);
  assertGreater(r.layers.cls.filter((v) => v).length, 350);
});

Deno.test("decodes a hand-built vector tile", () => {
  // layer "l": one point feature at (25, 17) with tag k=v
  const enc = new TextEncoder();
  const str = (field: number, s: string) => [(field << 3) | 2, s.length, ...enc.encode(s)];
  const feature = [0x08, 1, 0x18, 1, 0x12, 2, 0, 0, 0x22, 3, 9, 50, 34]; // id, type=POINT, tags, geometry
  const value = [0x0a, 1, 118]; // string_value "v"
  const layer = [
    ...str(1, "l"),
    0x12,
    feature.length,
    ...feature,
    ...str(3, "k"),
    0x22,
    value.length,
    ...value,
    0x28,
    0x80,
    0x20, // extent = 4096
  ];
  const [l] = decodeMvt(new Uint8Array([0x1a, layer.length, ...layer]));
  assertEquals(l.name, "l");
  assertEquals(l.extent, 4096);
  assertEquals(l.features[0].props, { k: "v" });
  assertEquals(l.features[0].geom, { type: "point", points: [[25, 17]] });
});

Deno.test("PNG encoder writes a valid header", async () => {
  const png = await encodePng(buildTileset(1));
  assertEquals(Array.from(png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assertGreater(png.length, 1000);
});

Deno.test("generateMap works with an empty data source", async () => {
  const { map, tileset } = await generateMap({
    lat: 37.4463,
    lon: 138.8514,
    size: 400,
    title: "test",
    layout: "real",
    source: "gsi",
    fetch: () => Promise.resolve(null),
  });
  assertEquals([map.width, map.height], [50, 50]);
  assertEquals(map.kindGrid.length, 2500);
  assertEquals(map.meta.place, "test");
  const img = renderMap(Int32Array.from(map.tileGrid), map.width, tileset);
  assertEquals([img.width, img.height], [800, 800]);
});

Deno.test("pad generates a wider area and crops it back to the requested size", async () => {
  const opts = {
    lat: 37.4463,
    lon: 138.8514,
    size: 400,
    layout: "real",
    source: "gsi",
    title: "t",
    fetch: () => Promise.resolve(null),
  } as const;
  const [a, b] = [await generateMap(opts), await generateMap({ ...opts, pad: 5 })];
  assertEquals([b.map.width, b.map.height], [a.map.width, a.map.height]);
  assertEquals(b.map.kindGrid.length, a.map.kindGrid.length);
  assertEquals(b.map.meta.bounds, a.map.meta.bounds);
});
