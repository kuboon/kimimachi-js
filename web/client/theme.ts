/**
 * The `css(...)` mixins more than one module uses.
 *
 * Every rule here is a mixin from `@remix-run/ui`; what a mixin cannot do is choose its cascade
 * layer, so the layer order and the token values live in `static/app.css`, and `./tokens.ts` names
 * them. What belongs in this file is what more than one module uses — a style used in one place
 * belongs next to the markup it dresses.
 */

import { css } from "@remix-run/ui";

import { color, radius } from "./tokens.ts";

/**
 * Typography for a tree of elements this site never writes: the Markdown articles.
 *
 * A stylesheet would reach these with bare element selectors, and would then be styling every
 * `<table>` on the site. Nesting under the one class on the article wrapper says the same thing
 * locally, and it stops at the article.
 */
export const proseStyle = css({
  "& h2, & h3, & h4": { lineHeight: 1.25, marginBlock: "2rem 0.5rem" },
  "& h2": { fontSize: "1.5rem" },
  "& h3": { fontSize: "1.2rem" },
  "& p, & ul, & ol": { marginBlock: "1rem" },
  "& li": { marginBlock: "0.3rem" },
  "& a": { textDecorationThickness: "1px", textUnderlineOffset: "2px" },
  // @kuboon/md wraps every heading in its own anchor link. Left to the base layer's default it
  // would paint each heading accent-blue and underline it.
  "& :is(h1, h2, h3, h4, h5, h6) a": {
    color: "inherit",
    textDecoration: "none",
  },
  "& :is(h1, h2, h3, h4, h5, h6) a:hover": { textDecoration: "underline" },
  "& img": { maxWidth: "100%", height: "auto", borderRadius: radius.md },
  "& blockquote": {
    margin: "1.5rem 0",
    paddingInlineStart: "1rem",
    borderInlineStart: `3px solid ${color.border}`,
    color: color.muted,
  },
  "& hr": {
    border: 0,
    borderTop: `1px solid ${color.border}`,
    marginBlock: "2rem",
  },
  "& table": {
    width: "100%",
    borderCollapse: "collapse",
    marginBlock: "1.5rem",
  },
  "& th, & td": {
    padding: "0.4rem 0.6rem",
    borderBottom: `1px solid ${color.border}`,
    textAlign: "left",
  },
  // Shiki paints the block itself, inline, so all this owes a code block is room to breathe and
  // somewhere to scroll. The inner <code> has to give back what the base layer's `code` gave it,
  // or a light chip sits on top of a dark block.
  "& pre": {
    marginBlock: "1.5rem",
    padding: "0.9rem 1rem",
    borderRadius: radius.md,
    overflowX: "auto",
    fontSize: "0.85rem",
    lineHeight: 1.5,
  },
  "& pre code": { background: "none", padding: 0, fontSize: "inherit" },
});
