import type { Handle, RemixNode } from "@remix-run/ui";

import { proseStyle } from "../theme.ts";

/**
 * A page written in Markdown. `server/content/about.md` holds the text and its front matter; the
 * server renders the body to nodes and hands it here, along with the title and description it
 * puts in `<head>` — so this screen only places it and dresses it with `proseStyle`.
 */
export interface AboutProps {
  body: RemixNode;
}

/** Prose only — no island, so this page ships no JavaScript at all. */
export const hydrate = false;

export default function About(handle: Handle<AboutProps>) {
  return () => <article mix={proseStyle}>{handle.props.body}</article>;
}
