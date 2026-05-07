import { sql } from "drizzle-orm";
import { db, sqlite } from "../db/client.ts";
import { listings, sources } from "../db/schema.ts";
import { adapters } from "./registry.ts";
import { enrichListing } from "./enrich.ts";
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
          fetchedAt: now,
          jobCategory: enriched.jobCategory,
          hoursRequired: enriched.hoursRequired,
          ratingsRequired: enriched.ratingsRequired
            ? JSON.stringify(enriched.ratingsRequired)
            : null,
        })
        .onConflictDoUpdate({
          target: [listings.sourceId, listings.externalId],
          set: {
            title: enriched.title,
            employer: enriched.employer ?? null,
            location: enriched.location ?? null,
            state: enriched.state,
            description: enriched.description ?? null,
            postedAt: enriched.postedAt,
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
