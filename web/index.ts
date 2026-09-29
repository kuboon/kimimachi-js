import { deleteMap, getMap, listMaps, putMap } from "./db.ts";
import type { Message, Request } from "./worker.ts";

const form = document.getElementById("gen") as HTMLFormElement;
const status = document.getElementById("status") as HTMLPreElement;
const grid = document.getElementById("grid") as HTMLDivElement;
const buttons = form.querySelectorAll("button");

const show = (text: string, err = false) => {
  status.style.display = "block";
  status.className = err ? "err" : "";
  status.textContent = text;
  status.scrollTop = status.scrollHeight;
};

const position = () =>
  new Promise<GeolocationCoordinates>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("このブラウザは位置情報に対応していません"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      (e) => reject(new Error("現在地を取得できませんでした: " + e.message)),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  });

/** Runs the generator in a Web Worker and stores the result. Resolves with the new map id. */
function generate(req: Request): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const lines: string[] = [];
    worker.onmessage = async (e: MessageEvent<Message>) => {
      const m = e.data;
      if (m.type === "log") {
        lines.push(m.text);
        show(lines.join("\n"));
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.text));
      } else {
        worker.terminate();
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
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "生成に失敗しました"));
    };
    worker.postMessage(req);
  });
}

async function go(getLatLon: () => Promise<[number, number]>) {
  buttons.forEach((b) => b.disabled = true);
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
    location.href = "viewer.html#" + id;
  } catch (err) {
    show((err as Error).message, true);
    buttons.forEach((b) => b.disabled = false);
  }
}

document.getElementById("here")!.addEventListener("click", () =>
  go(async () => {
    show("現在地を取得中…");
    const c = await position();
    return [c.latitude, c.longitude];
  }));

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  go(() => {
    const lat = parseFloat(String(fd.get("lat"))), lon = parseFloat(String(fd.get("lon")));
    if (!isFinite(lat) || !isFinite(lon)) throw new Error("緯度・経度を入力してください");
    return Promise.resolve([lat, lon]);
  });
});

// ---- gallery
const urls: string[] = [];
const link = (blob: Blob | string, type: string, name: string, label: string) => {
  const a = document.createElement("a");
  const b = typeof blob === "string" ? new Blob([blob], { type }) : blob;
  a.href = URL.createObjectURL(b);
  urls.push(a.href);
  a.download = name;
  a.textContent = label;
  return a;
};

async function renderGallery() {
  urls.splice(0).forEach(URL.revokeObjectURL);
  grid.replaceChildren();
  for (const m of await listMaps()) {
    const card = document.createElement("div");
    card.className = "card";
    const open = document.createElement("a");
    open.className = "open";
    open.href = "viewer.html#" + m.id;
    const img = new Image();
    img.src = URL.createObjectURL(m.thumb);
    urls.push(img.src);
    const name = document.createElement("b");
    name.textContent = m.place;
    const sub = document.createElement("small");
    sub.textContent = `${m.source} ・ 1マス${m.tile_m}m ・ ${new Date(m.createdAt).toLocaleDateString("ja-JP")}`;
    open.append(img, name, sub);

    const tools = document.createElement("div");
    tools.className = "tools";
    const safe = m.place.replace(/[\\/:*?"<>| ]+/g, "_");
    const rec = await getMap(m.id);
    if (rec) {
      tools.append(
        link(rec.mapPng, "image/png", `${safe}.png`, "画像"),
        link(rec.tmj, "application/json", `${safe}.tmj`, "Tiled(.tmj)"),
        link(rec.tileset, "image/png", "tileset.png", "タイルセット"),
        link(JSON.stringify(rec.map), "application/json", `${safe}.json`, "JSON"),
      );
    }
    const del = document.createElement("button");
    del.className = "sub";
    del.textContent = "削除";
    del.onclick = async () => {
      if (confirm(`「${m.place}」を削除しますか？`)) {
        await deleteMap(m.id);
        await renderGallery();
      }
    };
    tools.append(del);
    card.append(open, tools);
    grid.append(card);
  }
}

await renderGallery();
