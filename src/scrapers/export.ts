/**
 * Export the scraped DB to a static JSON bundle suitable for GitHub Pages.
 *
 * This is the bridge between the daily/hourly scraper and a free,
 * 24/7 static deploy. The frontend, when built with VITE_STATIC_DATA
 * pointing at this file, reads it directly and skips the API.
 *
 * Output shape: { generatedAt, count, listings: Listing[], sources: SourceMeta[] }
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listings, sources } from "../db/schema.ts";
import type { Listing } from "../shared/types.ts";
import { classifyCategory, isNonUS } from "./enrich.ts";

function rowToListing(r: typeof listings.$inferSelect): Listing {
  let ratings: string[] | null = null;
  if (r.ratingsRequired) {
    try {
      const v = JSON.parse(r.ratingsRequired);
      ratings = Array.isArray(v) ? v : null;
    } catch {
      ratings = null;
    }
  }
  // Re-classify at export time so updates to the classifier apply
  // immediately to cached rows — no DB migration / re-scrape needed.
  // Cached SQLite often has stale jobCategory values from earlier scrapes
  // that pre-date the current rules.
  const jobCategory = classifyCategory(r.title, r.description, r.employer) as Listing["jobCategory"];
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
    fetchedAt: r.fetchedAt,
    jobCategory,
    hoursRequired: r.hoursRequired,
    ratingsRequired: ratings,
  };
}

async function main() {
  const outDir = join(process.cwd(), "dist/web");
  const dataDir = join(outDir, "data");
  await mkdir(dataDir, { recursive: true });

  // Cap to 90 days of listings to keep the bundle small even after months
  // of scraping. The UI defaults to 30 anyway.
  const cutoff = Date.now() - 90 * 86400_000;
  const rows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.isClosed, 0), gte(listings.postedAt, cutoff)))
    .orderBy(desc(listings.postedAt));
  const sourceRows = await db.select().from(sources);

  // Drop non-US listings at export time — the sibling is US-based and
  // not pursuing international postings. CAE Seoul/Dubai/Montpellier and
  // Air Canada / Bristow Falklands rows historically slip through.
  const usRows = rows.filter((r) => !isNonUS(r.location));

  const bundle = {
    generatedAt: Date.now(),
    count: usRows.length,
    listings: usRows.map(rowToListing),
    sources: sourceRows,
  };
  if (rows.length !== usRows.length) {
    console.log(`export: dropped ${rows.length - usRows.length} non-US listings`);
  }

  const outFile = join(dataDir, "listings.json");
  await Bun.write(outFile, JSON.stringify(bundle));
  console.log(
    `export: ${rows.length} listings → ${outFile} (${(JSON.stringify(bundle).length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
