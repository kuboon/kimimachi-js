/**
 * 45° diagonal roads / rails on the tile grid.
 *
 * A 45° band cannot be drawn with whole tiles; it covers a chain of *centre* cells
 * plus a triangle of the two cells that flank every step. For a "\" line through
 * cells (i, i), (i+1, i+1) ... the cell to the right of each centre holds the
 * band's lower-left triangle and the cell below holds its upper-right triangle.
 * "/" is the mirror image (left neighbour: lower-right, below: upper-left).
 *
 * These pieces live on an overlay layer (transparent outside the band) so the
 * ground of the cell stays visible under the band's edges.
 */
import { BUILDING_KINDS, K, type KindGrid, ROADLIKE } from "./abstract.ts";
import type { Pt } from "./geo.ts";
import { pyRound } from "./ndimage.ts";

// overlay piece ids (column in the overlay rows of the tileset)
const BS_C = 0, BS_R = 1, BS_B = 2, FS_C = 3, FS_L = 4, FS_B = 5; // "\" centre/right/below, "/" centre/left/below
/** + offset: road variants without curbs (on asphalt) */
export const NO_CURB = 6;

const GROUND_UNDER: Record<number, number> = {
  [K.house]: K.yard,
  [K.shop]: K.plaza,
  [K.factory]: K.plaza,
  [K.public]: K.plaza,
  [K.forest]: K.grass,
  [K.rail]: K.bare,
  [K.rail_bridge]: K.water,
  [K.crossing]: K.road,
};

export function isDiagonal(pa: Pt, pb: Pt, minLen: number, tol = 0.08): boolean {
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  const ln = Math.max(Math.abs(dx), Math.abs(dy));
  return ln >= minLen && Math.abs(Math.abs(dx) - Math.abs(dy)) <= tol * ln;
}

/** Centre cells of a 45° segment, snapped to the tile grid, and its direction. */
function cells(pa: Pt, pb: Pt, cellPx: number): { cells: [number, number][]; dir: "\\" | "/" } {
  const a = [pa[0] / cellPx - 0.5, pa[1] / cellPx - 0.5];
  const b = [pb[0] / cellPx - 0.5, pb[1] / cellPx - 0.5];
  const sx = Math.sign(b[0] - a[0]), sy = Math.sign(b[1] - a[1]);
  const n = Math.trunc(pyRound((Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) / 2));
  const c0 = pyRound(a[0]), r0 = pyRound(a[1]);
  const out: [number, number][] = [];
  for (let t = 0; t <= n; t++) out.push([r0 + t * sy, c0 + t * sx]);
  return { cells: out, dir: sx === sy ? "\\" : "/" };
}

export interface DiagonalResult {
  /** game logic grid (diagonal cells become road_diag / rail_diag) */
  kinds: KindGrid;
  /** what to paint underneath (ground, asphalt, water) */
  base: KindGrid;
  /** overlay family per cell: 0 none, 1 road, 2 rail */
  fam: Int8Array;
  /** overlay column per cell */
  col: Int16Array;
}

/** Place diagonal pieces. */
export function apply(kinds: KindGrid, roadSegs: [Pt, Pt][], railSegs: [Pt, Pt][], cellPx: number): DiagonalResult {
  const { rows, cols, data } = kinds;
  const base = data.slice();
  const fam = new Int8Array(data.length);
  const col = new Int16Array(data.length);
  const prio = new Int8Array(data.length); // centre (2) beats corner (1)
  const out = data.slice();

  const put = (r: number, c: number, family: number, piece: number, p: number) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    const i = r * cols + c;
    if (p < prio[i]) return;
    const k = data[i];
    if (family === 1 && ROADLIKE.has(k)) { // joins an existing street: no curbs
      fam[i] = 1, col[i] = piece + NO_CURB, prio[i] = p;
      return;
    }
    fam[i] = family, col[i] = piece, prio[i] = p;
    base[i] = GROUND_UNDER[k] ?? k;
    if (BUILDING_KINDS.has(k) || k === K.forest) base[i] = GROUND_UNDER[k];
    out[i] = family === 1 ? K.road_diag : K.rail_diag;
  };

  for (const [family, segs] of [[2, railSegs], [1, roadSegs]] as const) { // roads last: they win over rails
    for (const [pa, pb] of segs) {
      const { cells: cs, dir } = cells(pa, pb, cellPx);
      for (const [r, c] of cs) {
        if (dir === "\\") {
          put(r, c + 1, family, BS_R, 1);
          put(r + 1, c, family, BS_B, 1);
        } else {
          put(r, c - 1, family, FS_L, 1);
          put(r + 1, c, family, FS_B, 1);
        }
      }
      for (const [r, c] of cs) put(r, c, family, dir === "\\" ? BS_C : FS_C, 2);
    }
  }
  return { kinds: { rows, cols, data: out }, base: { rows, cols, data: base }, fam, col };
}
