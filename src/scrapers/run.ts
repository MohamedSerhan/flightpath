import { sql } from "drizzle-orm";
import { db, sqlite } from "../db/client.ts";
import { listings, sources } from "../db/schema.ts";
import { adapters } from "./registry.ts";
import { enrichListing } from "./enrich.ts";
import { enrichDetailPages } from "./enrich-detail.ts";
import type { SourceAdapter } from "./types.ts";

function ensureSchema() {
  const row = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='listings'")
    .get() as { name?: string } | undefined;
  if (!row?.name) {
    console.error("Schema missing. Run: bun run db:migrate");
    process.exit(1);
  }
}

async function runOne(adapter: SourceAdapter): Promise<void> {
  const startedAt = Date.now();
  console.log(`[${adapter.id}] fetching…`);
  try {
    const raw = await adapter.fetch();
    console.log(`[${adapter.id}] got ${raw.length} raw listings`);
    let inserted = 0;
    let updated = 0;
    const now = Date.now();

    for (const r of raw) {
      const enriched = enrichListing(r);
      // Default to accurate when the adapter didn't speak. Most adapters
      // parse a real source date; the ones that fall back to Date.now()
      // are responsible for explicitly setting postedAtAccurate: false.
      const accurate = enriched.postedAtAccurate !== false;
      const result = await db
        .insert(listings)
        .values({
          sourceId: adapter.id,
          externalId: enriched.externalId,
          title: enriched.title,
          rawTitle: enriched.title,
          employer: enriched.employer ?? null,
          location: enriched.location ?? null,
          state: enriched.state,
          url: enriched.url,
          description: enriched.description ?? null,
          postedAt: enriched.postedAt,
          postedAtAccurate: accurate ? 1 : 0,
          fetchedAt: now,
          jobCategory: enriched.jobCategory,
          hoursRequired: enriched.hoursRequired,
          ratingsRequired: enriched.ratingsRequired
            ? JSON.stringify(enriched.ratingsRequired)
            : null,
        })
        .onConflictDoUpdate({
          target: [listings.sourceId, listings.externalId],
          // Once a row has been enriched (we've talked to the source page
          // directly), trust the enriched fields over what the index-page
          // adapter ships. Without this, every cron tick resets postedAt
          // back to "now" for sources that don't expose a real post date,
          // and the listing looks artificially fresh forever.
          //
          // postedAtAccurate is monotone-upgrade only: once we've recorded
          // a real source date (either at insert or via detail-enrichment),
          // don't let a later index pass with a fallback date flip it back
          // to inaccurate.
          set: {
            title: enriched.title,
            employer: enriched.employer ?? null,
            location: sql`CASE WHEN ${listings.enrichedAt} IS NULL OR ${listings.location} IS NULL THEN ${enriched.location ?? null} ELSE ${listings.location} END`,
            state: sql`CASE WHEN ${listings.enrichedAt} IS NULL OR ${listings.state} IS NULL THEN ${enriched.state} ELSE ${listings.state} END`,
            description: enriched.description ?? null,
            postedAt: sql`CASE WHEN ${listings.enrichedAt} IS NULL THEN ${enriched.postedAt} ELSE ${listings.postedAt} END`,
            postedAtAccurate: sql`CASE WHEN ${listings.postedAtAccurate} = 1 THEN 1 ELSE ${accurate ? 1 : 0} END`,
            fetchedAt: now,
            jobCategory: enriched.jobCategory,
            hoursRequired: enriched.hoursRequired,
            ratingsRequired: enriched.ratingsRequired
              ? JSON.stringify(enriched.ratingsRequired)
              : null,
          },
        })
        .returning({ id: listings.id });
      if (result.length > 0) inserted++;
      else updated++;
    }

    await db
      .insert(sources)
      .values({
        id: adapter.id,
        name: adapter.name,
        lastRunAt: startedAt,
        lastSuccessAt: Date.now(),
        lastCount: raw.length,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          name: adapter.name,
          lastRunAt: startedAt,
          lastSuccessAt: Date.now(),
          lastCount: raw.length,
          lastError: null,
        },
      });

    console.log(`[${adapter.id}] saved ${inserted + updated} (upserted)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${adapter.id}] FAILED:`, message);
    await db
      .insert(sources)
      .values({
        id: adapter.id,
        name: adapter.name,
        lastRunAt: startedAt,
        lastSuccessAt: null,
        lastCount: null,
        lastError: message,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: { lastRunAt: startedAt, lastError: message },
      });
  }
}

async function main() {
  ensureSchema();
  const started = Date.now();
  for (const adapter of adapters) {
    await runOne(adapter);
  }
  if (process.env.SKIP_DETAIL !== "1") {
    try {
      await enrichDetailPages();
    } catch (err) {
      console.warn("[detail] enrichment pass failed:", err instanceof Error ? err.message : err);
    }
  }
  const totalRow = sqlite.query("SELECT COUNT(*) as n FROM listings").get() as { n: number };
  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s. Total listings in DB: ${totalRow.n}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// keeps `sql` import used if we add raw queries later
void sql;
