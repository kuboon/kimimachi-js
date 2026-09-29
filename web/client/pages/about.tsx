import type { Handle } from "@remix-run/ui";

import { routes } from "../routes.ts";

export const title = "このサイトについて — kimimachi";
export const description = "kimimachi の仕組みと、地図データの出典・利用条件。";

/** 文章とリンクだけなので、JavaScript は配らない。 */
export const hydrate = false;

export default function About(_handle: Handle) {
  return () => (
    <>
      <h1>このサイトについて</h1>
      <p>
        現在地の地図データを取得して「抽象化した地図」を作り、16px
        タイルのゲームマップに変換します。処理はすべてあなたのブラウザの中で行われ、
        できたマップもこのブラウザにだけ保存されます（サーバには何も送りません。地図データは国土地理院・PLATEAU から直接取得します）。
      </p>
      <p>
        <a href={routes.home.href()}>← マップをつくる</a>
      </p>

      <h2>出典・利用データ</h2>
      <p>
        生成したマップは、以下のデータを<strong>加工して作成</strong>したものです。
        公開・配布するときは、出典と、加工したことを必ず表示してください （マップの JSON の <code>meta.attribution</code>{" "}
        にも入っています）。
      </p>

      <h3>3D都市モデル（Project PLATEAU）— 国土交通省</h3>
      <ul>
        <li>使用データ: 土地利用モデル（luse）・交通（道路）モデル（tran）の MVT 配信</li>
        <li>権利: 著作権は各地方公共団体に帰属します</li>
        <li>
          利用条件: <a href="https://www.mlit.go.jp/plateau/site-policy/">PLATEAU サイトポリシー</a>{" "}
          「3. コンテンツの利用」に従います（公共データ利用規約 PDL1.0 に準拠、CC BY 4.0 と互換）。
          加工して使うときは、出典とは別に加工したことを書く必要があります。また、国土交通省が作ったかのように見せてはいけません
        </li>
        <li>
          出典表記の例（年度と市区町村はマップごとに自動で入ります）:
          <blockquote>出典：3D都市モデル（Project PLATEAU）長岡市（2024年度）（国土交通省）を加工して作成</blockquote>
        </li>
        <li>
          測量法について: PLATEAU は公共測量の成果をもとにしているため、使い方によっては測量法の手続きが必要になることがあります。
          出版物や商用で使う前に、{" "}
          <a href="https://www.mlit.go.jp/plateau/libraries/handbooks/">3D都市モデル整備のための測量マニュアル</a>を確認してください
        </li>
      </ul>

      <h3>国土地理院最適化ベクトルタイル — 国土地理院</h3>
      <ul>
        <li>
          使用データ:{" "}
          <code>
            experimental_bvmap
          </code>（建物・道路中心線・鉄道・水域・注記）と、地理院地図の逆ジオコーダ（範囲内の市区町村と、マップ名にする町丁目を調べるため）
        </li>
        <li>
          利用条件: <a href="https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html">国土地理院コンテンツ利用規約</a>
        </li>
        <li>
          出典表記:
          <blockquote>出典：国土地理院最適化ベクトルタイルを加工して作成</blockquote>
        </li>
      </ul>

      <p>
        PLATEAU
        のデータが使えない場所・環境では、国土地理院のデータだけで生成します（このとき土地利用が分からないので、地面は草地が多く、建物はすべて住宅の屋根になります）。
      </p>
    </>
  );
}
