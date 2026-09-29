/**
 * kimimachi: turn a location into a pixel-art game map.
 *
 * Pure TypeScript, no runtime-specific APIs and no dependencies: network access goes
 * through an injected {@linkcode Fetcher}, and results are plain data (plus RGBA images).
 *
 * @example
 * ```ts
 * import { encodePng, generateMap } from "@kuboon/kimimachi";
 * const { map, tileset } = await generateMap({ lat: 37.4463, lon: 138.8514, size: 1500 });
 * const png = await encodePng(tileset);
 * ```
 *
 * @module
 */
export { generateMap, SUBPX } from "./generate.ts";
export type { GeneratedMap, GenerateOptions } from "./generate.ts";
export { defaultFetcher } from "./net.ts";
export type { Fetcher } from "./net.ts";
export { KIND_COLORS, kindsImage, toTiled } from "./export.ts";
export type { GameMap, MapLabel, MapMeta } from "./export.ts";
export { renderMap, T as TILE_SIZE } from "./tileset.ts";
export type { Image } from "./tileset.ts";
export { encodePng } from "./png.ts";
export { reverseGeocode } from "./geocode.ts";
export type { Address } from "./geocode.ts";
export { KINDS } from "./abstract.ts";
export type { RailAxis, RotateMode } from "./schematic.ts";
