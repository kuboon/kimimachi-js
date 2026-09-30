/** Generates the map of one grid cell in a Web Worker and stores it in IndexedDB. */
import { gridCell } from "@kuboon/kimimachi/geo";

import { getMap, putMap } from "./db.ts";
import type { StoredMap } from "./db.ts";
import type { Message } from "./worker.ts";

/** Where the map sources (国土地理院 / PLATEAU) have data. */
export const inJapan = (lat: number, lon: number) => lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;

/** The id of a cell's map: one map per cell (`g` for the real-shape layout; `c` was the schematic one), so visiting a cell twice reuses it. */
export const cellId = (i: number, j: number) => `g${i}_${j}`;

const png = (b: Uint8Array) => new Blob([b as BlobPart], { type: "image/png" });

/**
 * Makes the map of cell (i, j), storing it under {@linkcode cellId}. `log` gets the generator's progress lines.
 * Resolves with the stored record.
 */
export function generateCell(
  workerSrc: string,
  i: number,
  j: number,
  opts: { title?: string; log?: (text: string) => void } = {},
): Promise<StoredMap> {
  const c = gridCell(i, j);
  return new Promise((resolve, reject) => {
    if (!inJapan(c.lat, c.lon)) {
      return reject(new Error("日本国内の位置を指定してください（地図データは国土地理院・PLATEAU のため）"));
    }
    const worker = new Worker(workerSrc, { type: "module" });
    worker.onmessage = async (e: MessageEvent<Message>) => {
      const m = e.data;
      if (m.type === "log") return opts.log?.(m.text);
      worker.terminate();
      if (m.type === "error") return reject(new Error(m.text));
      const rec: StoredMap = {
        id: cellId(i, j),
        createdAt: Date.now(),
        grid: { i, j },
        map: m.map,
        tileset: png(m.tileset),
        mapPng: png(m.mapPng),
        abstractPng: png(m.abstractPng),
        tmj: m.tmj,
      };
      try {
        await putMap(rec);
        resolve(rec);
      } catch (err) {
        reject(err);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "生成に失敗しました"));
    };
    worker.postMessage({
      lat: c.lat,
      lon: c.lon,
      size: c.width,
      height: c.height,
      // Neighbouring cells only join up with the real shapes: the schematic layout rotates and
      // straightens every cell on its own. The padding gives the outermost tiles their neighbours.
      layout: "real",
      pad: 6,
      title: opts.title,
    });
  });
}

/** The stored map of cell (i, j), or a freshly generated one. */
export async function getOrGenerateCell(
  workerSrc: string,
  i: number,
  j: number,
  opts: { log?: (text: string) => void } = {},
): Promise<StoredMap> {
  return await getMap(cellId(i, j)) ?? await generateCell(workerSrc, i, j, opts);
}
