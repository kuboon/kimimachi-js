/** Minimal 2-D array helpers (row-major typed arrays) replacing numpy / scipy.ndimage. */

/** Round half to even, like Python's round(). */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Mean of each k x k block. `mask` is h x w with h, w multiples of k. */
export function blockMean(
  mask: ArrayLike<number>,
  w: number,
  h: number,
  k: number,
): Float64Array {
  const cols = w / k, rows = h / k;
  const out = new Float64Array(rows * cols);
  for (let y = 0; y < h; y++) {
    const oy = Math.floor(y / k) * cols;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) out[oy + Math.floor(x / k)]++;
    }
  }
  const kk = k * k;
  for (let i = 0; i < out.length; i++) out[i] /= kk;
  return out;
}

/** True if any pixel in the k x k block is set. */
export function blockAny(
  mask: ArrayLike<number>,
  w: number,
  h: number,
  k: number,
): Uint8Array {
  const cols = w / k, rows = h / k;
  const out = new Uint8Array(rows * cols);
  for (let y = 0; y < h; y++) {
    const oy = Math.floor(y / k) * cols;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) out[oy + Math.floor(x / k)] = 1;
    }
  }
  return out;
}

/** scipy 'reflect' boundary: d c b a | a b c d | d c b a */
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n;
  i = ((i % period) + period) % period;
  return i < n ? i : period - 1 - i;
}

/** 3x3 mean filter with reflected borders. */
export function uniformFilter3(a: Float64Array, w: number, h: number): Float64Array {
  const out = new Float64Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = reflect(y + dy, h);
        for (let dx = -1; dx <= 1; dx++) s += a[yy * w + reflect(x + dx, w)];
      }
      out[y * w + x] = s / 9;
    }
  }
  return out;
}

/** Separable gaussian blur, scipy defaults (truncate 4, reflect). */
export function gaussianFilter(a: Float64Array, w: number, h: number, sigma: number): Float64Array {
  const r = Math.floor(4 * sigma + 0.5);
  const ker = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < ker.length; i++) ker[i] /= sum;
  const tmp = new Float64Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += ker[i + r] * a[y * w + reflect(x + i, w)];
      tmp[y * w + x] = s;
    }
  }
  const out = new Float64Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += ker[i + r] * tmp[reflect(y + i, h) * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}

/** Bilinear lookup with clamped ("nearest") borders. (x, y) are in array index units. */
export function bilinear(a: Float64Array, w: number, h: number, x: number, y: number): number {
  x = Math.min(Math.max(x, 0), w - 1);
  y = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  return (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx) * (1 - fy) +
    (a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx) * fy;
}

/** 4-connected component labelling. Returns labels (0 = background) and the component count. */
export function label(mask: ArrayLike<number>, w: number, h: number): { lab: Int32Array; n: number } {
  const lab = new Int32Array(w * h);
  let n = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    n++;
    lab[s] = n;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !lab[i - 1]) lab[i - 1] = n, stack.push(i - 1);
      if (x < w - 1 && mask[i + 1] && !lab[i + 1]) lab[i + 1] = n, stack.push(i + 1);
      if (y > 0 && mask[i - w] && !lab[i - w]) lab[i - w] = n, stack.push(i - w);
      if (y < h - 1 && mask[i + w] && !lab[i + w]) lab[i + w] = n, stack.push(i + w);
    }
  }
  return { lab, n };
}

/** Binary dilation with the 4-neighbour cross, one iteration. */
export function dilate(mask: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = mask[i] || (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) ||
          (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])
        ? 1
        : 0;
    }
  }
  return out;
}

/** Union-find over 0..n-1 returning a dense component id per element. */
export function components(n: number, edges: Iterable<readonly [number, number]>): { lab: Int32Array; count: number } {
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (const [a, b] of edges) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const ids = new Map<number, number>();
  const lab = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    lab[i] = ids.get(r)!;
  }
  return { lab, count: ids.size };
}
