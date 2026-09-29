/** On-disk storage: generated maps under data/out, HTTP responses cached under data/cache. */
import type { Fetcher } from "@kuboon/kimimachi";

const DATA = Deno.env.get("KIMIMACHI_DATA") ?? new URL("../.data", import.meta.url).pathname;
export const OUT = `${DATA}/out`;
const CACHE = `${DATA}/cache/http`;
const UA = "kimimachi-mapgen/0.1 (pixel game map generator)";

/** Files of a generated map that may be served. */
export const MAP_FILES: Record<string, string> = {
  "map.json": "application/json; charset=utf-8",
  "map.tmj": "application/json; charset=utf-8",
  "tileset.png": "image/png",
  "map.png": "image/png",
  "abstract.png": "image/png",
  "semantic_map.png": "image/png",
};

export const isMapId = (id: string) => /^[a-z0-9]{6,16}$/.test(id);

async function sha1(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** fetch with an on-disk cache (404 is cached as an empty file). */
export const cachedFetcher: Fetcher = async (url) => {
  const key = await sha1(url);
  const path = `${CACHE}/${key.slice(0, 2)}/${key}`;
  try {
    const data = await Deno.readFile(path);
    return data.length ? data : null;
  } catch {
    // not cached yet
  }
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  let data: Uint8Array;
  if (res.status === 404) {
    await res.body?.cancel();
    data = new Uint8Array();
  } else if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${url}`);
  } else data = new Uint8Array(await res.arrayBuffer());
  await Deno.mkdir(`${CACHE}/${key.slice(0, 2)}`, { recursive: true });
  await Deno.writeFile(path, data);
  return data.length ? data : null;
};

export interface MapSummary {
  id: string;
  place: string;
  source: string;
  tile_m: number;
}

/** Generated maps, newest first. */
export async function listMaps(): Promise<MapSummary[]> {
  const items: (MapSummary & { mtime: number })[] = [];
  try {
    for await (const e of Deno.readDir(OUT)) {
      if (!e.isDirectory || !isMapId(e.name)) continue;
      try {
        const file = `${OUT}/${e.name}/map.json`;
        const meta = JSON.parse(await Deno.readTextFile(file)).meta;
        items.push({
          id: e.name,
          place: meta.place,
          source: meta.source,
          tile_m: meta.tile_m,
          mtime: (await Deno.stat(file)).mtime?.getTime() ?? 0,
        });
      } catch {
        // incomplete directory
      }
    }
  } catch {
    // no maps yet
  }
  return items.sort((a, b) => b.mtime - a.mtime);
}
