/**
 * One-time backfill: re-runs extractHoursByClass() against every row in the
 * listings DB. Run after changes to the per-class hour patterns so existing
 * rows pick up the new logic without waiting for sources to re-surface them.
 *
 *   bun scripts/reextract-hours-breakdown.ts          # apply
 *   bun scripts/reextract-hours-breakdown.ts --dry    # report only
 *
 * Safe to run repeatedly: rows whose breakdown already matches the current
 * logic are skipped.
 */
import { eq } from "drizzle-orm";
import { db, sqlite } from "../src/db/client.ts";
import { listings } from "../src/db/schema.ts";
import { extractHoursByClass } from "../src/scrapers/enrich.ts";

const dryRun = process.argv.includes("--dry");

function main() {
  const rows = sqlite
    .query(
      "SELECT id, title, description, hours_breakdown as hoursBreakdown FROM listings",
    )
    .all() as Array<{
    id: number;
    title: string;
    description: string | null;
    hoursBreakdown: string | null;
  }>;

  let changed = 0;
  for (const r of rows) {
    const fullText = `${r.title}\n${r.description ?? ""}`;
    const next = extractHoursByClass(fullText);
    const nextJson = next ? JSON.stringify(next) : null;
    if (nextJson === r.hoursBreakdown) continue;
    changed++;
    if (!dryRun) {
      db.update(listings).set({ hoursBreakdown: nextJson }).where(eq(listings.id, r.id)).run();
    }
  }

  console.log(`Scanned ${rows.length} rows, ${changed} updated${dryRun ? " (dry run)" : ""}.`);
}

main();
