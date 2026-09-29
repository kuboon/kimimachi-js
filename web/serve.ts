/** Local static server for dist/ (deploy dist/ to any static host; Cloudflare Pages / R2 work). */
import { serveDir } from "@std/http/file-server";

Deno.serve({ hostname: "127.0.0.1", port: 8891 }, (req) => serveDir(req, { fsRoot: "dist", quiet: true }));
