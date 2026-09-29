import { css, type Handle } from "@remix-run/ui";

import { routes } from "../routes.ts";
import { Generator } from "../islands/generator.tsx";
import { color } from "../tokens.ts";

export const title = "kimimachi — 現在地からピクセルマップ";
export const description = "現在地の地図データから、歩き回れる 16px タイルのゲームマップをブラウザの中で作ります。";

/** The generator is an island, so the shell boots the runtime for this page. */
export const hydrate = true;

/** Takes what only the server knows: where the compiled worker is. */
export default function Home(handle: Handle<{ workerSrc: string }>) {
  return () => (
    <>
      <h1>現在地からピクセルマップ</h1>
      <p mix={leadStyle}>
        ブラウザで現在地を取得し、その場所の地図データからゲームマップを作ります。作ったマップは歩き回れます。
        処理はすべてこのブラウザの中で行われ、マップもこのブラウザにだけ保存されます。日本国内のみ。
      </p>
      <p mix={leadStyle}>
        <a href="https://github.com/shi3z/kimimachi">shi3z/kimimachi</a>{" "}
        の Python 版を fork して TypeScript に書き換え、ブラウザ上ですべて生成するようにしました。
      </p>
      <Generator workerSrc={handle.props.workerSrc} viewerHref={routes.viewer.href()} />
    </>
  );
}

const leadStyle = css({ color: color.muted });
