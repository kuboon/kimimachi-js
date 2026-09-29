/** HTML pages (plain strings; no client framework needed). */
import type { MapSummary } from "./store.ts";

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function indexPage(maps: MapSummary[]): string {
  const items = maps.map((m) =>
    `<a class="card" href="/maps/${m.id}"><img src="/maps/${m.id}/abstract.png" alt="">` +
    `<b>${esc(m.place)}</b><small>${esc(m.source)} ・ 1マス${m.tile_m}m</small></a>`
  ).join("\n");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>kimimachi</title>
<style>
:root{--bg:#16161d;--card:#23232e;--text:#f4f1e8;--muted:#b8b4a8;--accent:#f2c14e;--err:#ff7a6b}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:20px;margin:0 0 16px}
form{display:flex;flex-wrap:wrap;gap:8px;align-items:end;padding:12px;background:var(--card);border:2px solid #000;border-radius:8px;margin-bottom:12px}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
input{font:inherit;font-size:15px;padding:8px 10px;border-radius:6px;border:1px solid #555;background:#15151c;color:var(--text);width:110px}
input[name=title]{width:180px}
button{font:inherit;font-size:15px;padding:9px 16px;border-radius:6px;border:0;background:var(--accent);color:#1b1b1b;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
details{width:100%;color:var(--muted);font-size:12px}details>div{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
#status{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:var(--muted);background:#0f0f14;border-radius:6px;padding:8px 10px;margin:0 0 16px;display:none;max-height:180px;overflow:auto}
#status.err{color:var(--err)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card{display:flex;flex-direction:column;gap:4px;padding:10px;background:var(--card);border:2px solid #000;border-radius:8px;color:inherit;text-decoration:none}
.card:hover{outline:2px solid var(--accent)}.card img{width:100%;aspect-ratio:1;object-fit:cover;image-rendering:pixelated;border-radius:4px}
small{color:var(--muted)}
</style></head><body><main><h1>kimimachi — 現在地からピクセルマップ</h1>
<form id="gen">
  <label>範囲 (m)<input name="size" type="number" value="1500" min="300" max="5000" step="100"></label>
  <label>マップ名 (任意)<input name="title" placeholder="住所から自動"></label>
  <button id="here" type="button">📍 現在地からマップを作る</button>
  <details><summary>座標を直接入力</summary><div>
    <label>緯度<input name="lat" type="number" step="any" placeholder="37.4463"></label>
    <label>経度<input name="lon" type="number" step="any" placeholder="138.8514"></label>
    <button>この座標で作る</button>
  </div></details>
</form>
<pre id="status"></pre>
<div class="grid">
${items}
</div></main>
<script type="module">
const form = document.getElementById("gen"), status = document.getElementById("status");
const buttons = form.querySelectorAll("button");
const show = (t, err) => { status.style.display = "block"; status.className = err ? "err" : ""; status.textContent = t; };
const position = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error("このブラウザは位置情報に対応していません"));
  navigator.geolocation.getCurrentPosition(p => res(p.coords), e => rej(new Error("現在地を取得できませんでした: " + e.message)),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
});
async function generate(lat, lon) {
  const fd = new FormData(form);
  show("受付中…");
  const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, size: fd.get("size"), title: fd.get("title") }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "失敗しました");
  for (;;) {
    await new Promise(res => setTimeout(res, 1500));
    const s = await (await fetch("/api/jobs/" + j.id)).json();
    show((s.status === "queued" ? "順番待ち…\\n" : "") + s.log.join("\\n"));
    status.scrollTop = status.scrollHeight;
    if (s.status === "done") { location.href = s.url; return; }
    if (s.status === "error") throw new Error("生成に失敗しました（上のログを確認してください）");
  }
}
async function go(getLatLon) {
  buttons.forEach(b => b.disabled = true);
  try { const [lat, lon] = await getLatLon(); await generate(lat, lon); }
  catch (err) { show((status.textContent && status.style.display === "block" && !status.className ? status.textContent + "\\n" : "") + err.message, true); buttons.forEach(b => b.disabled = false); }
}
document.getElementById("here").addEventListener("click", () => go(async () => {
  show("現在地を取得中…"); const c = await position(); return [c.latitude, c.longitude];
}));
form.addEventListener("submit", e => { e.preventDefault(); const fd = new FormData(form);
  go(async () => { const lat = parseFloat(fd.get("lat")), lon = parseFloat(fd.get("lon"));
    if (!isFinite(lat) || !isFinite(lon)) throw new Error("緯度・経度を入力してください"); return [lat, lon]; }); });
</script></body></html>`;
}
