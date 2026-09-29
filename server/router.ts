import { createRouter } from "@remix-run/fetch-router";
import { getJob, submit } from "./jobs.ts";
import { indexPage } from "./pages.ts";
import { isMapId, listMaps, MAP_FILES, OUT } from "./store.ts";
import { routes } from "./routes.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

const viewerHtml = () => Deno.readTextFile(new URL("./viewer.html", import.meta.url));

const router = createRouter();

router.get(routes.home, {
  async handler() {
    return html(indexPage(await listMaps()));
  },
});

router.post(routes.generate, {
  async handler({ request }) {
    let lat: number, lon: number, size: number, title: string;
    try {
      const data = await request.json();
      lat = Number(data.lat);
      lon = Number(data.lon);
      size = Number(data.size || 1500);
      title = String(data.title ?? "").trim().slice(0, 60);
    } catch {
      return json({ error: "入力が不正です" }, 400);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(size)) {
      return json({ error: "入力が不正です" }, 400);
    }
    // the map sources (国土地理院 / PLATEAU) only cover Japan
    if (lat < 20 || lat > 46 || lon < 122 || lon > 154) {
      return json({ error: "日本国内の位置を指定してください（地図データは国土地理院・PLATEAU のため）" }, 400);
    }
    size = Math.max(300, Math.min(5000, size));
    const { job, position } = submit({ lat, lon, size, title: title || undefined });
    return json({ id: job.id, position });
  },
});

router.get(routes.job, {
  handler({ params }) {
    const job = getJob(params.id);
    if (!job) return json({ error: "not found" }, 404);
    return json({ id: job.id, status: job.status, log: job.log, url: job.url });
  },
});

router.get(routes.viewer, {
  async handler({ params }) {
    if (!isMapId(params.id)) return new Response("not found", { status: 404 });
    return html(await viewerHtml());
  },
});

router.get(routes.file, {
  async handler({ params }) {
    const type = MAP_FILES[params.file];
    if (!isMapId(params.id) || !type) return new Response("not found", { status: 404 });
    try {
      return new Response(await Deno.readFile(`${OUT}/${params.id}/${params.file}`), { headers: { "content-type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
});

export default router;
