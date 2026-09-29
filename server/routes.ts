import { get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route({
  home: get("/"),
  generate: post("/api/generate"),
  job: get("/api/jobs/:id"),
  viewer: get("/maps/:id"),
  file: get("/maps/:id/:file"),
});
