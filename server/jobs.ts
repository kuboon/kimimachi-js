/** Map generation jobs. They run one at a time in a background worker. */
import { encodePng, generateMap, KIND_COLORS, KINDS, kindsImage, renderMap, toTiled } from "@kuboon/kimimachi";
import { cachedFetcher, OUT } from "./store.ts";

export interface JobRequest {
  lat: number;
  lon: number;
  size: number;
  title?: string;
}

export interface Job extends JobRequest {
  id: string;
  status: "queued" | "running" | "done" | "error";
  log: string[];
  url: string | null;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = false;

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function submit(req: JobRequest): { job: Job; position: number } {
  const job: Job = { ...req, id: newId(), status: "queued", log: [], url: null };
  jobs.set(job.id, job);
  queue.push(job);
  void pump();
  return { job, position: queue.length };
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) await run(job);
  } finally {
    running = false;
  }
}

async function run(job: Job) {
  job.status = "running";
  try {
    const t0 = performance.now();
    const log = (m: string) => job.log.push(m);
    log(`📍 ${job.lat.toFixed(5)}, ${job.lon.toFixed(5)}`);
    const { map, tileset, semantic } = await generateMap({
      lat: job.lat,
      lon: job.lon,
      size: job.size,
      title: job.title,
      fetch: cachedFetcher,
      log,
    });
    const dir = `${OUT}/${job.id}`;
    await Deno.mkdir(dir, { recursive: true });
    const tileGrid = Int32Array.from(map.tileGrid), overlay = Int32Array.from(map.overlayGrid);
    const write = (name: string, data: Uint8Array | string) =>
      Deno.writeFile(`${dir}/${name}`, typeof data === "string" ? new TextEncoder().encode(data) : data);
    await Promise.all([
      write("tileset.png", await encodePng(tileset)),
      write("map.png", await encodePng(renderMap(tileGrid, map.width, tileset, overlay))),
      write("abstract.png", await encodePng(kindsImage(map.kindGrid, map.width, 4))),
      write("semantic_map.png", await encodePng(semantic)),
      write("map.tmj", JSON.stringify(toTiled(map, tileset))),
      // map.json goes last: its presence marks a finished map
    ]);
    await write("map.json", JSON.stringify({ ...map, kindColors: KINDS.map((k) => KIND_COLORS[k]) }));
    job.url = `/maps/${job.id}`;
    job.status = "done";
    job.log.push(`✅ ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    job.log.push(`エラー: ${e instanceof Error ? e.message : e}`);
    job.status = "error";
  }
}
