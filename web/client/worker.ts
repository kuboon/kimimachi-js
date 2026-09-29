/** Runs the (CPU heavy) generation off the main thread. */
import { encodePng, generateMap, KIND_COLORS, KINDS, kindsImage, renderMap, toTiled } from "@kuboon/kimimachi";
import type { StoredMap } from "./db.ts";

export interface Request {
  lat: number;
  lon: number;
  size: number;
  title?: string;
}

export type Message =
  | { type: "log"; text: string }
  | { type: "done"; map: StoredMap["map"]; tileset: Uint8Array; mapPng: Uint8Array; abstractPng: Uint8Array; tmj: string }
  | { type: "error"; text: string };

const ctx = self as unknown as {
  onmessage: (e: MessageEvent<Request>) => void;
  postMessage(message: Message): void;
};

ctx.onmessage = async (e) => {
  const { lat, lon, size, title } = e.data;
  try {
    const { map, tileset } = await generateMap({
      lat,
      lon,
      size,
      title: title || undefined,
      log: (text) => ctx.postMessage({ type: "log", text }),
    });
    const tileGrid = Int32Array.from(map.tileGrid), overlay = Int32Array.from(map.overlayGrid);
    ctx.postMessage({
      type: "done",
      map: { ...map, kindColors: KINDS.map((k) => [...KIND_COLORS[k]]) },
      tileset: await encodePng(tileset),
      mapPng: await encodePng(renderMap(tileGrid, map.width, tileset, overlay)),
      abstractPng: await encodePng(kindsImage(map.kindGrid, map.width, 4)),
      tmj: JSON.stringify(toTiled(map, tileset)),
    });
  } catch (err) {
    ctx.postMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
  }
};
