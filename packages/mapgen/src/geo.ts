/** Local raster frame in Web Mercator meters. */

export const EARTH_CIRC = 40075016.686;

export type Pt = [number, number];

/** Web Mercator normalized coordinates in [0,1] (y down). */
export function lonlatToMerc(lon: number, lat: number): Pt {
  const x = (lon + 180) / 360;
  const y = (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
  return [x, y];
}

export function mercToLonlat(x: number, y: number): Pt {
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lon, lat];
}

/** A rectangular area around (lat, lon) rasterized at `mpp` meters per pixel. */
export class Frame {
  readonly cx: number;
  readonly cy: number;
  readonly mPerUnit: number;
  readonly W: number;
  readonly H: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;

  constructor(
    readonly lat: number,
    readonly lon: number,
    readonly widthM: number,
    readonly heightM: number,
    readonly mpp: number,
  ) {
    [this.cx, this.cy] = lonlatToMerc(lon, lat);
    // ground meters per normalized mercator unit at this latitude
    this.mPerUnit = EARTH_CIRC * Math.cos((lat * Math.PI) / 180);
    this.W = Math.round(widthM / mpp);
    this.H = Math.round(heightM / mpp);
    this.x0 = this.cx - widthM / 2 / this.mPerUnit;
    this.y0 = this.cy - heightM / 2 / this.mPerUnit;
    this.x1 = this.cx + widthM / 2 / this.mPerUnit;
    this.y1 = this.cy + heightM / 2 / this.mPerUnit;
  }

  get pxPerUnit(): number {
    return this.mPerUnit / this.mpp;
  }

  mercToPx(x: number, y: number): Pt {
    const s = this.pxPerUnit;
    return [(x - this.x0) * s, (y - this.y0) * s];
  }

  lonlatToPx(lon: number, lat: number): Pt {
    return this.mercToPx(...lonlatToMerc(lon, lat));
  }

  /** Slippy-map tile indices covering the frame at zoom z. */
  tiles(z: number): [number, number, number][] {
    const n = 2 ** z;
    const tx0 = Math.floor(this.x0 * n), tx1 = Math.floor(this.x1 * n);
    const ty0 = Math.floor(this.y0 * n), ty1 = Math.floor(this.y1 * n);
    const out: [number, number, number][] = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) out.push([z, tx, ty]);
    }
    return out;
  }

  /** [lon0, lat0, lon1, lat1] (west, south, east, north). */
  boundsLonlat(): [number, number, number, number] {
    const [lon0, lat1] = mercToLonlat(this.x0, this.y0);
    const [lon1, lat0] = mercToLonlat(this.x1, this.y1);
    return [lon0, lat0, lon1, lat1];
  }
}
