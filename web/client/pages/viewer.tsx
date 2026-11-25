import type { Handle } from "@remix-run/ui";

export const title = "ピクセルマップ — kimimachi";

/**
 * The game viewer. Its markup is here and its behaviour is `viewer/entry.js`, which the router
 * loads as this page's own script — so no island, and `hydrate` is false. Which map to open is the
 * URL's `#fragment`: a static file cannot see it, the browser can.
 */
export const hydrate = false;

/**
 * `viewport-fit=cover`, so `env(safe-area-inset-*)` means something on a phone with a notch.
 * No zooming: it is a game screen (with `touch-action` in viewer.css; iOS Safari ignores `user-scalable` in a tab).
 */
export const viewport = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/** `workerSrc` is where the generator worker lives: walking off the map's edge generates the next block. */
export default function Viewer(handle: Handle<{ workerSrc: string }>) {
  return () => (
    <>
      <canvas id="game"></canvas>
      <canvas id="mini" title="タップで大きさを切り替え"></canvas>
      <div class="hud" id="hud"></div>
      <div class="help" id="help">矢印/WASD: 移動　Shift: 走る　M: ミニマップ　+/-: ズーム　C: ドライブ</div>
      <div class="attr" id="attr"></div>
      <div id="loading" data-worker={handle.props.workerSrc} hidden>
        <div class="loading-panel">
          <b>Loading…</b>
          <pre id="loading-log"></pre>
        </div>
      </div>
      <div id="modebar">
        <button type="button" id="drive-toggle">🚗 ドライブ</button>
        <details id="drive-panel">
          <summary>⚙ スケール・表示</summary>
          <label>
            スケール
            <input id="drive-scale" type="range" min="0" max="1000" step="1" />
          </label>
          <button type="button" data-scale="-1">−</button>
          <button type="button" data-scale="1">＋</button>
          <output id="drive-scale-out"></output>
          <label>
            <input type="radio" name="drive-look" value="car" /> 車
          </label>
          <label>
            <input type="radio" name="drive-look" value="shadow" /> 影
          </label>
        </details>
      </div>
      <div id="pedals">
        <button type="button" data-c="left">◀</button>
        <button type="button" data-c="right">▶</button>
        <button type="button" data-c="brake">ブレーキ</button>
        <button type="button" data-c="accel">アクセル</button>
      </div>
      <div id="pad">
        <button type="button" data-d="up">▲</button>
        <button type="button" data-d="left">◀</button>
        <button type="button" data-d="right">▶</button>
        <button type="button" data-d="down">▼</button>
      </div>
    </>
  );
}
