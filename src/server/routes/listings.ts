import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lte, like, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { listings } from "../../db/schema.ts";
import type { Listing } from "../../shared/types.ts";

export const listingsRoute = new Hono();

function rowToListing(r: typeof listings.$inferSelect): Listing {
  return {
    id: r.id,
    sourceId: r.sourceId,
    externalId: r.externalId,
    title: r.title,
    rawTitle: r.rawTitle,
    employer: r.employer,
    location: r.location,
    state: r.state,
    url: r.url,
    description: r.description,
    postedAt: r.postedAt,
    postedAtAccurate: r.postedAtAccurate === 1,
    fetchedAt: r.fetchedAt,
    jobCategory: r.jobCategory as Listing["jobCategory"],
    hoursRequired: r.hoursRequired,
    ratingsRequired: r.ratingsRequired ? safeParseRatings(r.ratingsRequired) : null,
  };
}

function safeParseRatings(s: string): string[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

listingsRoute.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  // Accept either a single category or repeated `category=` params for
  // the grouped chips in the UI (e.g. "Non-CFI" → 6 categories).
  const categories = c.req.queries("category")?.map((s) => s.trim()).filter(Boolean) ?? [];
  const state = c.req.query("state")?.trim().toUpperCase();
  const source = c.req.query("source")?.trim();
  const postedSinceDays = numParam(c.req.query("postedSinceDays"), 30);
  const maxHoursRequired = numParam(c.req.query("maxHoursRequired"), undefined);
  const limit = Math.min(numParam(c.req.query("limit"), 50) ?? 50, 200);
  const offset = numParam(c.req.query("offset"), 0) ?? 0;

  const conditions = [eq(listings.isClosed, 0)];

  if (postedSinceDays && postedSinceDays > 0) {
    const cutoff = Date.now() - postedSinceDays * 86400_000;
    conditions.push(gte(listings.postedAt, cutoff));
  }
  if (categories.length === 1) {
    conditions.push(eq(listings.jobCategory, categories[0]));
  } else if (categories.length > 1) {
    conditions.push(inArray(listings.jobCategory, categories));
  }
  if (state) conditions.push(eq(listings.state, state));
  if (source) conditions.push(eq(listings.sourceId, source));
  if (maxHoursRequired !== undefined) {
    conditions.push(
      or(
        sql`${listings.hoursRequired} IS NULL`,
        lte(listings.hoursRequired, maxHoursRequired),
      )!,
    );
  }
  if (q) {
    const needle = `%${q.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${listings.title})`, needle),
        like(sql`lower(${listings.employer})`, needle),
        like(sql`lower(${listings.location})`, needle),
        like(sql`lower(${listings.description})`, needle),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(listings)
    .where(whereClause);

  const rows = await db
    .select()
    .from(listings)
    .where(whereClause)
    .orderBy(desc(listings.postedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    total: Number(totalRow[0]?.n ?? 0),
    items: rows.map(rowToListing),
  });
});

listingsRoute.get("/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rowToListing(rows[0]));
});

listingsRoute.get("/stats/summary", async (c) => {
  const cutoff = Date.now() - 30 * 86400_000;
  const freshFilter = and(eq(listings.isClosed, 0), gte(listings.postedAt, cutoff));
  const fresh = await db
    .select({ n: sql<number>`count(*)` })
    .from(listings)
    .where(freshFilter);
  const byCategory = await db
    .select({ category: listings.jobCategory, n: sql<number>`count(*)` })
    .from(listings)
    .where(freshFilter)
    .groupBy(listings.jobCategory);
  return c.json({
    fresh30d: Number(fresh[0]?.n ?? 0),
    byCategory: byCategory.map((r) => ({ category: r.category, count: Number(r.n) })),
  });
});

function numParam(s: string | undefined, fallback: number | undefined): number | undefined {
  if (s === undefined || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
