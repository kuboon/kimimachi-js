/** Every URL this site answers, in one place. `router.tsx` maps them to pages. */
import { get, route } from "@remix-run/fetch-router/routes";

import { base } from "./base.ts";

export const routes = route(base, {
  home: get("/"),
  about: get("/about"),
  /** The game viewer. Which map to open is the URL's `#fragment`, which a static file cannot see and the browser can. */
  viewer: get("/viewer"),
});
