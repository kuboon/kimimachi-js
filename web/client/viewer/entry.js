// deno-lint-ignore-file
import { getMap } from "../db.ts";
import { getOrGenerateCell } from "../generate.ts";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WORKER = document.getElementById("loading")?.dataset.worker ?? "";
const rec0 = await getMap(location.hash.slice(1));
if (!rec0) {
  document.body.innerHTML = '<p style="padding:24px;color:#f4f1e8">このマップはこのブラウザに保存されていません。<a style="color:#f2c14e" href="'+(document.querySelector('meta[name=rmx-base]')?.content ?? "")+'/">一覧へ戻る</a></p>';
  throw new Error("map not found");
}
const KIND_JA = { grass: "草地", forest: "森", paddy: "田んぼ", field: "畑", water: "川・水辺", road: "道路", bridge: "橋",
  rail: "線路", rail_bridge: "鉄橋", crossing: "踏切", park: "公園", parking: "駐車場", yard: "住宅地", plaza: "広場・敷地",
  bare: "空き地", house: "家", shop: "店・ビル", factory: "工場", public: "公共施設",
  road_diag: "斜めの道", rail_diag: "線路" };
// the map being played; `applyMap` swaps it (walking off the edge of a grid cell loads the neighbour)
let MAP, TS, COLS, ROWS, GRID, blocking, tiles;
const kindAt = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? -1 : MAP.kindGrid[y * COLS + x];
const walkable = (x, y) => { const k = kindAt(x, y); return k >= 0 && !blocking.has(k); };

const cv = document.getElementById("game"), ctx = cv.getContext("2d");
const mini = document.getElementById("mini"), mctx = mini.getContext("2d");
let zoom = Math.max(2, Math.round(Math.min(innerWidth, innerHeight) / 300));
let showMini = true;

function resize() {
  const dpr = devicePixelRatio || 1;
  cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr);
  cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
  ctx.imageSmoothingEnabled = false;
}
addEventListener("resize", resize); resize();

// ---- minimap (1px per tile)
const miniBase = document.createElement("canvas");
let MS = 1;
function sizeMini() {
  // about a third of the screen, up to 360px on the long side
  const target = Math.min(360, Math.max(160, Math.min(innerWidth, innerHeight) * 0.45));
  MS = target / Math.max(COLS, ROWS);
  const dpr = devicePixelRatio || 1;
  mini.width = Math.round(COLS * MS * dpr); mini.height = Math.round(ROWS * MS * dpr);
  mini.style.width = Math.round(COLS * MS) + "px"; mini.style.height = Math.round(ROWS * MS) + "px";
}
addEventListener("resize", sizeMini);

const player = { x: 0, y: 0, px: 0, py: 0, dir: "down", t: 0, moving: false, from: null };
/** The walkable tile nearest (cx, cy), preferring roads (a road first within the same ring). */
function nearestWalkable(cx, cy, roadOnly) {
  const road = MAP.kinds.indexOf("road");
  for (let r = 0; r < Math.max(COLS, ROWS); r++) {
    let best = null;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
      const k = kindAt(x, y);
      if (k < 0 || (roadOnly ? k !== road : blocking.has(k))) continue;
      if (!best || (k === road && kindAt(...best) !== road)) best = [x, y];
    }
    if (best) return best;
  }
  return null;
}
function placePlayer(x, y) { player.x = x; player.y = y; player.px = x; player.py = y; player.moving = false; }
/** First visit: start at the station closest to the map centre if there is one, on the nearest road. */
function startPlayer() {
  let cx = COLS >> 1, cy = ROWS >> 1;
  const st = MAP.labels.filter(l => l.kind === "station")
    .sort((a, b) => Math.hypot(a.tile[0] - cx, a.tile[1] - cy) - Math.hypot(b.tile[0] - cx, b.tile[1] - cy))[0];
  if (st) { cx = Math.round(st.tile[0]); cy = Math.round(st.tile[1]); }
  const [x, y] = nearestWalkable(cx, cy, true) || nearestWalkable(cx, cy) || [cx, cy];
  placePlayer(x, y);
}

/** Makes `rec` the map being played. Resolves once its tileset has loaded. */
function applyMap(rec) {
  const old = tiles;
  MAP = rec.map; GRID = rec.grid || null;
  TS = MAP.tileSize; COLS = MAP.width; ROWS = MAP.height;
  blocking = new Set(MAP.blockingKinds.map(k => MAP.kinds.indexOf(k)));
  document.title = MAP.meta.place + " ピクセルマップ";
  document.getElementById("attr").textContent = "出典: " + MAP.meta.attribution + " を加工して作成";
  miniBase.width = COLS; miniBase.height = ROWS;
  const c = miniBase.getContext("2d"), img = c.createImageData(COLS, ROWS);
  MAP.kindGrid.forEach((k, i) => { const col = MAP.kindColors[k]; img.data.set([col[0], col[1], col[2], 255], i * 4); });
  c.putImageData(img, 0, 0);
  sizeMini();
  return new Promise(resolve => {
    const t = new Image();
    t.onload = () => { tiles = t; if (old) URL.revokeObjectURL(old.src); resolve(); };
    t.src = URL.createObjectURL(rec.tileset);
  });
}
await applyMap(rec0);
startPlayer();

const keys = new Set();
addEventListener("keydown", e => {
  keys.add(e.key.toLowerCase());
  if (e.key === "m" || e.key === "M") { showMini = !showMini; mini.style.display = showMini ? "" : "none"; }
  if (e.key === "+" || e.key === "=") zoom = Math.min(8, zoom + 1);
  if (e.key === "-") zoom = Math.max(1, zoom - 1);
  if (e.key.startsWith("Arrow")) e.preventDefault();
});
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
const padHeld = new Set();
// a long press on the pad must not select text or open the context menu
document.getElementById("pad").addEventListener("contextmenu", e => e.preventDefault());
document.querySelectorAll("#pad button").forEach(b => {
  const d = b.dataset.d;
  b.addEventListener("pointerdown", e => { e.preventDefault(); padHeld.add(d); b.setPointerCapture(e.pointerId); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => b.addEventListener(ev, () => padHeld.delete(d)));
});
function wantDir() {
  const k = keys;
  if (k.has("arrowup") || k.has("w") || padHeld.has("up")) return "up";
  if (k.has("arrowdown") || k.has("s") || padHeld.has("down")) return "down";
  if (k.has("arrowleft") || k.has("a") || padHeld.has("left")) return "left";
  if (k.has("arrowright") || k.has("d") || padHeld.has("right")) return "right";
  return null;
}
const DV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function update(dt) {
  if (fx) return;
  const speed = (keys.has("shift") ? 9 : 4.5);
  if (player.moving) {
    player.t += dt * speed;
    if (player.t >= 1) { player.moving = false; player.px = player.x; player.py = player.y; }
    else { player.px = player.from[0] + (player.x - player.from[0]) * player.t; player.py = player.from[1] + (player.y - player.from[1]) * player.t; }
  }
  if (!player.moving) {
    const d = wantDir();
    if (d) {
      player.dir = d; const [dx, dy] = DV[d];
      if (walkable(player.x + dx, player.y + dy)) {
        player.from = [player.x, player.y]; player.x += dx; player.y += dy; player.t = 0; player.moving = true;
      } else if (GRID && kindAt(player.x + dx, player.y + dy) === -1 && walkable(player.x, player.y)) {
        leaveThrough(d);
      }
    }
  }
}

// ---- character sprite (drawn with rects, 16x16)
function drawPlayer(sx, sy, s) {
  const step = player.moving ? (Math.floor((player.px + player.py) * 4) % 2) : 0;
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(sx + x * s, sy + y * s, w * s, h * s); };
  R(3, 14, 10, 2, "rgba(0,0,0,.28)");
  R(4, 10, 3, 5 - step, "#2a3a6a"); R(9, 10, 3, 5 - (1 - step), "#2a3a6a");      // legs
  R(4, 6, 8, 6, "#d64541");                                                     // shirt
  R(5, 1, 6, 6, "#f3c79b");                                                     // face
  R(4, 0, 8, 3, "#3b2a20");                                                     // hair
  if (player.dir === "down") { R(6, 4, 1, 1, "#222"); R(9, 4, 1, 1, "#222"); R(4, 2, 1, 2, "#3b2a20"); R(11, 2, 1, 2, "#3b2a20"); }
  if (player.dir === "up") { R(5, 2, 6, 4, "#3b2a20"); }
  if (player.dir === "left") { R(5, 4, 1, 1, "#222"); R(9, 2, 3, 3, "#3b2a20"); }
  if (player.dir === "right") { R(10, 4, 1, 1, "#222"); R(4, 2, 3, 3, "#3b2a20"); }
  R(3, 7, 1, 4, "#f3c79b"); R(12, 7, 1, 4, "#f3c79b");                          // arms
  R(0, 0, 0, 0, "#000");
}

function lonlatAt(tx, ty) {
  const [lon0, lat0, lon1, lat1] = MAP.meta.bounds;
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const unmerc = m => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
  const lon = lon0 + (lon1 - lon0) * (tx + .5) / COLS;
  const lat = unmerc(merc(lat1) + (merc(lat0) - merc(lat1)) * (ty + .5) / ROWS);
  return [lat, lon];
}

const hud = document.getElementById("hud");
let lastHud = "";

function render() {
  document.body.classList.toggle("fx", !!fx);
  if (fx && fx.mode === "wait") { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  const dpr = devicePixelRatio || 1, s = zoom * dpr, tsz = TS * s;
  const vw = cv.width, vh = cv.height;
  const camX = player.px * tsz + tsz / 2 - vw / 2, camY = player.py * tsz + tsz / 2 - vh / 2;
  ctx.fillStyle = "#16161d"; ctx.fillRect(0, 0, vw, vh);
  const x0 = Math.max(0, Math.floor(camX / tsz)), y0 = Math.max(0, Math.floor(camY / tsz));
  const x1 = Math.min(COLS - 1, Math.ceil((camX + vw) / tsz)), y1 = Math.min(ROWS - 1, Math.ceil((camY + vh) / tsz));
  for (const grid of [MAP.tileGrid, MAP.overlayGrid]) {
    if (!grid) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = grid[y * COLS + x];
      if (t < 0) continue;
      ctx.drawImage(tiles, (t % 16) * TS, Math.floor(t / 16) * TS, TS, TS,
        Math.round(x * tsz - camX), Math.round(y * tsz - camY), Math.ceil(tsz), Math.ceil(tsz));
    }
  }
  drawPlayer(Math.round(player.px * tsz - camX), Math.round(player.py * tsz - camY), s);

  // labels
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const l of MAP.labels) {
    const lx = l.tile[0] * tsz - camX, ly = l.tile[1] * tsz - camY;
    if (lx < -200 || ly < -40 || lx > vw + 200 || ly > vh + 40) continue;
    const big = l.kind === "station";
    if (l.kind === "district" || l.kind === "route") {
      ctx.font = `${11 * dpr}px sans-serif`; ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 3 * dpr; ctx.strokeText(l.name, lx, ly); ctx.fillText(l.name, lx, ly);
      continue;
    }
    ctx.font = `${(big ? 15 : 12) * dpr}px sans-serif`;
    const w = ctx.measureText(l.name).width + 12 * dpr, h = (big ? 22 : 18) * dpr;
    ctx.fillStyle = big ? "rgba(180,40,40,.9)" : "rgba(20,20,28,.78)";
    ctx.fillRect(lx - w / 2, ly - h / 2, w, h);
    ctx.fillStyle = "#fff"; ctx.fillText(l.name, lx, ly + 1);
  }

  if (showMini) {
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(miniBase, 0, 0, mini.width, mini.height);
    const k = mini.width / COLS;
    mctx.strokeStyle = "#fff"; mctx.lineWidth = 1;
    mctx.strokeRect(camX / tsz * k, camY / tsz * k, vw / tsz * k, vh / tsz * k);
    const r = Math.max(3, 2.5 * (devicePixelRatio || 1));
    mctx.fillStyle = "#fff"; mctx.fillRect(player.px * k - r - 1, player.py * k - r - 1, 2 * r + 2, 2 * r + 2);
    mctx.fillStyle = "#ff3030"; mctx.fillRect(player.px * k - r, player.py * k - r, 2 * r, 2 * r);
  }

  const kind = MAP.kinds[kindAt(player.x, player.y)];
  let near = null, nd = 1e9;
  for (const l of MAP.labels) { if (l.kind === "district" || l.kind === "route") continue;
    const d = Math.hypot(l.tile[0] - player.x, l.tile[1] - player.y); if (d < nd) { nd = d; near = l; } }
  const [lat, lon] = lonlatAt(player.x, player.y);
  const h = `<b>${esc(MAP.meta.place)}</b> ・ ${KIND_JA[kind] || kind}<br>` +
    (near && nd < 25 ? `近く: ${esc(near.name)}<br>` : "") +
    `<small>${MAP.meta.layout === "schematic" ? "模式図（線路基準で整列）" : lat.toFixed(5) + ", " + lon.toFixed(5)} ・ 1マス ${MAP.meta.tile_m}m ・ ${COLS}×${ROWS}</small>`;
  if (h !== lastHud) { hud.innerHTML = h; lastHud = h; }
  if (fx) swirl();
}

// ---- 隣のブロックへ: spiral out (ファミコン風の渦) -> Loading -> generate/load the neighbour -> swirl in
const SWIRL_SEC = 0.8;
let fx = null; // { mode: "out" | "wait" | "in", p: 0..1 (0 = picture, 1 = black)}
const loadingEl = document.getElementById("loading"), logEl = document.getElementById("loading-log");

/**
 * ファミコン風の渦: the picture stays put and is blotted out in coarse black blocks, in a spiral that
 * closes on the player (fx.p: 0 = picture, 1 = black). Drawn over the game, so nothing to copy or rotate.
 */
function swirl() {
  const dpr = devicePixelRatio || 1, B = Math.round(16 * dpr), w = cv.width, h = cv.height, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += B) for (let x = 0; x < w; x += B) {
    const dx = x + B / 2 - cx, dy = y + B / 2 - cy, r = Math.hypot(dx, dy) / R;
    // outer blocks go first; within a ring the angle staggers them, which makes the spiral arm
    const v = 0.4 * (1 - r) + 0.6 * ((Math.atan2(dy, dx) / (2 * Math.PI) + 2 * r + 1) % 1);
    if (v <= fx.p) ctx.fillRect(x, y, B, B);
  }
}
const tween = (mode, from, to) => new Promise(resolve => {
  fx = { mode, p: from }; const t0 = performance.now(), me = fx;
  const step = now => {
    if (fx !== me) return resolve();
    me.p = from + (to - from) * Math.min(1, (now - t0) / 1000 / SWIRL_SEC);
    if (now - t0 >= SWIRL_SEC * 1000) return resolve();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
const setPanel = (show, lines = []) => { loadingEl.hidden = !show; logEl.textContent = lines.join("\n"); logEl.scrollTop = logEl.scrollHeight; };

let leaving = false;
async function leaveThrough(d) {
  if (leaving) return; leaving = true;
  const [dx, dy] = DV[d], ni = GRID.i + dx, nj = GRID.j - dy; // rows count north-up, the screen's y goes down
  const lines = ["Loading…"]; let panelOn = false;
  const log = text => { lines.push(text); if (panelOn) setPanel(true, lines); };
  const loading = getOrGenerateCell(WORKER, ni, nj, { log }).then(rec => ({ rec }), error => ({ error }));
  await tween("out", 0, 1);
  fx = { mode: "wait", p: 1 };
  let done = null;
  loading.then(r => done = r);
  await Promise.race([loading, new Promise(r => setTimeout(r, 150))]);
  if (!done) { panelOn = true; setPanel(true, lines); }
  const r = await loading;
  if (r.error) {
    setPanel(true, [...lines, "", "⚠ " + (r.error.message || r.error)]);
    await new Promise(res => setTimeout(res, 2500));
    setPanel(false); await tween("in", 1, 0); fx = null; leaving = false;
    // turn round, so the same key does not walk straight back into the edge
    return;
  }
  const oldCols = COLS, oldRows = ROWS, ox = player.x, oy = player.y;
  await applyMap(r.rec);
  const tx = dx > 0 ? 0 : dx < 0 ? COLS - 1 : Math.round(ox * COLS / oldCols);
  const ty = dy > 0 ? 0 : dy < 0 ? ROWS - 1 : Math.round(oy * ROWS / oldRows);
  const [x, y] = nearestWalkable(Math.min(COLS - 1, tx), Math.min(ROWS - 1, ty)) || [tx, ty];
  placePlayer(x, y); player.dir = d;
  history.replaceState(null, "", "#" + r.rec.id);
  setPanel(false);
  fx = { mode: "in", p: 1 };
  await tween("in", 1, 0);
  fx = null; leaving = false;
}

let last = performance.now();
function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; update(dt); render(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
