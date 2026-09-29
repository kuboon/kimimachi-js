# @kuboon/kimimachi

緯度経度から、ピクセルアートのゲームマップ（16px タイル）を作る変換ライブラリです。

- 純 TypeScript。依存パッケージなし、Remix などのフレームワークにも依存しません
- Deno / Node / ブラウザで動きます（標準の `fetch`・`CompressionStream` だけを使用）
- ネットワークは注入する `Fetcher` を通すので、キャッシュや User-Agent は呼び出し側で決められます

```ts
import { encodePng, generateMap, renderMap } from "@kuboon/kimimachi";

const { map, tileset } = await generateMap({
  lat: 37.4463,
  lon: 138.8514,
  size: 1500, // 切り出す幅 [m]
  fetch: myCachedFetcher, // 省略すると global fetch
  log: console.log,
});

// map: kindGrid / tileGrid / overlayGrid / labels / meta ... のプレーンなデータ
const png = await encodePng(renderMap(Int32Array.from(map.tileGrid), map.width, tileset, Int32Array.from(map.overlayGrid)));
```

## 主なオプション（`generateMap`）

| 名前                                           | 既定                   | 内容                                                  |
| ---------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `lat`, `lon`                                   | 必須                   | 中心の緯度・経度                                      |
| `size`, `height`                               | 2000                   | 幅・高さ [m]                                          |
| `tileM`                                        | 8                      | 1タイルが表す距離 [m]                                 |
| `source`                                       | `"plateau"`            | `"plateau"` は PLATEAU + 地理院、`"gsi"` は地理院のみ |
| `layout`                                       | `"schematic"`          | `"real"` で実際の形のまま                             |
| `rotate`, `railAxis`, `straighten`, `diagonal` |                        | 模式化の調整                                          |
| `title`                                        | 逆ジオコーダの町丁目名 | マップ名                                              |

## 出典

地図データは日本のもの（国土地理院最適化ベクトルタイル、Project PLATEAU）です。 生成物には出典表記が必要です。`map.meta.attribution`
に入っているので、必ず表示してください。 詳しくはリポジトリの README を参照してください。
