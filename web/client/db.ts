/** Maps live in this browser's IndexedDB. */
import type { GameMap } from "@kuboon/kimimachi";

export interface StoredMap {
  id: string;
  createdAt: number;
  /** Which grid cell this is (`gridCell(i, j)`); absent on maps made before the grid. */
  grid?: { i: number; j: number };
  map: GameMap & { kindColors: number[][] };
  /** PNG files */
  tileset: Blob;
  mapPng: Blob;
  abstractPng: Blob;
  /** Tiled map (.tmj) */
  tmj: string;
}

/** Small record for the gallery (kept apart so listing does not load the big images). */
export interface MapSummary {
  id: string;
  createdAt: number;
  place: string;
  source: string;
  tile_m: number;
  thumb: Blob;
}

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open("kimimachi", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("maps", { keyPath: "id" });
      req.result.createObjectStore("summaries", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => {
      db.close();
      resolve(req ? req.result : (undefined as T));
    };
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export async function putMap(rec: StoredMap): Promise<void> {
  const summary: MapSummary = {
    id: rec.id,
    createdAt: rec.createdAt,
    place: rec.map.meta.place,
    source: rec.map.meta.source,
    tile_m: rec.map.meta.tile_m,
    thumb: rec.abstractPng,
  };
  await tx(["maps", "summaries"], "readwrite", (t) => {
    t.objectStore("maps").put(rec);
    t.objectStore("summaries").put(summary);
  });
}

export const getMap = (id: string): Promise<StoredMap | undefined> =>
  id ? tx(["maps"], "readonly", (t) => t.objectStore("maps").get(id)) : Promise.resolve(undefined);

/** Newest first. */
export async function listMaps(): Promise<MapSummary[]> {
  const all = await tx<MapSummary[]>(["summaries"], "readonly", (t) => t.objectStore("summaries").getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMap(id: string): Promise<void> {
  await tx(["maps", "summaries"], "readwrite", (t) => {
    t.objectStore("maps").delete(id);
    t.objectStore("summaries").delete(id);
  });
}
