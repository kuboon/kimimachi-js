/** Small seeded PRNG (mulberry32) so a seed always paints the same tileset. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  random(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi). With one argument, [0, lo). */
  int(lo: number, hi?: number): number {
    if (hi === undefined) [lo, hi] = [0, lo];
    return lo + Math.floor(this.random() * (hi - lo));
  }
}
