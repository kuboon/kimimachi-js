import { assert, assertAlmostEquals, assertEquals } from "@std/assert";

import { Frame, GRID_DEG, gridCell, gridCellAt } from "../src/geo.ts";

Deno.test("gridCellAt picks the cell containing the point", () => {
  const c = gridCellAt(37.4463, 138.8514);
  assertEquals([c.i, c.j], [13885, 3744]);
  assertAlmostEquals(c.lat, 37.445, 1e-5);
  assertAlmostEquals(c.lon, 138.855, 1e-9);
});

Deno.test("a cell's frame spans exactly the cell, so neighbours share their edges", () => {
  const c = gridCell(13885, 3744), n = gridCell(13886, 3744), north = gridCell(13885, 3745);
  const [w, s, e, nn] = new Frame(c.lat, c.lon, c.width, c.height, 1).boundsLonlat();
  assertAlmostEquals(w, c.i * GRID_DEG, 1e-9);
  assertAlmostEquals(e, (c.i + 1) * GRID_DEG, 1e-9);
  assertAlmostEquals(s, c.j * GRID_DEG, 1e-9);
  assertAlmostEquals(nn, (c.j + 1) * GRID_DEG, 1e-9);
  assertAlmostEquals(new Frame(n.lat, n.lon, n.width, n.height, 1).boundsLonlat()[0], e, 1e-9);
  assertAlmostEquals(new Frame(north.lat, north.lon, north.width, north.height, 1).boundsLonlat()[1], nn, 1e-9);
  assert(c.width > 800 && c.width < 1000 && c.height > 1000 && c.height < 1200);
});
