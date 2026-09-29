/**
 * Schematization: turn the real street network into a "mental map".
 *
 * People remember a town as a simplified diagram: the railway is a straight
 * vertical line, the streets leaving the station run straight across, corners
 * are right angles. This module
 *
 *  1. rotates the area to the angle at which the fewest streets are diagonal
 *     (or, on request, so the railway lines up with a screen axis),
 *  2. builds a topological graph of roads and rails, simplifies every chain
 *     between junctions (Douglas-Peucker) and forces each remaining segment to
 *     be horizontal / vertical (or 45°) when that is a small correction,
 *  3. derives a smooth displacement field from how the network moved and uses
 *     it to warp everything else (land use, buildings, water, labels), so a
 *     building stays on the same side of the same street.
 */
import type { Frame, Pt } from "./geo.ts";
import { bilinear, components, gaussianFilter } from "./ndimage.ts";

export type RotateMode = "auto" | "rail" | "none";
export type RailAxis = "vertical" | "horizontal" | "auto";
export type Segment = [Pt, Pt, number];

// ------------------------------------------------------------------ rotation
/** Length-weighted mean direction of line segments, with `sym`-fold symmetry (2 = lines, 4 = grid). */
export function dominantAngle(lines: Pt[][], sym: number): number | null {
  let re = 0, im = 0;
  for (const pts of lines) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      const ln = Math.hypot(dx, dy), a = sym * Math.atan2(dy, dx);
      re += ln * Math.cos(a);
      im += ln * Math.sin(a);
    }
  }
  if (re === 0 && im === 0) return null;
  return Math.atan2(im, re) / sym;
}

/**
 * Rotation (radians, within ±45°) after which the least road length is diagonal.
 *
 * A segment counts as diagonal when it is more than 22.5° away from both axes
 * (it would be drawn with 45° tiles). Rails count `railWeight` times so a
 * railway also prefers to end up straight. Ties are broken by how far segments
 * are from the axes on average.
 */
export function minDiagonalRotation(roadLines: Pt[][], railLines: Pt[][], railWeight = 3.0, stepDeg = 0.5): number {
  const theta: number[] = [], wts: number[] = [];
  for (const [lines, w] of [[roadLines, 1.0], [railLines, railWeight]] as const) {
    for (const pts of lines) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
        theta.push((Math.atan2(dy, dx) * 180) / Math.PI);
        wts.push(w * Math.hypot(dx, dy));
      }
    }
  }
  if (!theta.length) return 0;
  let best = 0, bestCost = Infinity;
  for (let phi = -45; phi < 45; phi += stepDeg) {
    let diag = 0, dev = 0;
    for (let i = 0; i < theta.length; i++) {
      const a = (((theta[i] + phi) % 90) + 90) % 90;
      const d = Math.min(a, 90 - a); // 0..45° from the nearest axis
      if (d > 22.5) diag += wts[i];
      dev += (wts[i] * d) / 45;
    }
    const cost = diag + 0.1 * dev;
    if (cost < bestCost) best = phi, bestCost = cost;
  }
  return (best * Math.PI) / 180;
}

export function chooseRotation(railLines: Pt[][], roadLines: Pt[][], railAxis: RailAxis, mode: RotateMode): number {
  if (mode === "none") return 0;
  if (mode === "auto") return minDiagonalRotation(roadLines, railLines);
  return railRotation(railLines, roadLines, railAxis);
}

/** Rotation (radians) that makes the railway vertical/horizontal, or aligns the street grid. */
function railRotation(railLines: Pt[][], roadLines: Pt[][], railAxis: RailAxis): number {
  const th = railLines.length ? dominantAngle(railLines, 2) : null;
  let phi: number;
  if (th !== null) {
    let target = railAxis === "vertical" ? Math.PI / 2 : railAxis === "horizontal" ? 0 : null;
    if (target === null) target = Math.abs(Math.sin(th)) > Math.abs(Math.cos(th)) ? Math.PI / 2 : 0;
    phi = target - th;
  } else {
    const th4 = dominantAngle(roadLines, 4);
    phi = th4 !== null ? -th4 : 0;
  }
  // equivalent rotation with the smallest magnitude (lines have 180° symmetry)
  const m = Math.PI;
  return ((((phi + Math.PI / 2) % m) + m) % m) - Math.PI / 2;
}

// ------------------------------------------------------------------ graph
/** Douglas-Peucker: indices of kept points. */
function dp(pts: Pt[], tol: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const a = pts[0], b = pts[pts.length - 1];
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const n = Math.hypot(abx, aby);
  let bi = 0, bd = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = n === 0 ? Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) : Math.abs(abx * (pts[i][1] - a[1]) - aby * (pts[i][0] - a[0])) / n;
    if (d > bd) bd = d, bi = i;
  }
  if (bd <= tol) return [0, pts.length - 1];
  const left = dp(pts.slice(0, bi + 1), tol);
  const right = dp(pts.slice(bi), tol);
  return [...left, ...right.slice(1).map((j) => j + bi)];
}

const ekey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Undirected graph of polylines with merged vertices, split into junction-to-junction chains. */
export class Network {
  pos: Pt[] = [];
  adj = new Map<number, Set<number>>();
  edgeAttr = new Map<string, number>();
  chains: number[][];

  constructor(lines: Pt[][], attrs: number[], mergeTol: number) {
    const all: Pt[] = lines.flat();
    // merge vertices closer than mergeTol (tile seams, shared junctions) with a spatial hash
    const cell = Math.max(mergeTol, 1e-6);
    const buckets = new Map<string, number[]>();
    const pairs: [number, number][] = [];
    all.forEach((p, i) => {
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (Math.hypot(all[j][0] - p[0], all[j][1] - p[1]) <= mergeTol) pairs.push([j, i]);
          }
        }
      }
      const k = `${cx},${cy}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(i);
    });
    const { lab, count } = components(all.length, pairs);
    const sx = new Float64Array(count), sy = new Float64Array(count), cnt = new Float64Array(count);
    all.forEach((p, i) => {
      sx[lab[i]] += p[0], sy[lab[i]] += p[1], cnt[lab[i]]++;
    });
    for (let c = 0; c < count; c++) this.pos.push([sx[c] / cnt[c], sy[c] / cnt[c]]);

    let off = 0;
    lines.forEach((pts, li) => {
      const ids = Array.from(lab.subarray(off, off + pts.length));
      off += pts.length;
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = ids[i], b = ids[i + 1];
        if (a === b) continue;
        if (!this.adj.has(a)) this.adj.set(a, new Set());
        if (!this.adj.has(b)) this.adj.set(b, new Set());
        this.adj.get(a)!.add(b);
        this.adj.get(b)!.add(a);
        const k = ekey(a, b);
        this.edgeAttr.set(k, Math.max(this.edgeAttr.get(k) ?? 0, attrs[li]));
      }
    });
    this.chains = this.buildChains();
  }

  private buildChains(): number[][] {
    const chains: number[][] = [];
    const seen = new Set<string>();
    const walk = (start: number, nxt: number): number[] => {
      const chain = [start, nxt];
      for (;;) {
        const last = chain[chain.length - 1];
        const nb = this.adj.get(last)!;
        if (nb.size !== 2 || last === start) break;
        const [a, b] = [...nb];
        chain.push(a === chain[chain.length - 2] ? b : a);
      }
      return chain;
    };
    const mark = (c: number[]) => {
      for (let i = 0; i + 1 < c.length; i++) seen.add(ekey(c[i], c[i + 1]));
    };
    for (const [v, nb] of this.adj) {
      if (nb.size === 2) continue;
      for (const u of nb) {
        if (seen.has(ekey(v, u))) continue;
        const c = walk(v, u);
        mark(c);
        chains.push(c);
      }
    }
    // pure loops (every vertex degree 2)
    for (const [v, nb] of this.adj) {
      for (const u of nb) {
        if (seen.has(ekey(v, u))) continue;
        const c = walk(v, u);
        mark(c);
        chains.push(c);
      }
    }
    return chains;
  }
}

/** Solve (I + s AᵀA) x = b by preconditioned conjugate gradients. A is given as sparse rows. */
function solveSpd(rows: [number, number][][], n: number, s: number, b: Float64Array): Float64Array {
  const mul = (x: Float64Array): Float64Array => {
    const y = Float64Array.from(x);
    for (const row of rows) {
      let t = 0;
      for (const [c, v] of row) t += v * x[c];
      t *= s;
      for (const [c, v] of row) y[c] += v * t;
    }
    return y;
  };
  const diag = new Float64Array(n).fill(1);
  for (const row of rows) for (const [c, v] of row) diag[c] += s * v * v;
  const x = Float64Array.from(b);
  const ax = mul(x);
  const r = b.map((v, i) => v - ax[i]);
  const z = r.map((v, i) => v / diag[i]);
  const p = Float64Array.from(z);
  let rz = r.reduce((acc, v, i) => acc + v * z[i], 0);
  const bnorm = Math.sqrt(b.reduce((acc, v) => acc + v * v, 0)) || 1;
  for (let it = 0; it < 5000; it++) {
    if (Math.sqrt(r.reduce((acc, v) => acc + v * v, 0)) < 1e-10 * bnorm) break;
    const ap = mul(p);
    const alpha = rz / p.reduce((acc, v, i) => acc + v * ap[i], 0);
    for (let i = 0; i < n; i++) x[i] += alpha * p[i], r[i] -= alpha * ap[i];
    let rzNew = 0;
    for (let i = 0; i < n; i++) z[i] = r[i] / diag[i], rzNew += r[i] * z[i];
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return x;
}

export interface Orthogonalized {
  segments: Segment[];
  /** every original vertex and where it moved to, used to build the warp */
  controls: { old: Pt[]; nw: Pt[] };
}

/**
 * Each simplified segment gets a direction constraint: horizontal / vertical when
 * within `diagDeg` of an axis, otherwise 45° diagonal -- but only if that needs
 * less than `maxDev` px of sideways movement; other segments stay free. Positions are solved by
 * least squares (constraints weighted by `stiffness` vs. staying where they were),
 * so straightening never drags a street hundreds of meters away; H/V runs are
 * then snapped exactly.
 */
export function orthogonalize(net: Network, simplifyTol: number, maxDev: number, diagDeg = 30.0, stiffness = 200.0): Orthogonalized {
  const pos = net.pos;
  const keptChains: [number[], number[]][] = [];
  const keptNodes = new Set<number>();
  for (const c of net.chains) {
    const idx = dp(c.map((v) => pos[v]), simplifyTol);
    keptChains.push([c, idx]);
    for (const i of idx) keptNodes.add(c[i]);
  }
  const nodes = [...keptNodes].sort((a, b) => a - b);
  const nid = new Map(nodes.map((v, i) => [v, i]));
  const m = nodes.length;
  const p0 = nodes.map((v) => pos[v]);

  const tanD = Math.tan((diagDeg * Math.PI) / 180);
  const rows: [number, number][][] = [];
  const hEdges: [number, number][] = [], vEdges: [number, number][] = [];
  for (const [c, idx] of keptChains) {
    for (let t = 0; t + 1 < idx.length; t++) {
      const a = nid.get(c[idx[t]])!, b = nid.get(c[idx[t + 1]])!;
      if (a === b) continue;
      const dx = pos[c[idx[t + 1]]][0] - pos[c[idx[t]]][0], dy = pos[c[idx[t + 1]]][1] - pos[c[idx[t]]][1];
      let terms: [number, number][];
      if (Math.abs(dy) <= tanD * Math.abs(dx)) { // horizontal: y_a = y_b
        if (Math.abs(dy) > maxDev) continue;
        hEdges.push([a, b]);
        terms = [[m + a, 1], [m + b, -1]];
      } else if (Math.abs(dx) <= tanD * Math.abs(dy)) { // vertical: x_a = x_b
        if (Math.abs(dx) > maxDev) continue;
        vEdges.push([a, b]);
        terms = [[a, 1], [b, -1]];
      } else { // diagonal: |dx| = |dy| with matching signs
        if (Math.abs(Math.abs(dx) - Math.abs(dy)) > maxDev) continue;
        const sg = dx * dy > 0 ? 1 : -1;
        terms = [[a, 1], [b, -1], [m + a, -sg], [m + b, sg]];
      }
      rows.push(terms);
    }
  }
  const x0 = new Float64Array(2 * m);
  p0.forEach((p, i) => {
    x0[i] = p[0], x0[m + i] = p[1];
  });
  const sol = solveSpd(rows, 2 * m, stiffness, x0);
  const nw: Pt[] = p0.map((_, i) => [sol[i], sol[m + i]]);

  // exact snapping of H / V runs (the solve leaves ~1/stiffness residual)
  const snap = (edges: [number, number][], coord: 0 | 1) => {
    const { lab, count } = components(m, edges);
    const sum = new Float64Array(count), cnt = new Float64Array(count);
    nw.forEach((p, i) => {
      sum[lab[i]] += p[coord], cnt[lab[i]]++;
    });
    nw.forEach((p, i) => {
      p[coord] = sum[lab[i]] / cnt[lab[i]];
    });
  };
  snap(vEdges, 0);
  snap(hEdges, 1);

  const segments: Segment[] = [];
  const oldPts: Pt[] = [], newPts: Pt[] = [];
  for (const [c, idx] of keptChains) {
    let width = 0;
    for (let i = 0; i + 1 < c.length; i++) width = Math.max(width, net.edgeAttr.get(ekey(c[i], c[i + 1])) ?? 0);
    for (let t = 0; t + 1 < idx.length; t++) {
      const i = idx[t], j = idx[t + 1];
      const pa = nw[nid.get(c[i])!], pb = nw[nid.get(c[j])!];
      const pts = octilinear(pa, pb);
      for (let s = 0; s + 1 < pts.length; s++) segments.push([pts[s], pts[s + 1], width]);
      // every original vertex between i..j slides proportionally along the new segment
      const sub = c.slice(i, j + 1).map((v) => pos[v]);
      const cum = [0];
      for (let s = 1; s < sub.length; s++) cum.push(cum[s - 1] + Math.hypot(sub[s][0] - sub[s - 1][0], sub[s][1] - sub[s - 1][1]));
      const total = cum[cum.length - 1];
      sub.forEach((p, s) => {
        const tt = total > 0 ? cum[s] / total : 0;
        oldPts.push(p);
        newPts.push([pa[0] + tt * (pb[0] - pa[0]), pa[1] + tt * (pb[1] - pa[1])]);
      });
    }
  }
  return { segments, controls: { old: oldPts, nw: newPts } };
}

/**
 * Split a segment into horizontal/vertical + 45° pieces with the same endpoints.
 *
 * A segment at an arbitrary angle becomes  straight half -> 45° part -> straight half,
 * so every road can be drawn with axis or 45° tiles without moving its junctions.
 */
export function octilinear(pa: Pt, pb: Pt, tol = 0.08): Pt[] {
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const big = Math.max(ax, ay), small = Math.min(ax, ay);
  if (big === 0 || small <= tol * big || big - small <= tol * big) return [pa, pb];
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const diag: Pt = [sx * small, sy * small];
  const axis: Pt = ax > ay ? [sx * (ax - small), 0] : [0, sy * (ay - small)];
  const p1: Pt = [pa[0] + axis[0] / 2, pa[1] + axis[1] / 2];
  const p2: Pt = [p1[0] + diag[0], p1[1] + diag[1]];
  return [pa, p1, p2, pb];
}

// ------------------------------------------------------------------ transform
export interface SchematizerOptions {
  tilePx: number;
  railAxis?: RailAxis;
  smoothTiles?: number;
  straighten?: number;
  rotate?: RotateMode;
}

/** Maps source-frame px -> output-frame px (rotation + network-driven warp). */
export class Schematizer {
  readonly phi: number;
  readonly roadSegments: Segment[];
  readonly railSegments: Segment[];
  readonly maxDisp: number;
  private readonly c: Pt;
  private readonly offset: Pt;
  private readonly cs: number;
  private readonly sn: number;
  private readonly cell: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly fx: Float64Array;
  private readonly fy: Float64Array;

  constructor(
    srcFrame: Frame,
    outFrame: Frame,
    roadLines: Pt[][],
    roadWidths: number[],
    railLines: Pt[][],
    opts: SchematizerOptions,
  ) {
    const { tilePx, railAxis = "vertical", smoothTiles = 2.0, straighten = 3.0, rotate = "auto" } = opts;
    this.c = [srcFrame.W / 2, srcFrame.H / 2];
    this.offset = [(srcFrame.W - outFrame.W) / 2, (srcFrame.H - outFrame.H) / 2];
    this.phi = chooseRotation(railLines, roadLines, railAxis, rotate);
    this.cs = Math.cos(this.phi);
    this.sn = Math.sin(this.phi);

    const rr = roadLines.map((p) => this.rotate(p));
    const rl = railLines.map((p) => this.rotate(p));
    const merge = tilePx * 0.25;
    const simplify = tilePx * 1.0;
    const empty: Orthogonalized = { segments: [], controls: { old: [], nw: [] } };
    const roads = rr.length ? orthogonalize(new Network(rr, roadWidths, merge), simplify, tilePx * straighten) : empty;
    // rails are simplified and straightened much harder: a line should read as one straight stroke
    const rails = rl.length ? orthogonalize(new Network(rl, rl.map(() => 0), merge), simplify * 4, (tilePx * straighten * 8) / 3) : empty;
    this.roadSegments = roads.segments;
    this.railSegments = rails.segments;

    const old = [...roads.controls.old, ...rails.controls.old];
    const nw = [...roads.controls.nw, ...rails.controls.nw];
    let maxDisp = 0;
    const disp = old.map((p, i): Pt => {
      const d: Pt = [nw[i][0] - p[0], nw[i][1] - p[1]];
      maxDisp = Math.max(maxDisp, Math.hypot(d[0], d[1]));
      return d;
    });
    this.maxDisp = maxDisp;

    // Smooth displacement field by normalized convolution on a coarse grid:
    // nearby buildings move together with their street instead of being torn apart.
    this.cell = tilePx * 1.0;
    const gw = this.gw = Math.floor(srcFrame.W / this.cell) + 2;
    const gh = this.gh = Math.floor(srcFrame.H / this.cell) + 2;
    const wsum = new Float64Array(gw * gh), dxs = new Float64Array(gw * gh), dys = new Float64Array(gw * gh);
    old.forEach((p, i) => {
      const gx = Math.min(Math.max(Math.trunc(p[0] / this.cell), 0), gw - 1);
      const gy = Math.min(Math.max(Math.trunc(p[1] / this.cell), 0), gh - 1);
      const f = gy * gw + gx;
      wsum[f]++, dxs[f] += disp[i][0], dys[f] += disp[i][1];
    });
    const w = gaussianFilter(wsum, gw, gh, smoothTiles);
    let wmax = 0;
    for (const v of w) wmax = Math.max(wmax, v);
    const eps = wmax ? 1e-3 * wmax : 1.0;
    const gx = gaussianFilter(dxs, gw, gh, smoothTiles), gy = gaussianFilter(dys, gw, gh, smoothTiles);
    this.fx = gx.map((v, i) => v / (w[i] + eps));
    this.fy = gy.map((v, i) => v / (w[i] + eps));
  }

  rotate(pts: Pt[]): Pt[] {
    return pts.map(([x, y]) => {
      const dx = x - this.c[0], dy = y - this.c[1];
      // (p - c) @ R.T with R = [[cs, -sn], [sn, cs]]
      return [dx * this.cs - dy * this.sn + this.c[0], dx * this.sn + dy * this.cs + this.c[1]];
    });
  }

  private warp(q: Pt[]): Pt[] {
    // bilinear lookup in the displacement grid (cell centers at (i + .5) * cell)
    return q.map(([x, y]) => {
      const u = x / this.cell - 0.5, v = y / this.cell - 0.5;
      return [x + bilinear(this.fx, this.gw, this.gh, u, v), y + bilinear(this.fy, this.gw, this.gh, u, v)];
    });
  }

  /** Transform source-frame px into output-frame px. */
  transform = (pts: Pt[]): Pt[] => this.warp(this.rotate(pts)).map(([x, y]) => [x - this.offset[0], y - this.offset[1]]);

  /** Points already in rotated/schematic space -> output frame. */
  out(pts: Pt[]): Pt[] {
    return pts.map(([x, y]) => [x - this.offset[0], y - this.offset[1]]);
  }
}
