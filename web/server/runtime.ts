/**
 * Where the browser scripts were compiled to, resolved once.
 *
 * The bundle does not change while the server runs, and a page in `client/` cannot ask, so the
 * router resolves each entry here and hands the result to the shell.
 */

import { assets } from "./assets.ts";
import type { ClientRuntime } from "../client/layout.tsx";

const runtime = async (entrypoint: string): Promise<ClientRuntime> => {
  const entry = await assets.getScriptEntry(entrypoint);
  return { src: entry.href, preloads: entry.preloads };
};

/** The island runtime: `<script type="module">` for every page that places an island. */
export const clientRuntime = await runtime("hydration.ts");

/** The game viewer's script. A document gets one runtime: the viewer never loads `clientRuntime`. */
export const viewerRuntime = await runtime("viewer/entry.js");

/**
 * The generator worker's URL. No preloads: the worker is started by a click, never by loading a page.
 * Passed to the generator island as a prop, since only the server knows where the bundler put it.
 */
export const workerSrc = (await assets.getScriptEntry("worker.ts")).href;
