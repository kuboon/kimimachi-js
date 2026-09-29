/**
 * The client runtime, started once per document.
 *
 * `run()` walks the document for the hydration markers `renderToStream` emitted and hydrates each
 * one, importing the module the server named for it. The shell loads this as a
 * `<script type="module">` on the pages that place an island, and on no other.
 */

import { run } from "@remix-run/ui";

import { routes } from "./routes.ts";
import { guardBrowserNavigations } from "./navigation-guard.ts";

guardBrowserNavigations({
  // The viewer starts its own script, so it has to be entered by a document load: a soft
  // navigation would reconcile its markup into this document and never run that script.
  isDocument: (url) => url.pathname.replace(/\/$/, "") === routes.viewer.href().replace(/\/$/, ""),
});

run({
  loadModule: async (moduleUrl, exportName) => {
    const module = await import(moduleUrl) as Record<string, unknown>;
    const picked = module[exportName];
    if (typeof picked !== "function") {
      throw new Error(`Module "${moduleUrl}" has no function export "${exportName}".`);
    }
    return picked;
  },
});
