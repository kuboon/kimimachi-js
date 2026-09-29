import { clientEntry, css, on } from "@remix-run/ui";
import type { Handle } from "@remix-run/ui";

import { deleteMap, getMap, listMaps, putMap } from "../db.ts";
import type { MapSummary } from "../db.ts";
import type { Message, Request } from "../worker.ts";
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

    /** Runs the generator in a Web Worker and stores the result. Resolves with the new map's id. */
    const generate = (req: Request) =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker(handle.props.workerSrc, { type: "module" });
        const lines: string[] = [];
        worker.onmessage = async (e: MessageEvent<Message>) => {
          const m = e.data;
          if (m.type === "log") {
            lines.push(m.text);
            show(lines.join("\n"));
            return;
          }
          worker.terminate();
          if (m.type === "error") return reject(new Error(m.text));
          const png = (b: Uint8Array) => new Blob([b as BlobPart], { type: "image/png" });
          const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
          try {
            await putMap({
              id,
              createdAt: Date.now(),
              map: m.map,
              tileset: png(m.tileset),
              mapPng: png(m.mapPng),
              abstractPng: png(m.abstractPng),
              tmj: m.tmj,
            });
            resolve(id);
          } catch (err) {
            reject(err);
          }
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message || "生成に失敗しました"));
        };
        worker.postMessage(req);
      });

    async function go(form: HTMLFormElement, getLatLon: () => Promise<[number, number]>) {
      busy = true;
      void handle.update();
      try {
        const [lat, lon] = await getLatLon();
        // the map sources (国土地理院 / PLATEAU) only cover Japan
        if (lat < 20 || lat > 46 || lon < 122 || lon > 154) {
          throw new Error("日本国内の位置を指定してください（地図データは国土地理院・PLATEAU のため）");
        }
        const fd = new FormData(form);
        const size = Math.max(300, Math.min(3000, Number(fd.get("size")) || 1500));
        show("生成を始めます…（数秒〜数十秒かかります）");
        const id = await generate({ lat, lon, size, title: String(fd.get("title") ?? "").trim().slice(0, 60) });
        location.href = `${handle.props.viewerHref}#${id}`;
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
          <label mix={labelStyle}>
            範囲 (m)
            <input mix={inputStyle} name="size" type="number" defaultValue="1500" min="300" max="3000" step="100" />
          </label>
          <label mix={labelStyle}>
            マップ名 (任意)
            <input mix={inputStyle} name="title" placeholder="住所から自動" />
          </label>
          <button
            type="button"
            disabled={busy}
            mix={[
              buttonStyle,
              on("click", (event) => {
                const form = (event.currentTarget as HTMLButtonElement).form!;
                void go(form, async () => {
                  show("現在地を取得中…");
                  const c = await position();
                  return [c.latitude, c.longitude];
                });
              }),
            ]}
          >
            📍 現在地からマップを作る
          </button>
          <details mix={detailsStyle}>
            <summary>座標を直接入力</summary>
            <div mix={rowStyle}>
              <label mix={labelStyle}>
                緯度
                <input mix={inputStyle} name="lat" type="number" step="any" placeholder="37.4463" />
              </label>
              <label mix={labelStyle}>
                経度
                <input mix={inputStyle} name="lon" type="number" step="any" placeholder="138.8514" />
              </label>
              <button type="submit" disabled={busy} mix={buttonStyle}>この座標で作る</button>
            </div>
          </details>
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
  flexWrap: "wrap",
  gap: "0.75rem",
  alignItems: "end",
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

const detailsStyle = css({ width: "100%", color: color.muted, fontSize: "0.85rem" });

const rowStyle = css({ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginTop: "0.6rem" });

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
