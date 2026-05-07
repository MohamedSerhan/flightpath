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
  ratings_required TEXT
);
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
console.log("migrate: schema applied to", process.env.FLIGHTPATH_DB ?? "./flightpath.db");
