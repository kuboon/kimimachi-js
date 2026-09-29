/**
 * The browser modules, compiled as one graph.
 *
 * Every entrypoint below goes into a single `Deno.bundle({ codeSplitting: true })` call, so a module
 * two of them import — the Remix UI runtime, the map database — is emitted once, into a chunk both
 * share. The generator library (`@kuboon/kimimachi`) is only ever reached from the worker.
 */

import { createAssetServer } from "@remix-kbn/assets-deno";

import { base } from "../client/base.ts";

/** The directory every entrypoint below, and every `clientEntry()` id, is resolved against. */
const clientDir = new URL("../client/", import.meta.url);

/** Where the chunks are served, and where `entryUrl()` resolves against. */
export const assetsPath = `${base}/assets`;

export const assets = await createAssetServer({
  rootDir: decodeURIComponent(clientDir.pathname),
  entrypoints: [
    // The island runtime. Every page that hydrates loads this one.
    "hydration.ts",
    // Every island, by where it is rather than by name.
    "islands/*.tsx",
    // The game viewer: an entrypoint of its own, not an island. It is this page's whole script.
    "viewer/entry.js",
    // The map generator, run in a Web Worker. Nothing places it: the generator island starts it by URL.
    "worker.ts",
  ],
  basePath: assetsPath,
  mode: "bundle",
  // Source maps would double the file count of a static deploy for no gain.
  bundle: { sourcemap: "none" },
});
