import { clientEntry, css, on } from "@remix-run/ui";
import type { Handle } from "@remix-run/ui";

import { gridCellAt } from "@kuboon/kimimachi/geo";
import { defaultFetcher, reverseGeocode } from "@kuboon/kimimachi/geocode";

import { deleteMap, getMap, listMaps } from "../db.ts";
import { generateCell, inJapan } from "../generate.ts";
import type { MapSummary } from "../db.ts";
import { color, radius } from "../tokens.ts";

/** Named for what the server hands it: URLs only the server can work out. */
interface Props {
  /** The compiled Web Worker that generates a map. */
  workerSrc: string;
  /** The viewer page's URL, without the `#id`. */
  viewerHref: string;
}

interface Card {
  summary: MapSummary;
  thumb: string;
}

/**
 * The whole app: where you are, the form, and the maps this browser has made.
 *
 * Generation runs in a Web Worker; the result is stored in IndexedDB and opened in the viewer.
 * Nothing is sent to a server — the map data is fetched by the browser straight from 国土地理院 and
 * PLATEAU. On the server (the static build) this renders the empty form; the maps arrive once it
 * hydrates.
 */
export const Generator = clientEntry(
  import.meta.url,
  function Generator(handle: Handle<Props>) {
    let busy = false;
    let status = "";
    let failed = false;
    let cards: Card[] = [];
    /** 「住所から自動」: while on, the name field is read-only and follows the coordinates. */
    let autoName = true;
    /** The coordinates the name was last looked up for, so a plain blur does not ask again. */
    let nameKey = "";
    let nameSeq = 0;

    const show = (text: string, err = false) => {
      status = text;
      failed = err;
      void handle.update();
    };

    async function refresh() {
      cards.forEach((c) => URL.revokeObjectURL(c.thumb));
      cards = (await listMaps()).map((summary) => ({ summary, thumb: URL.createObjectURL(summary.thumb) }));
      void handle.update();
    }
    handle.signal.addEventListener("abort", () => cards.forEach((c) => URL.revokeObjectURL(c.thumb)));
    // Runs in the browser only, after the first commit.
    handle.queueTask(() => refresh());

    const position = () =>
      new Promise<GeolocationCoordinates>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("このブラウザは位置情報に対応していません"));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(p.coords),
          (e) => reject(new Error("現在地を取得できませんでした: " + e.message)),
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
        );
      });

    const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement;

    /**
     * Fills the name field with the address of the coordinates in the form (国土地理院の逆ジオコーダ).
     * Does nothing unless 「住所から自動」 is on, and skips coordinates it has already looked up.
     */
    async function fillName(form: HTMLFormElement, force = false) {
      if (!autoName) return;
      const lat = parseFloat(field(form, "lat").value), lon = parseFloat(field(form, "lon").value);
      const name = field(form, "title");
      if (!isFinite(lat) || !isFinite(lon)) return;
      const key = `${lat},${lon}`;
      if (!force && key === nameKey) return;
      nameKey = key;
      const seq = ++nameSeq; // a slower, older lookup must not overwrite a newer one
      name.value = "";
      name.placeholder = "住所を取得中…";
      const address = await reverseGeocode(defaultFetcher, lat, lon).catch(() => ({ lv01Nm: undefined }));
      if (seq !== nameSeq || !autoName) return;
      name.value = address.lv01Nm ?? "";
      name.placeholder = address.lv01Nm ? "" : "住所を取得できませんでした（作るときに再度試します）";
    }

    /** Fills the coordinate fields from the device's position, so they can be adjusted before generating. */
    async function locate(form: HTMLFormElement) {
      busy = true;
      show("現在地を取得中…");
      try {
        const c = await position();
        field(form, "lat").value = c.latitude.toFixed(6);
        field(form, "lon").value = c.longitude.toFixed(6);
        await fillName(form);
        show("現在地を入力しました。必要なら座標を調整して「この座標で作る」を押してください。");
      } catch (err) {
        show((err as Error).message, true);
      }
      busy = false;
      void handle.update();
    }

    async function go(form: HTMLFormElement, getLatLon: () => Promise<[number, number]>) {
      busy = true;
      void handle.update();
      try {
        const [lat, lon] = await getLatLon();
        if (!inJapan(lat, lon)) {
          throw new Error("日本国内の位置を指定してください（地図データは国土地理院・PLATEAU のため）");
        }
        // the map is the grid cell containing the point; its neighbours are generated on demand in the viewer
        const cell = gridCellAt(lat, lon);
        const lines = ["生成を始めます…（数秒〜数十秒かかります）"];
        show(lines.join("\n"));
        const title = String(new FormData(form).get("title") ?? "").trim().slice(0, 60);
        const rec = await generateCell(handle.props.workerSrc, cell.i, cell.j, {
          title: title || undefined,
          log: (text) => {
            lines.push(text);
            show(lines.join("\n"));
          },
        });
        location.href = `${handle.props.viewerHref}#${rec.id}`;
      } catch (err) {
        show((err as Error).message, true);
        busy = false;
        void handle.update();
      }
    }

    const download = async (id: string, kind: "png" | "tmj" | "tileset" | "json") => {
      const rec = await getMap(id);
      if (!rec) return;
      const safe = rec.map.meta.place.replace(/[\\/:*?"<>| ]+/g, "_");
      const [blob, name]: [Blob, string] = {
        png: [rec.mapPng, `${safe}.png`],
        tmj: [new Blob([rec.tmj], { type: "application/json" }), `${safe}.tmj`],
        tileset: [rec.tileset, "tileset.png"],
        json: [new Blob([JSON.stringify(rec.map)], { type: "application/json" }), `${safe}.json`],
      }[kind] as [Blob, string];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    };

    return () => (
      <div>
        <form
          // Coordinates are checked in `go()`; native validation would flag a 6-digit value as a step mismatch.
          noValidate
          mix={[
            formStyle,
            on("submit", (event) => {
              event.preventDefault();
              const form = event.currentTarget as HTMLFormElement;
              const fd = new FormData(form);
              void go(form, () => {
                const lat = parseFloat(String(fd.get("lat"))), lon = parseFloat(String(fd.get("lon")));
                if (!isFinite(lat) || !isFinite(lon)) throw new Error("緯度・経度を入力してください");
                return Promise.resolve([lat, lon]);
              });
            }),
          ]}
        >
          <div mix={coordsStyle}>
            <label mix={labelStyle}>
              マップ名
              <input
                mix={[inputStyle, wideStyle]}
                name="title"
                readOnly={autoName}
                placeholder={autoName ? "座標から自動で入ります" : "マップ名（空なら住所）"}
              />
            </label>
            <label mix={checkLabelStyle}>
              <input
                type="checkbox"
                defaultChecked
                mix={on("change", (event) => {
                  autoName = (event.currentTarget as HTMLInputElement).checked;
                  const form = (event.currentTarget as HTMLInputElement).form!;
                  void handle.update();
                  // Turning it back on refreshes the name for the current coordinates.
                  if (autoName) void fillName(form, true);
                })}
              />
              住所から自動
            </label>
          </div>
          <div mix={coordsStyle}>
            <label mix={labelStyle}>
              緯度
              <input
                mix={[
                  inputStyle,
                  on("blur", (event) => void fillName((event.currentTarget as HTMLInputElement).form!)),
                ]}
                name="lat"
                type="number"
                step="0.001"
                placeholder="37.4463"
              />
            </label>
            <label mix={labelStyle}>
              経度
              <input
                mix={[
                  inputStyle,
                  on("blur", (event) => void fillName((event.currentTarget as HTMLInputElement).form!)),
                ]}
                name="lon"
                type="number"
                step="0.001"
                placeholder="138.8514"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              mix={[
                secondaryButtonStyle,
                on("click", (event) => {
                  const form = (event.currentTarget as HTMLButtonElement).form!;
                  void locate(form);
                }),
              ]}
            >
              📍 現在地を取得
            </button>
            <button type="submit" disabled={busy} mix={buttonStyle}>この座標で作る</button>
          </div>
        </form>

        {status ? <pre mix={[statusStyle, failed ? errorStyle : undefined]}>{status}</pre> : null}

        <div mix={gridStyle}>
          {cards.map(({ summary, thumb }) => (
            <div key={summary.id} mix={cardStyle}>
              <a mix={openStyle} href={`${handle.props.viewerHref}#${summary.id}`} data-rmx-document="">
                <img mix={thumbStyle} src={thumb} alt="" />
                <b>{summary.place}</b>
                <small mix={mutedStyle}>
                  {summary.source} ・ 1マス{summary.tile_m}m ・ {new Date(summary.createdAt).toLocaleDateString("ja-JP")}
                </small>
              </a>
              <div mix={toolsStyle}>
                {(["png", "tmj", "tileset", "json"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    mix={[smallButtonStyle, on("click", () => void download(summary.id, kind))]}
                  >
                    {{ png: "画像", tmj: "Tiled", tileset: "タイルセット", json: "JSON" }[kind]}
                  </button>
                ))}
                <button
                  type="button"
                  mix={[
                    smallButtonStyle,
                    on("click", async () => {
                      if (confirm(`「${summary.place}」を削除しますか？`)) {
                        await deleteMap(summary.id);
                        await refresh();
                      }
                    }),
                  ]}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

// --- styles -----------------------------------------------------------------

const formStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  alignItems: "start",
  padding: "1rem",
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
});

const labelStyle = css({ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8rem", color: color.muted });

const inputStyle = css({
  font: "inherit",
  width: "8rem",
  padding: "0.45rem 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
  color: color.fg,
});

const buttonStyle = css({
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  padding: "0.55rem 1rem",
  border: `1px solid ${color.accent}`,
  borderRadius: radius.md,
  background: color.accent,
  color: color.onAccent,
  "&:disabled": { opacity: 0.5, cursor: "default" },
});

const coordsStyle = css({ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" });

const checkLabelStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "0.35rem",
  fontSize: "0.85rem",
  color: color.muted,
  paddingBottom: "0.55rem",
});

const wideStyle = css({ width: "100%", maxWidth: "20rem" });

const secondaryButtonStyle = css({
  font: "inherit",
  cursor: "pointer",
  padding: "0.55rem 1rem",
  border: `1px solid ${color.accent}`,
  borderRadius: radius.md,
  background: "transparent",
  color: color.accent,
  "&:disabled": { opacity: 0.5, cursor: "default" },
});

const statusStyle = css({
  whiteSpace: "pre-wrap",
  font: "0.8rem/1.5 ui-monospace, monospace",
  color: color.muted,
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  padding: "0.6rem 0.8rem",
  margin: "1rem 0",
  maxHeight: "11rem",
  overflow: "auto",
});

const errorStyle = css({ color: "#dc2626" });

const gridStyle = css({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
  gap: "1rem",
  marginTop: "1.5rem",
});

const cardStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  padding: "0.6rem",
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  "&:hover": { borderColor: color.accent },
});

const openStyle = css({ display: "flex", flexDirection: "column", gap: "0.2rem", color: "inherit", textDecoration: "none" });

const thumbStyle = css({
  width: "100%",
  aspectRatio: "1",
  objectFit: "cover",
  imageRendering: "pixelated",
  borderRadius: radius.sm,
});

const mutedStyle = css({ color: color.muted });

const toolsStyle = css({ display: "flex", flexWrap: "wrap", gap: "0.25rem" });

const smallButtonStyle = css({
  font: "inherit",
  fontSize: "0.72rem",
  cursor: "pointer",
  padding: "0.1rem 0.4rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: "transparent",
  color: color.muted,
  "&:hover": { borderColor: color.accent, color: color.accent },
});
