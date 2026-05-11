/**
 * One-time backfill: re-runs classifyCategory() against every row already
 * in the listings DB. Run after changes to the classifier so existing rows
 * pick up the new logic without having to wait for sources to re-surface
 * them in a fresh scrape pass.
 *
 *   bun scripts/reclassify-categories.ts          # apply
 *   bun scripts/reclassify-categories.ts --dry    # report only
 *
 * Safe to run repeatedly: rows whose classification already matches the
 * current logic are skipped.
 */
import { eq } from "drizzle-orm";
import { db, sqlite } from "../src/db/client.ts";
import { listings } from "../src/db/schema.ts";
import { classifyCategory } from "../src/scrapers/enrich.ts";

const dryRun = process.argv.includes("--dry");

function main() {
  const rows = sqlite
    .query(
      "SELECT id, title, description, employer, job_category as jobCategory FROM listings",
    )
    .all() as Array<{
    id: number;
    title: string;
    description: string | null;
    employer: string | null;
    jobCategory: string | null;
  }>;

  let changed = 0;
  const transitions = new Map<string, number>();

  for (const r of rows) {
    const next = classifyCategory(r.title, r.description, r.employer);
    if (next === r.jobCategory) continue;
    const key = `${r.jobCategory ?? "null"} → ${next ?? "null"}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    changed++;
    if (!dryRun) {
      db.update(listings).set({ jobCategory: next }).where(eq(listings.id, r.id)).run();
    }
  }

  console.log(`Scanned ${rows.length} rows, ${changed} reclassified${dryRun ? " (dry run)" : ""}.`);
  if (transitions.size > 0) {
    console.log("Transitions:");
    for (const [k, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${n}`);
    }
  }
}

main();
