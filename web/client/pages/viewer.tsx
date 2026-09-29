import type { Handle } from "@remix-run/ui";

export const title = "ピクセルマップ — kimimachi";

/**
 * The game viewer. Its markup is here and its behaviour is `viewer/entry.js`, which the router
 * loads as this page's own script — so no island, and `hydrate` is false. Which map to open is the
 * URL's `#fragment`: a static file cannot see it, the browser can.
 */
export const hydrate = false;

/** `viewport-fit=cover`, so `env(safe-area-inset-*)` means something on a phone with a notch. */
export const viewport = "width=device-width, initial-scale=1, viewport-fit=cover";

export default function Viewer(_handle: Handle) {
  return () => (
    <>
      <canvas id="game"></canvas>
      <canvas id="mini"></canvas>
      <div class="hud" id="hud"></div>
      <div class="help">矢印/WASD: 移動　Shift: 走る　M: ミニマップ　+/-: ズーム</div>
      <div class="attr" id="attr"></div>
      <div id="pad">
        <button type="button" data-d="up">▲</button>
        <button type="button" data-d="left">◀</button>
        <button type="button" data-d="right">▶</button>
        <button type="button" data-d="down">▼</button>
      </div>
    </>
  );
}
