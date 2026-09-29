/**
 * 国土地理院の逆ジオコーダ: 座標から市区町村コードと町丁目名を引く。
 *
 * A module of its own, with no dependencies beyond the fetcher, so a page can use it without
 * pulling the whole generator in.
 */
import { type Fetcher, fetchJson } from "./net.ts";

export { defaultFetcher } from "./net.ts";
export type { Fetcher } from "./net.ts";

const REVGEO_URL = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";

export interface Address {
  muniCd?: string;
  lv01Nm?: string;
}

/** 国土地理院の逆ジオコーダ: 市区町村コードと町丁目名。 */
export async function reverseGeocode(fetcher: Fetcher, lat: number, lon: number): Promise<Address> {
  const res = await fetchJson<{ results?: Address }>(fetcher, REVGEO_URL, {
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
  });
  return res?.results ?? {};
}
