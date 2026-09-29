/** Project PLATEAU: land use (luse) and road (tran) vector tiles from the PLATEAU data catalog. */
import { type Frame, mercToLonlat, type Pt } from "../geo.ts";
import { type Fetcher, fetchJson, fetchMany } from "../net.ts";
import {
  BARE,
  type Feature,
  FIELD,
  FOREST,
  GRASS,
  LOT_COM,
  LOT_IND,
  LOT_PUB,
  LOT_RES,
  mvtFeatures,
  PADDY,
  PARK,
  PARKING,
  PAVED,
  type Rasterizer,
  ringArea,
  ROAD,
  WATER,
} from "../raster.ts";

const CATALOG_URL = "https://api.plateau.reearth.io/datacatalog/plateau-datasets";
const REVGEO_URL = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const Z = 16;

/** luse:class_code -> semantic class */
const LUSE_CLASS: Record<string, number> = {
  "201": PADDY,
  "202": FIELD,
  "203": FOREST,
  "204": WATER,
  "205": GRASS,
  "206": GRASS,
  "211": LOT_RES,
  "212": LOT_COM,
  "213": LOT_IND,
  "214": LOT_PUB,
  "215": ROAD,
  "216": LOT_PUB,
  "217": PARK,
  "218": LOT_PUB,
  "219": LOT_IND,
  "220": BARE,
  "221": BARE,
  "222": PARKING,
  "223": BARE,
  "224": BARE,
  "231": GRASS,
};

export interface PlateauDatasets {
  city: string;
  attribution: string;
  luse: string[];
  tran: string[];
  years: number[];
}

interface CatalogEntry {
  format?: string;
  type: string;
  ward_code?: string;
  city_code?: string;
  ward?: string;
  city?: string;
  year?: number | string;
  url: string;
}

export interface Address {
  muniCd?: string;
  lv01Nm?: string;
}

/** 国土地理院の逆ジオコーダ: 市区町村コードと町丁目名。 */
export async function reverseGeocode(fetcher: Fetcher, lat: number, lon: number): Promise<Address> {
  const res = await fetchJson<{ results?: Address }>(fetcher, REVGEO_URL, {
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
  });
  return res?.results ?? {};
}

/** Municipality codes (e.g. '13101') found on an n x n grid of points over the frame. */
export async function municipalities(fetcher: Fetcher, frame: Frame, n = 5): Promise<string[]> {
  const jobs: Promise<Address>[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [lon, lat] = mercToLonlat(
        frame.x0 + ((i + 0.5) / n) * (frame.x1 - frame.x0),
        frame.y0 + ((j + 0.5) / n) * (frame.y1 - frame.y0),
      );
      jobs.push(reverseGeocode(fetcher, lat, lon));
    }
  }
  const codes: string[] = [];
  for (const r of await Promise.all(jobs)) if (r.muniCd && !codes.includes(r.muniCd)) codes.push(r.muniCd);
  return codes;
}

/** PLATEAU luse/tran MVT URLs for every municipality the frame touches (latest year each). */
export async function findDatasets(fetcher: Fetcher, frame: Frame): Promise<PlateauDatasets | null> {
  let codes = await municipalities(fetcher, frame);
  const cat = await fetchJson<{ datasets: CatalogEntry[] }>(fetcher, CATALOG_URL);
  if (!cat) return null;
  const codeOf = (d: CatalogEntry) => String(d.ward_code || d.city_code || "");
  const published = new Set(cat.datasets.filter((d) => d.format === "MVT" && d.type === "土地利用モデル").map(codeOf));
  // wards of designated cities (e.g. 川崎市多摩区 14135) are published under the city code (14130);
  // only fall back to it when the ward itself has no data (Tokyo's wards are published individually)
  codes = codes.map((c) => published.has(c) ? c : c.slice(0, 4) + "0");
  const best = new Map<string, { kind: "luse" | "tran"; code: string; d: CatalogEntry }>();
  for (const d of cat.datasets) {
    if (d.format !== "MVT" || !["土地利用モデル", "交通（道路）モデル"].includes(d.type)) continue;
    const code = codeOf(d);
    if (!codes.includes(code)) continue;
    const kind = d.type === "土地利用モデル" ? "luse" : "tran";
    const key = `${kind}:${code}`;
    // several road datasets can exist per city (LOD variants); keep the first of the latest year
    const cur = best.get(key);
    if (!cur || Number(d.year ?? 0) > Number(cur.d.year ?? 0)) best.set(key, { kind, code, d });
  }
  if (!best.size) return null;
  const names: string[] = [], credits: string[] = [];
  for (const { d } of best.values()) {
    const name = d.ward || d.city || "";
    if (!names.includes(name)) {
      names.push(name);
      credits.push(`${name}（${d.year}年度）`);
    }
  }
  const all = [...best.values()];
  return {
    city: names.join(", "),
    // PLATEAU citation style: 3D都市モデル（Project PLATEAU）長岡市（2024年度）
    attribution: `3D都市モデル（Project PLATEAU）${credits.join("、")}（国土交通省）`,
    luse: all.filter((b) => b.kind === "luse").map((b) => b.d.url),
    tran: all.filter((b) => b.kind === "tran").map((b) => b.d.url),
    years: [...new Set(all.map((b) => Number(b.d.year ?? 0)))].sort((a, b) => a - b),
  };
}

async function load(fetcher: Fetcher, url: string, frame: Frame): Promise<Feature[]> {
  const tiles = frame.tiles(Z);
  const blobs = await fetchMany(
    fetcher,
    tiles.map(([z, x, y]) => url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))),
  );
  const feats: Feature[] = [];
  for (let i = 0; i < tiles.length; i++) feats.push(...await mvtFeatures(blobs[i], tiles[i][0], tiles[i][1], tiles[i][2], frame));
  return feats;
}

function luseCode(props: Feature["props"]): string | null {
  let code: unknown = props["luse_class_code"];
  if (code === undefined && typeof props.attributes === "string") {
    try {
      code = JSON.parse(props.attributes)["luse:class_code"];
    } catch {
      code = undefined;
    }
  }
  return code === undefined || code === null ? null : String(code);
}

/** Returns number of land-use polygons drawn. roadLand=false skips road-land polygons. */
export async function drawLanduse(
  fetcher: Fetcher,
  rast: Rasterizer,
  ds: PlateauDatasets,
  frame: Frame,
  roadLand = true,
): Promise<number> {
  const polys: { area: number; cls: number; rings: Pt[][] }[] = [];
  for (const url of ds.luse) {
    for (const f of await load(fetcher, url, frame)) {
      if (f.kind !== "polygon") continue;
      const cls = LUSE_CLASS[luseCode(f.props) ?? ""] ?? GRASS;
      for (const rings of f.parts as Pt[][][]) polys.push({ area: ringArea(rings[0]), cls, rings });
    }
  }
  // Big polygons first so that polygons sitting inside their holes overwrite them.
  polys.sort((a, b) => b.area - a.area);
  for (const p of polys) {
    let cls = p.cls;
    if (cls === ROAD && !roadLand) cls = PAVED; // road land beyond the drawn (schematic) carriageway: sidewalks / plazas
    rast.polygon(p.rings, cls);
    if (cls === LOT_RES || cls === LOT_COM || cls === LOT_IND || cls === LOT_PUB) rast.polygon(p.rings, cls, "land");
    if (cls === WATER) rast.polygon(p.rings, 1, "water");
  }
  return polys.length;
}

export async function drawRoads(fetcher: Fetcher, rast: Rasterizer, ds: PlateauDatasets, frame: Frame): Promise<number> {
  let n = 0;
  for (const url of ds.tran) {
    for (const f of await load(fetcher, url, frame)) {
      if (f.kind !== "polygon") continue;
      for (const rings of f.parts as Pt[][][]) {
        rast.polygon(rings, ROAD);
        n++;
      }
    }
  }
  return n;
}
