import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { listingsRoute } from "./routes/listings.ts";
import { sourcesRoute } from "./routes/sources.ts";
import { adapters } from "../scrapers/registry.ts";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    bun: process.versions.bun,
    sources: adapters.map((a) => ({ id: a.id, name: a.name })),
  }),
);

app.route("/api/listings", listingsRoute);
app.route("/api/sources", sourcesRoute);

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

console.log(`flightpath api listening on http://localhost:${port}`);
