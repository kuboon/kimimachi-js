/** Mapbox Vector Tile decoder (protobuf wire format, no dependencies). */

export type MvtProps = Record<string, string | number | boolean>;
export type MvtGeom =
  | { type: "point"; points: [number, number][] }
  | { type: "line"; lines: [number, number][][] }
  | { type: "polygon"; polygons: [number, number][][][] };
export interface MvtFeature {
  props: MvtProps;
  geom: MvtGeom;
}
export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array, readonly end = buf.length) {}

  varint(): number {
    let r = 0, mul = 1, b: number;
    do {
      b = this.buf[this.pos++];
      r += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return r;
  }

  bytes(): Uint8Array {
    const n = this.varint();
    const s = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }

  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

const zigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function decodeValue(buf: Uint8Array): string | number | boolean {
  const r = new Reader(buf);
  let out: string | number | boolean = "";
  while (r.pos < buf.length) {
    const tag = r.varint(), field = tag >>> 3, wire = tag & 7;
    if (field === 1) out = new TextDecoder().decode(r.bytes());
    else if (field === 2) {
      out = new DataView(buf.buffer, buf.byteOffset + r.pos, 4).getFloat32(0, true);
      r.pos += 4;
    } else if (field === 3) {
      out = new DataView(buf.buffer, buf.byteOffset + r.pos, 8).getFloat64(0, true);
      r.pos += 8;
    } else if (field === 4 || field === 5) out = r.varint();
    else if (field === 6) out = zigzag(r.varint());
    else if (field === 7) out = r.varint() !== 0;
    else r.skip(wire);
  }
  return out;
}

function decodeGeometry(type: number, cmds: number[]): MvtGeom | null {
  const rings: [number, number][][] = [];
  let cur: [number, number][] = [];
  let x = 0, y = 0;
  for (let i = 0; i < cmds.length;) {
    const head = cmds[i++], id = head & 7, count = head >>> 3;
    if (id === 7) { // ClosePath
      if (cur.length) cur.push([...cur[0]]);
      continue;
    }
    for (let c = 0; c < count; c++) {
      x += zigzag(cmds[i++]);
      y += zigzag(cmds[i++]);
      if (id === 1) { // MoveTo starts a new part
        if (cur.length) rings.push(cur);
        cur = [];
      }
      cur.push([x, y]);
    }
  }
  if (cur.length) rings.push(cur);
  if (type === 1) return { type: "point", points: rings.flat() };
  if (type === 2) return { type: "line", lines: rings };
  if (type === 3) {
    // exterior rings have positive area in tile coordinates (y down); the rest are holes
    const polygons: [number, number][][][] = [];
    for (const ring of rings) {
      let a = 0;
      for (let i = 0; i + 1 < ring.length; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      if (a > 0 || !polygons.length) polygons.push([ring]);
      else polygons[polygons.length - 1].push(ring);
    }
    return { type: "polygon", polygons };
  }
  return null;
}

function decodeLayer(buf: Uint8Array): MvtLayer {
  const r = new Reader(buf);
  let name = "", extent = 4096;
  const keys: string[] = [], values: (string | number | boolean)[] = [];
  const rawFeatures: Uint8Array[] = [];
  while (r.pos < buf.length) {
    const tag = r.varint(), field = tag >>> 3, wire = tag & 7;
    if (field === 1) name = new TextDecoder().decode(r.bytes());
    else if (field === 2) rawFeatures.push(r.bytes());
    else if (field === 3) keys.push(new TextDecoder().decode(r.bytes()));
    else if (field === 4) values.push(decodeValue(r.bytes()));
    else if (field === 5) extent = r.varint();
    else r.skip(wire);
  }
  const features: MvtFeature[] = [];
  for (const fb of rawFeatures) {
    const f = new Reader(fb);
    let type = 0;
    const tags: number[] = [], cmds: number[] = [];
    while (f.pos < fb.length) {
      const tag = f.varint(), field = tag >>> 3, wire = tag & 7;
      if (field === 2 || field === 4) {
        const sub = new Reader(f.bytes());
        const target = field === 2 ? tags : cmds;
        while (sub.pos < sub.buf.length) target.push(sub.varint());
      } else if (field === 3) type = f.varint();
      else f.skip(wire);
    }
    const props: MvtProps = {};
    for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
    const geom = decodeGeometry(type, cmds);
    if (geom) features.push({ props, geom });
  }
  return { name, extent, features };
}

export function decodeMvt(buf: Uint8Array): MvtLayer[] {
  const r = new Reader(buf);
  const layers: MvtLayer[] = [];
  while (r.pos < buf.length) {
    const tag = r.varint(), field = tag >>> 3, wire = tag & 7;
    if (field === 3) layers.push(decodeLayer(r.bytes()));
    else r.skip(wire);
  }
  return layers;
}

/** Gunzip when needed (some tile servers deliver .pbf gzipped). */
export async function maybeGunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
