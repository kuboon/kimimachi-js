/**
 * The document shell.
 *
 * A component like any other, so everything it names is in `client/`. The one thing it cannot work
 * out — where the client scripts were compiled to — is handed to it by `server/router.tsx`.
 *
 * `bare` drops the site's header and footer, for the game viewer, which owns the whole screen.
 */

import { css, type Handle, type RemixNode } from "@remix-run/ui";

import { base, BASE_META_NAME } from "./base.ts";
import { routes } from "./routes.ts";
import { color, contentWidth } from "./tokens.ts";

/** Where a page's script lives, and what it pulls in behind it. */
export interface ClientRuntime {
  src: string;
  /** The chunks it imports, for `<link rel="modulepreload">`. */
  preloads: readonly string[];
}

export interface LayoutProps {
  title: string;
  description?: string;
  /** The page's viewport meta, for a page that lays out to the edges of a phone screen. */
  viewport?: string;
  /**
   * The script the page needs, or `null` for a page that ships no JavaScript. Required so that
   * forgetting it is a type error rather than a page whose islands never hydrate.
   */
  script: ClientRuntime | null;
  /** Skip the header, main column and footer. */
  bare?: boolean;
  /** Extra stylesheets, as URLs. */
  stylesheets?: readonly string[];
  children: RemixNode;
}

/** What every page module exports: a component, plus what the shell needs to frame it. */
export interface PageModule<Props = Record<string, never>> {
  default: (handle: Handle<Props>) => () => RemixNode;
  title: string;
  description?: string;
  /** Whether the page places a client entry, so the shell boots the island runtime for it. */
  hydrate: boolean;
  viewport?: string;
}

export function Layout(handle: Handle<LayoutProps>) {
  return () => {
    const props = handle.props;
    return (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content={props.viewport ?? "width=device-width, initial-scale=1"} />
          <title>{props.title}</title>
          {props.description ? <meta name="description" content={props.description} /> : null}
          <meta property="og:type" content="website" />
          <meta property="og:title" content={props.title} />
          {props.description ? <meta property="og:description" content={props.description} /> : null}
          {/* The deploy prefix, for the browser: see `client/base.ts`. */}
          <meta name={BASE_META_NAME} content={base} />
          <link rel="stylesheet" href={`${base}/static/app.css`} />
          {(props.stylesheets ?? []).map((href) => <link key={href} rel="stylesheet" href={href} />)}
          <link rel="icon" type="image/svg+xml" href={`${base}/static/favicon.svg`} />
          {(props.script?.preloads ?? []).map((href) => <link key={href} rel="modulepreload" href={href} />)}
        </head>
        <body>
          {props.bare ? props.children : <Shell>{props.children}</Shell>}
          {props.script ? <script type="module" src={props.script.src}></script> : null}
        </body>
      </html>
    );
  };
}

/** Everything inside `<body>` for an ordinary page: the header, the page, and the footer. */
export function Shell(handle: Handle<{ children: RemixNode }>) {
  return () => (
    <>
      <header mix={[bandStyle, headerStyle]}>
        <a mix={brandStyle} href={routes.home.href()}>kimimachi</a>
        <nav mix={navStyle}>
          <a href={routes.home.href()}>つくる</a>
          <a href={routes.about.href()}>このサイトについて</a>
        </nav>
      </header>
      <main mix={[bandStyle, mainStyle]}>{handle.props.children}</main>
      <footer mix={[bandStyle, footerStyle]}>
        <p>
          地図データ: 国土地理院最適化ベクトルタイル、3D都市モデル（Project PLATEAU）（国土交通省）を加工して作成。 詳しくは{" "}
          <a href={routes.about.href()}>出典と利用条件</a>。
        </p>
      </footer>
    </>
  );
}

// --- styles -----------------------------------------------------------------

const bandStyle = css({
  width: "100%",
  maxWidth: contentWidth,
  marginInline: "auto",
  paddingInline: "1.25rem",
});

const headerStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  paddingBlock: "1.25rem",
  borderBottom: `1px solid ${color.border}`,
});

const brandStyle = css({
  fontWeight: 700,
  fontSize: "1.1rem",
  textDecoration: "none",
  color: color.fg,
});

const navStyle = css({ display: "flex", flexWrap: "wrap", gap: "1rem" });

const mainStyle = css({ paddingBlock: "2.5rem" });

const footerStyle = css({
  paddingBlock: "2rem",
  borderTop: `1px solid ${color.border}`,
  color: color.muted,
  fontSize: "0.9rem",
});
