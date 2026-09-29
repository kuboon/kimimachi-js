/**
 * The site, wired by hand.
 *
 * `client/routes.ts` states every URL; this file maps each to the page that renders it. The pages
 * and the islands they place live in `client/`, the half of the workspace type-checked without
 * `deno.ns`; this half has the runtime — the file reads, the bundler, the environment.
 *
 * What is exported is a plain `@remix-run/fetch-router` router. `deno serve router.tsx` runs it as
 * the dev server and the build crawls the same object; both need only `fetch`.
 */

import { createController, createRouter, type RouterContext } from "@remix-run/fetch-router";
import { render } from "@remix-run/render-middleware";
import { createFileTree, githubPages } from "@remix-kbn/ssg/site";
import type { FileServerBehavior } from "@remix-kbn/ssg/site";
import { stripBase } from "@remix-kbn/ssg/base";

import { assets, assetsPath } from "./assets.ts";
import { readMarkdownPage } from "./markdown.ts";
import { clientRuntime, viewerRuntime, workerSrc } from "./runtime.ts";
import { base } from "../client/base.ts";
import { Layout } from "../client/layout.tsx";
import { routes } from "../client/routes.ts";

import * as About from "../client/pages/about.tsx";
import * as Home from "../client/pages/index.tsx";
import * as Viewer from "../client/pages/viewer.tsx";

/** Deploy path prefix. The build strips it back off when writing, so output lands at the root. */
export { base };

/** Where this deploys. The build writes the file this rule would serve. */
export const fileServer: FileServerBehavior = githubPages();

/** The files under `client/static/`, served verbatim at their own names. */
const staticFiles = await createFileTree({
  rootDir: `${import.meta.dirname}/../client/static`,
  basePath: `${base}/static`,
  cacheControl: "public, max-age=3600",
});

/** `render({ assets })` puts `context.render(node)` on every request. */
const router = createRouter({ middleware: [render({ assets })] });

/** The request context those middlewares produce — `context.render`, in practice. */
export type AppContext = RouterContext<typeof router>;

declare module "@remix-run/fetch-router" {
  interface RouterTypes {
    context: AppContext;
  }
}

const pages = createController(routes, {
  actions: {
    home: (context) =>
      context.render(
        <Layout title={Home.title} description={Home.description} script={Home.hydrate ? clientRuntime : null}>
          <Home.default workerSrc={workerSrc} />
        </Layout>,
      ),
    about: async (context) => {
      // Written in Markdown: `server/content/about.md`. Read on each request, so editing it in the
      // dev server is a reload away; the build reads it once.
      const page = await readMarkdownPage("about");
      return context.render(
        <Layout title={page.title} description={page.description} script={About.hydrate ? clientRuntime : null}>
          <About.default body={page.body} />
        </Layout>,
      );
    },
    viewer: (context) =>
      context.render(
        <Layout
          title={Viewer.title}
          viewport={Viewer.viewport}
          // Its own script, not the island runtime: see `client/pages/viewer.tsx`.
          script={viewerRuntime}
          stylesheets={[`${base}/static/viewer.css`]}
          bare
        >
          <Viewer.default workerSrc={workerSrc} />
        </Layout>,
      ),
  },
});

router.map(routes, pages);

// A directory answers reads: `get` rather than `map`.
router.get(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request));
router.get(`${assetsPath}/*path`, ({ request }) => assets.fetch(request));

/**
 * Where the crawl starts. Everything else is reached by following links.
 *
 * The viewer is here because nothing on the static pages links to it — the gallery that does is
 * rendered in the browser. So is the worker: it is started by URL, which a crawler never sees.
 */
export const entryPoints: readonly string[] = [
  "/",
  "/viewer",
  `/${stripBase(workerSrc, base)}`,
];

export default router;
