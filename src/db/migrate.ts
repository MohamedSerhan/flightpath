import { sqlite } from "./client.ts";

const DDL = `
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  raw_title TEXT NOT NULL,
  employer TEXT,
  location TEXT,
  state TEXT,
  url TEXT NOT NULL,
  description TEXT,
  posted_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  job_category TEXT,
  hours_required INTEGER,
  ratings_required TEXT,
  enriched_at INTEGER,
  is_closed INTEGER NOT NULL DEFAULT 0
);
-- Idempotent column add for upgrades from older schemas.
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS isn't supported in old SQLite;
-- we use a PRAGMA-based check in the migration script instead.
CREATE UNIQUE INDEX IF NOT EXISTS listings_source_external_uq ON listings(source_id, external_id);
CREATE INDEX IF NOT EXISTS listings_posted_idx ON listings(posted_at);
CREATE INDEX IF NOT EXISTS listings_category_idx ON listings(job_category);
CREATE INDEX IF NOT EXISTS listings_state_idx ON listings(state);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_run_at INTEGER,
  last_success_at INTEGER,
  last_count INTEGER,
  last_error TEXT
);
`;

sqlite.exec(DDL);

// Backfill: add enriched_at to pre-existing tables that were created before
// the column was introduced.
const cols = sqlite.query("PRAGMA table_info(listings)").all() as Array<{ name: string }>;
const colNames = new Set(cols.map((c) => c.name));
if (!colNames.has("enriched_at")) {
  sqlite.exec("ALTER TABLE listings ADD COLUMN enriched_at INTEGER");
  console.log("migrate: added enriched_at column");
}
if (!colNames.has("is_closed")) {
  sqlite.exec("ALTER TABLE listings ADD COLUMN is_closed INTEGER NOT NULL DEFAULT 0");
  console.log("migrate: added is_closed column");
}

// Retroactively hide listings from sources we've removed. Idempotent —
// re-running marks already-closed rows is_closed = 1 again, which is a no-op
// in practice. Reads the list straight from the registry so dropping a
// source is a one-line edit there.
const { REMOVED_SOURCE_IDS } = await import("../scrapers/registry.ts");
if (REMOVED_SOURCE_IDS.length > 0) {
  const placeholders = REMOVED_SOURCE_IDS.map(() => "?").join(",");
  const stmt = sqlite.prepare(
    `UPDATE listings SET is_closed = 1 WHERE is_closed = 0 AND source_id IN (${placeholders})`,
  );
  const result = stmt.run(...REMOVED_SOURCE_IDS);
  if (result.changes > 0) {
    console.log(
      `migrate: hid ${result.changes} listing(s) from removed sources [${REMOVED_SOURCE_IDS.join(", ")}]`,
    );
  }
}

console.log("migrate: schema applied to", process.env.FLIGHTPATH_DB ?? "./flightpath.db");
