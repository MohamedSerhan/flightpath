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
import { desc, gte } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listings, sources } from "../db/schema.ts";
import type { Listing } from "../shared/types.ts";

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
    jobCategory: r.jobCategory as Listing["jobCategory"],
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
    .where(gte(listings.postedAt, cutoff))
    .orderBy(desc(listings.postedAt));
  const sourceRows = await db.select().from(sources);

  const bundle = {
    generatedAt: Date.now(),
    count: rows.length,
    listings: rows.map(rowToListing),
    sources: sourceRows,
  };

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
