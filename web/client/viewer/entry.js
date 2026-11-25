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
  if (e.key === "c" || e.key === "C") setDrive(!drive.on);
  if (drive.on && (e.key === "+" || e.key === "=")) nudgeScale(1);
  else if (drive.on && e.key === "-") nudgeScale(-1);
  else if (e.key === "+" || e.key === "=") zoom = Math.min(8, zoom + 1);
  else if (e.key === "-") zoom = Math.max(1, zoom - 1);
  if (e.key === " ") e.preventDefault();
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
// ---- gamepads (standard mapping): d-pad 12-15, left stick, RT 7 / LT 6, A 0, B 1, X 2, Start 9
const gamepad = () => [...(navigator.getGamepads?.() ?? [])].find(g => g && g.connected) || null;
const gpBtn = (g, i) => g?.buttons[i]?.value ?? 0;
const DEAD = 0.2;
const deadzone = v => Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);
let startWas = false;
/** Start toggles drive mode; read once a frame so it fires on the press, not while held. */
function pollStart() {
  const down = gpBtn(gamepad(), 9) > 0.5;
  if (down && !startWas) setDrive(!drive.on);
  startWas = down;
}
addEventListener("gamepadconnected", () => document.body.classList.add("gamepad"));
addEventListener("gamepaddisconnected", () => document.body.classList.toggle("gamepad", !!gamepad()));

function wantDir() {
  const k = keys, g = gamepad();
  const gx = deadzone(g?.axes[0] ?? 0), gy = deadzone(g?.axes[1] ?? 0);
  if (k.has("arrowup") || k.has("w") || padHeld.has("up") || gpBtn(g, 12) || gy < -0.5) return "up";
  if (k.has("arrowdown") || k.has("s") || padHeld.has("down") || gpBtn(g, 13) || gy > 0.5) return "down";
  if (k.has("arrowleft") || k.has("a") || padHeld.has("left") || gpBtn(g, 14) || gx < -0.5) return "left";
  if (k.has("arrowright") || k.has("d") || padHeld.has("right") || gpBtn(g, 15) || gx > 0.5) return "right";
  return null;
}
const DV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function update(dt) {
  pollStart();
  if (fx) return;
  if (drive.on) return driveUpdate(dt);
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
  const dpr = devicePixelRatio || 1, vw = cv.width, vh = cv.height;
  ctx.fillStyle = "#16161d"; ctx.fillRect(0, 0, vw, vh);
  if (drive.on) renderDrive(dpr, vw, vh);
  else renderWalk(dpr, vw, vh);
  renderHud();
  if (fx) swirl();
}

function renderWalk(dpr, vw, vh) {
  const s = zoom * dpr, tsz = TS * s;
  const camX = player.px * tsz + tsz / 2 - vw / 2, camY = player.py * tsz + tsz / 2 - vh / 2;
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
}

function renderHud() {
  const kind = MAP.kinds[kindAt(player.x, player.y)];
  let near = null, nd = 1e9;
  for (const l of MAP.labels) { if (l.kind === "district" || l.kind === "route") continue;
    const d = Math.hypot(l.tile[0] - player.x, l.tile[1] - player.y); if (d < nd) { nd = d; near = l; } }
  const [lat, lon] = lonlatAt(player.x, player.y);
  const h = `<b>${esc(MAP.meta.place)}</b> ・ ${KIND_JA[kind] || kind}<br>` +
    (near && nd < 25 ? `近く: ${esc(near.name)}<br>` : "") +
    (drive.on ? `<b>${Math.round(Math.abs(drive.v) * 3.6)}</b> km/h${drive.v < -0.05 ? "（バック）" : ""}<br>` : "") +
    `<small>${MAP.meta.layout === "schematic" ? "模式図（線路基準で整列）" : lat.toFixed(5) + ", " + lon.toFixed(5)} ・ 1マス ${MAP.meta.tile_m}m ・ ${COLS}×${ROWS}</small>`;
  if (h !== lastHud) { hud.innerHTML = h; lastHud = h; }
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
    setPanel(false); drive.v = 0; await tween("in", 1, 0); fx = null; leaving = false;
    // turn round, so the same key does not walk straight back into the edge
    return;
  }
  const oldCols = COLS, oldRows = ROWS, ox = player.x, oy = player.y, opx = player.px, opy = player.py;
  await applyMap(r.rec);
  if (drive.on) {
    // carry on from the same point of the opposite edge, same heading and speed
    let x = dx > 0 ? opx - oldCols : dx < 0 ? opx + COLS : opx * COLS / oldCols;
    let y = dy > 0 ? opy - oldRows : dy < 0 ? opy + ROWS : opy * ROWS / oldRows;
    x = Math.min(COLS - 0.01, Math.max(0.01, x)); y = Math.min(ROWS - 0.01, Math.max(0.01, y));
    if (!walkable(Math.floor(x), Math.floor(y))) {
      const [nx, ny] = nearestWalkable(Math.floor(x), Math.floor(y)) || [Math.floor(x), Math.floor(y)];
      x = nx + 0.5; y = ny + 0.5; drive.v = 0;
    }
    player.px = x; player.py = y; player.x = Math.floor(x); player.y = Math.floor(y);
    history.replaceState(null, "", "#" + r.rec.id);
    setPanel(false);
    fx = { mode: "in", p: 1 };
    await tween("in", 1, 0);
    fx = null; leaving = false;
    return;
  }
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

// ---- ドライブモード: the car stays put, heading up; the map turns under it
// Sizes are real ones (a 4.5 m car, the map's metres per tile), so one setting — the car's length on
// screen — fixes the scale of everything: match the shadow to a real model car and the map is at its scale.
const CAR_M = 4.5, CAR_W_M = 1.8, WHEELBASE_M = 2.7, MAX_STEER = 0.6; // rad
const VMAX = 60 / 3.6, VBACK = 10 / 3.6, ACCEL = 3, BRAKE = 8, DRAG = 0.6, LAT_G = 5; // m/s, m/s²
const CAR_Y = 0.62; // where the car sits, as a fraction of the screen's height
const SCALE_MIN = 20, SCALE_MAX = 900; // car length, CSS px
const PREF = "kimimachi.drive";
const drive = {
  on: false, heading: 0, v: 0, steer: 0,
  carPx: 120, look: "car", wake: null,
  ...JSON.parse(localStorage.getItem(PREF) || "{}"),
};
drive.on = false; drive.v = 0; drive.steer = 0; drive.wake = null;
const savePrefs = () => localStorage.setItem(PREF, JSON.stringify({ carPx: drive.carPx, look: drive.look }));

const scaleEl = document.getElementById("drive-scale"), scaleOut = document.getElementById("drive-scale-out");
const sliderOf = px => Math.round(1000 * Math.log(px / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN));
const pxOf = v => SCALE_MIN * (SCALE_MAX / SCALE_MIN) ** (v / 1000);
function setScale(px, fromSlider) {
  drive.carPx = Math.min(SCALE_MAX, Math.max(SCALE_MIN, px));
  if (!fromSlider) scaleEl.value = sliderOf(drive.carPx);
  scaleOut.textContent = `車 ${drive.carPx.toFixed(1)}px ・ 1マス ${(drive.carPx * MAP.meta.tile_m / CAR_M).toFixed(0)}px`;
  savePrefs();
}
/** One step of fine adjustment: 1 % */
const nudgeScale = sign => setScale(drive.carPx * (sign > 0 ? 1.01 : 1 / 1.01));
scaleEl.addEventListener("input", () => setScale(pxOf(+scaleEl.value), true));
document.querySelectorAll("[data-scale]").forEach(b => b.addEventListener("click", () => nudgeScale(+b.dataset.scale)));
document.querySelectorAll("input[name=drive-look]").forEach(r => {
  r.checked = r.value === drive.look;
  r.addEventListener("change", () => { drive.look = r.value; savePrefs(); });
});
setScale(drive.carPx);

const pedalHeld = new Set();
const pedals = document.getElementById("pedals");
pedals.addEventListener("contextmenu", e => e.preventDefault());
pedals.querySelectorAll("button").forEach(b => {
  const c = b.dataset.c;
  b.addEventListener("pointerdown", e => { e.preventDefault(); pedalHeld.add(c); b.setPointerCapture(e.pointerId); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => b.addEventListener(ev, () => pedalHeld.delete(c)));
});

const toggleEl = document.getElementById("drive-toggle"), helpEl = document.getElementById("help");
const HELP_WALK = helpEl.textContent;
const HELP_DRIVE = "↑/W: アクセル　↓/S/Space: ブレーキ・バック　←→/AD: ハンドル　+/-: スケール　C: 歩く　（パッド: RT/LT/左スティック）";
toggleEl.addEventListener("click", () => setDrive(!drive.on));

/** Keeps the screen on while driving (a model car sits on it); taken again when the tab comes back. */
async function wakeLock() {
  if (!drive.on || drive.wake || document.visibilityState !== "visible") return;
  try { drive.wake = await navigator.wakeLock?.request("screen"); drive.wake?.addEventListener("release", () => drive.wake = null); }
  catch { /* not allowed here: the screen may sleep */ }
}
document.addEventListener("visibilitychange", wakeLock);

function setDrive(on) {
  if (on === drive.on || leaving) return;
  drive.on = on; drive.v = 0; drive.steer = 0;
  document.body.classList.toggle("drive", on);
  toggleEl.textContent = on ? "🚶 歩く" : "🚗 ドライブ";
  helpEl.textContent = on ? HELP_DRIVE : HELP_WALK;
  if (on) {
    // the walker stands on a tile's top-left corner; the car is a point: the middle of that tile
    player.moving = false; player.px = player.x + 0.5; player.py = player.y + 0.5;
    drive.heading = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[player.dir];
    void wakeLock();
  } else {
    const [x, y] = walkable(player.x, player.y) ? [player.x, player.y] : nearestWalkable(player.x, player.y) || [player.x, player.y];
    placePlayer(x, y);
    const h = ((drive.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    player.dir = ["up", "right", "down", "left"][Math.round(h / (Math.PI / 2)) % 4];
    drive.wake?.release(); drive.wake = null;
  }
  lastHud = "";
}

/** Pedals and wheel, each 0..1 (steer -1..1), from the keyboard, the on-screen pedals and a gamepad. */
function controls() {
  const k = keys, g = gamepad();
  const accel = Math.max(k.has("arrowup") || k.has("w") || pedalHeld.has("accel") ? 1 : 0, gpBtn(g, 7), gpBtn(g, 0));
  const brake = Math.max(k.has("arrowdown") || k.has("s") || k.has(" ") || pedalHeld.has("brake") ? 1 : 0, gpBtn(g, 6), gpBtn(g, 1), gpBtn(g, 2));
  let steer = deadzone(g?.axes[0] ?? 0) + gpBtn(g, 15) - gpBtn(g, 14);
  if (k.has("arrowleft") || k.has("a") || pedalHeld.has("left")) steer -= 1;
  if (k.has("arrowright") || k.has("d") || pedalHeld.has("right")) steer += 1;
  return { accel, brake, steer: Math.max(-1, Math.min(1, steer)) };
}

function driveUpdate(dt) {
  const c = controls(), tm = MAP.meta.tile_m;
  // keys are all-or-nothing: ease the wheel toward them so a tap is a small turn
  drive.steer += Math.max(-dt * 3, Math.min(dt * 3, c.steer - drive.steer));
  let v = drive.v;
  if (c.accel > 0) v += (v < 0 ? BRAKE : ACCEL) * c.accel * dt;
  if (c.brake > 0) {
    // brake to a stop; held at a standstill, it backs up
    if (v > 0.05) v = Math.max(0, v - BRAKE * c.brake * dt);
    else if (c.accel === 0) v -= ACCEL * 0.6 * c.brake * dt;
  }
  if (!c.accel && !c.brake) v -= Math.sign(v) * Math.min(Math.abs(v), DRAG * dt);
  v = Math.max(-VBACK, Math.min(VMAX, v));
  // bicycle model: the turning rate follows the speed, so a standing car does not spin;
  // capped by the grip (LAT_G), so full lock at speed is a curve, not a spin
  const yaw = v / WHEELBASE_M * Math.tan(drive.steer * MAX_STEER), yawMax = LAT_G / Math.max(1, Math.abs(v));
  drive.heading += Math.max(-yawMax, Math.min(yawMax, yaw)) * dt;
  const fx_ = Math.sin(drive.heading), fy = -Math.cos(drive.heading);
  const step = v * dt / tm;
  const nx = player.px + fx_ * step, ny = player.py + fy * step;
  // the bumper on the side we are going must stay on open ground too
  const reach = Math.sign(v) * CAR_M / 2 / tm;
  const bx = nx + fx_ * reach, by = ny + fy * reach;
  const outside = (x, y) => x < 0 || y < 0 || x >= COLS || y >= ROWS;
  if (GRID && outside(nx, ny) && v !== 0) {
    drive.v = v;
    const d = nx < 0 ? "left" : nx >= COLS ? "right" : ny < 0 ? "up" : "down";
    player.px = Math.min(COLS - 0.01, Math.max(0, nx)); player.py = Math.min(ROWS - 0.01, Math.max(0, ny));
    return leaveThrough(d);
  }
  const free = (x, y) => outside(x, y) ? !!GRID : walkable(Math.floor(x), Math.floor(y));
  if (step !== 0 && free(nx, ny) && free(bx, by) && !outside(nx, ny)) {
    player.px = nx; player.py = ny;
  } else if (step !== 0) {
    v = 0; // bump: stop dead
  }
  drive.v = v;
  player.x = Math.floor(player.px); player.y = Math.floor(player.py);
}

function renderDrive(dpr, vw, vh) {
  const carLen = drive.carPx * dpr, tsz = carLen * MAP.meta.tile_m / CAR_M;
  const cx = vw / 2, cy = vh * CAR_Y, h = drive.heading, cos = Math.cos(h), sin = Math.sin(h);
  // world (tiles) -> screen: around the car, turned so the heading points up
  const toScreen = (wx, wy) => {
    const dx = (wx - player.px) * tsz, dy = (wy - player.py) * tsz;
    return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
  };
  const r = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy)) / tsz + 1;
  const x0 = Math.max(0, Math.floor(player.px - r)), x1 = Math.min(COLS - 1, Math.ceil(player.px + r));
  const y0 = Math.max(0, Math.floor(player.py - r)), y1 = Math.min(ROWS - 1, Math.ceil(player.py + r));
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-h); ctx.translate(-player.px * tsz, -player.py * tsz);
  ctx.imageSmoothingEnabled = false;
  // a turned tile's edge is anti-aliased: overlap the neighbours a little so no seams show
  const o = Math.max(0.5, tsz * 0.004);
  for (const grid of [MAP.tileGrid, MAP.overlayGrid]) {
    if (!grid) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = grid[y * COLS + x];
      if (t < 0) continue;
      ctx.drawImage(tiles, (t % 16) * TS, Math.floor(t / 16) * TS, TS, TS, x * tsz - o, y * tsz - o, tsz + 2 * o, tsz + 2 * o);
    }
  }
  ctx.restore();

  // labels stay upright, at their turned place
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const l of MAP.labels) {
    const [lx, ly] = toScreen(l.tile[0], l.tile[1]);
    if (lx < -200 || ly < -40 || lx > vw + 200 || ly > vh + 40) continue;
    const big = l.kind === "station";
    if (l.kind === "district" || l.kind === "route") {
      ctx.font = `${13 * dpr}px sans-serif`; ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 3 * dpr; ctx.strokeText(l.name, lx, ly); ctx.fillText(l.name, lx, ly);
      continue;
    }
    ctx.font = `${(big ? 18 : 14) * dpr}px sans-serif`;
    const w = ctx.measureText(l.name).width + 12 * dpr, lh = (big ? 26 : 21) * dpr;
    ctx.fillStyle = big ? "rgba(180,40,40,.9)" : "rgba(20,20,28,.78)";
    ctx.fillRect(lx - w / 2, ly - lh / 2, w, lh);
    ctx.fillStyle = "#fff"; ctx.fillText(l.name, lx, ly + 1);
  }

  drawCar(cx, cy, carLen, carLen * CAR_W_M / CAR_M);

  if (showMini) {
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(miniBase, 0, 0, mini.width, mini.height);
    const k = mini.width / COLS, mx = player.px * k, my = player.py * k, rr = Math.max(4, 3 * dpr);
    mctx.strokeStyle = "#fff"; mctx.lineWidth = Math.max(2, dpr * 1.5);
    mctx.beginPath(); mctx.moveTo(mx, my); mctx.lineTo(mx + sin * rr * 3, my - cos * rr * 3); mctx.stroke();
    mctx.fillStyle = "#fff"; mctx.fillRect(mx - rr - 1, my - rr - 1, 2 * rr + 2, 2 * rr + 2);
    mctx.fillStyle = "#ff3030"; mctx.fillRect(mx - rr, my - rr, 2 * rr, 2 * rr);
  }
}

/** The car seen from above, nose up, centred on (cx, cy): pixel art, or only its shadow for a model car to sit on. */
function drawCar(cx, cy, len, wid) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = len * 0.12;
  ctx.shadowOffsetX = len * 0.03; ctx.shadowOffsetY = len * 0.05;
  ctx.fillStyle = drive.look === "shadow" ? "rgba(0,0,0,.42)" : "#000";
  const rr = Math.min(wid, len) * 0.28;
  ctx.beginPath(); ctx.roundRect(-wid / 2, -len / 2, wid, len, rr); ctx.fill();
  ctx.restore();
  if (drive.look === "shadow") return;
  // 7 x 16 pixels
  const px = wid / 7, py = len / 16, X = cx - wid / 2, Y = cy - len / 2;
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(X + x * px, Y + y * py, w * px + 0.5, h * py + 0.5); };
  R(0, 2, 7, 12, "#d64541"); R(1, 0, 5, 2, "#d64541"); R(1, 14, 5, 2, "#d64541");    // body
  R(1, 0, 1, 1, "#fff3b0"); R(5, 0, 1, 1, "#fff3b0");                                // headlights
  R(1, 4, 5, 3, "#9fd3f0"); R(1, 11, 5, 2, "#9fd3f0");                                // windows
  R(1, 7, 5, 4, "#b63530");                                                           // roof
  R(0, 6, 1, 2, "#7a1f1c"); R(6, 6, 1, 2, "#7a1f1c");                                 // mirrors
  R(1, 15, 1, 1, "#ff6a5c"); R(5, 15, 1, 1, "#ff6a5c");                               // tail lights
}

let last = performance.now();
function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; update(dt); render(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
