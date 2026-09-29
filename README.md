# kimimachi — 現在地 → ピクセルゲームマップ

ブラウザで現在地を取得すると、その場所の地図データから「抽象化した地図」を作り、16px
タイルのゲームマップに変換して、歩き回れるビューアで開きます。

- `packages/mapgen/` — 変換ライブラリ（`@kuboon/kimimachi`、JSR 公開用）。Remix にも Deno にも依存しない純 TypeScript
  で、依存パッケージはありません
- `server/` — Deno + Remix v3（`@remix-run/fetch-router`）の Web サーバ。生成ジョブとビューアの配信
- `python/` — 元の Python 実装（地名検索つき CLI）。そのまま残してあります（[python/README.md](python/README.md)）

## 使い方（サーバ）

```bash
deno task --cwd server serve        # http://localhost:8891
```

トップページの「📍 現在地からマップを作る」を押すと、ブラウザの Geolocation で緯度経度を取り、`POST /api/generate` でジョブを登録します。
`GET /api/jobs/<id>` で進捗を見て、終わるとビューア（`/maps/<id>`）を開きます。位置情報が使えないときは、座標を直接入力することもできます。

- 生成物は `.data/out/<id>/`、取得した地図データのキャッシュは `.data/cache/`（場所は環境変数 `KIMIMACHI_DATA` で変更）
- 地図データが日本のものなので、日本国外の座標は受け付けません
- ジョブは 1 つずつ順に実行します
- 権限は `server/deno.json` の `permissions`（通信先ホスト・読み書きするパス）に絞ってあります。データ元のホストを増やすときはここに追加してください

## 使い方（ライブラリ）

```ts
import { encodePng, generateMap, renderMap } from "@kuboon/kimimachi";

const { map, tileset } = await generateMap({ lat: 37.4463, lon: 138.8514, size: 1500 });
const png = await encodePng(renderMap(Int32Array.from(map.tileGrid), map.width, tileset));
```

ネットワークは注入できる `Fetcher`（`(url) => Promise<Uint8Array | null>`）経由なので、キャッシュや User-Agent
の付与は呼び出し側で決められます。 詳細は [packages/mapgen/README.md](packages/mapgen/README.md)。

## パイプライン

1. **地図取得 → 意味画像化**（1px = tile_m/8 m）
   - `plateau`（既定）: 範囲内の市区町村を地理院の逆ジオコーダで調べ、PLATEAU の土地利用 (luse) と道路 (tran) の MVT
     を取得。建物・鉄道・水域・注記は国土地理院ベクトルタイルで補う。PLATEAU がない都市、または接続できないときは自動で `gsi` に切り替える
   - `gsi`: 国土地理院ベクトルタイルだけを使う（全国で使えるが土地被覆がないので、草地が多めになる）
2. **模式化**（既定 `layout: "schematic"`）— 斜めの道が最も少なくなる角度に回転し、道路・線路をグラフにして水平／垂直／45°
   に整列、その変位場で建物・土地利用・川・地名を一緒に動かす。`layout: "real"` なら実際の形のまま
3. **抽象化** — 8×8px ごとに占有率を見てタイル種別を決める（道路・線路は中心線が通るマスを必ず含める、橋・踏切の判定、家の 2×3 分割など）
4. **タイル化** — 手続き生成の 16px タイルセットで、水・道路・線路・森・建物を 4 近傍マスクでオートタイル。45°
   の道は斜めパーツを重ね描き用レイヤーに置く

## 出力（`.data/out/<id>/`）

| ファイル                            | 内容                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `map.json`                          | ゲーム用の簡易データ（kindGrid, tileGrid, overlayGrid, labels, blockingKinds, meta）                                          |
| `map.tmj` + `tileset.png`           | Tiled 形式（`ground` と、斜めパーツ用の `overlay` の2レイヤー。タイルに `kind` / `collides` プロパティ、地名は object layer） |
| `map.png`                           | マップ全体の画像                                                                                                              |
| `semantic_map.png` / `abstract.png` | 中間画像（意味画像 / 1マス=4px の種別画像）                                                                                   |

## 開発

```bash
deno task test     # ライブラリのテスト
deno task check    # 型チェック・lint・fmt
```

Python 版からの変更点:

- 地名検索（Nominatim）は廃止し、現在地（緯度経度）を入力にした
- Google Static Maps ソースは移植していない（規約上、検証用だったため）
- 乱数は Python (numpy) とは別の実装なので、タイルの細かい模様は Python 版と一致しない

## 出典・利用データ

このツールが生成するマップ（`.data/out/<id>/` の PNG・`map.tmj`・`map.json`）は、以下のデータを**加工して作成**したものです。
マップを公開・配布するときは、ここに書いた出典と、加工したことを必ず表示してください。
生成したマップには出典が自動で入ります（ビューアの右下、`map.json` の `meta.attribution`、`map.tmj` の map プロパティ）。

### 3D都市モデル（Project PLATEAU）— 国土交通省

- 使用データ: 土地利用モデル（luse）・交通（道路）モデル（tran）の MVT 配信
  （[PLATEAU データカタログAPI](https://api.plateau.reearth.io/datacatalog/plateau-datasets) と
  [G空間情報センター](https://www.geospatial.jp/ckan/dataset/plateau) で公開されているもの）
- 権利: 著作権は各地方公共団体に帰属します
- 利用条件: [PLATEAU サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)「3. コンテンツの利用」に従います。
  これは[公共データ利用規約（第1.0版）（PDL1.0）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)に準拠し、CC BY 4.0
  と互換です。 加工して使うときは、出典とは別に加工したことを書く必要があります。また、国土交通省が作ったかのように見せてはいけません
- 出典表記の例（年度と市区町村はマップごとに自動で入ります）:

  > 出典：3D都市モデル（Project PLATEAU）長岡市（2024年度）（国土交通省）を加工して作成

- 測量法について: PLATEAU は公共測量の成果をもとにしているため、使い方によっては測量法の手続きが必要になることがあります。
  出版物や商用で使う前に、[3D都市モデル整備のための測量マニュアル](https://www.mlit.go.jp/plateau/libraries/handbooks/)を確認してください

### 国土地理院最適化ベクトルタイル — 国土地理院

- 使用データ: `experimental_bvmap`（建物・道路中心線・鉄道・水域・注記）
  （[gsi-cyberjapan/optimal_bvmap](https://github.com/gsi-cyberjapan/optimal_bvmap)）
- 利用条件: [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
- 出典表記:

  > 出典：国土地理院最適化ベクトルタイルを加工して作成

- あわせて地理院地図の逆ジオコーダ（`mreversegeocoder.gsi.go.jp`）も使っています （範囲内の市区町村と、マップ名にする町丁目を調べるため）

### まとめて書く場合の例

```
出典：3D都市モデル（Project PLATEAU）長岡市（2024年度）（国土交通省）、国土地理院最適化ベクトルタイル を加工して作成
```

## 注意

- このリポジトリのソースコード自体のライセンスはまだ決めていません
