/**
 * Pages written in Markdown.
 *
 * Everything Markdown is here: the front-matter shape, the parser, the file read, and the
 * Markdown-to-nodes step. `@kuboon/md` and `@std/front-matter` are imported from nowhere else,
 * which keeps Markdown out of the generator — it serves what this site's own code returns.
 */

import { createElement } from "@remix-run/ui";
import type { RemixNode } from "@remix-run/ui";
import { markdownToHast } from "@kuboon/md";
import { hastToElement } from "@kuboon/md/hast_to_element.ts";
import { extract } from "@std/front-matter/yaml";

/** The files live in `server/content/`, next to this one. */
const contentDir = new URL("./content/", import.meta.url);

export interface MarkdownPage {
  title: string;
  description?: string;
  /** The Markdown body as `@remix-run/ui` elements, ready to place in a page. */
  body: RemixNode;
}

/**
 * Reads `content/<name>.md`.
 *
 * `@kuboon/md` parses GitHub-flavored Markdown into a sanitized hast tree, and `hastToElement`
 * turns it into elements with *our* `createElement` — `@kuboon/md` depends on no UI library, so
 * there is one copy of the runtime, ours.
 *
 * @param name The file's name without its extension
 * @returns The page
 */
export async function readMarkdownPage(name: string): Promise<MarkdownPage> {
  const text = await Deno.readTextFile(new URL(`${name}.md`, contentDir));
  const { attrs, body } = extract(text);
  const a = attrs as Record<string, unknown>;

  return {
    title: typeof a.title === "string" ? a.title : name,
    description: typeof a.description === "string" ? a.description : undefined,
    body: hastToElement(await markdownToHast(body), createElement),
  };
}
