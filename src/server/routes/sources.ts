import { Hono } from "hono";
import { db } from "../../db/client.ts";
import { sources } from "../../db/schema.ts";

export const sourcesRoute = new Hono();

sourcesRoute.get("/", async (c) => {
  const rows = await db.select().from(sources);
  return c.json(rows);
});
