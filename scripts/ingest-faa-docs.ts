/**
 * Orchestrator for the FAA reference library ingest.
 *
 * Runs all three per-doc ingest scripts (PHAK, Commercial ACS, FAR)
 * and builds the cross-doc search index.
 *
 * Called by `bun run build:learn` (added to package.json in a later task).
 * Safe to run individually:
 *   bun scripts/ingest-faa-docs.ts          # use cached PDFs
 *   bun scripts/ingest-faa-docs.ts --force  # re-download all
 */

import { writeFile } from "node:fs/promises";

type IngestSpec = { id: string; title: string; script: string };

const DOCS: IngestSpec[] = [
  { id: "phak", title: "Pilot's Handbook of Aeronautical Knowledge", script: "scripts/ingest/phak.ts" },
  { id: "commercial-acs", title: "Commercial Pilot ACS", script: "scripts/ingest/commercial-acs.ts" },
  { id: "far", title: "Federal Aviation Regulations (Parts 61/91/119/135/141)", script: "scripts/ingest/far.ts" },
];

const SEARCH_INDEX_PATH = "public/data/learn/search-index.json";

async function runIngest(spec: IngestSpec, force: boolean): Promise<boolean> {
  const args = ["bun", spec.script];
  if (force) args.push("--force");
  console.log(`[orchestrator] ${spec.id}: running ${spec.script}…`);
  const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[orchestrator] ${spec.id} failed with exit code ${code} — continuing with remaining docs`);
    return false;
  }
  return true;
}

type SearchEntry = {
  docId: string;
  docTitle: string;
  chunkId: string;
  title: string;
  snippet: string;
};

async function buildSearchIndex(): Promise<void> {
  const entries: SearchEntry[] = [];
  for (const doc of DOCS) {
    const path = `public/data/learn/${doc.id}/chunks.json`;
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.warn(`[orchestrator] ${doc.id} chunks.json missing — skipping in search index`);
      continue;
    }
    const chunks = (await file.json()) as Array<{ chunkId: string; title: string; text: string }>;
    for (const c of chunks) {
      entries.push({
        docId: doc.id,
        docTitle: doc.title,
        chunkId: c.chunkId,
        title: c.title,
        snippet: (c.text || "").replace(/\s+/g, " ").slice(0, 200),
      });
    }
  }
  await writeFile(SEARCH_INDEX_PATH, JSON.stringify(entries));
  console.log(`[orchestrator] search index: ${entries.length} entries → ${SEARCH_INDEX_PATH}`);
}

async function main() {
  const force = process.argv.includes("--force");
  let ok = 0;
  for (const doc of DOCS) {
    if (await runIngest(doc, force)) ok++;
  }
  console.log(`[orchestrator] ${ok}/${DOCS.length} docs ingested`);
  await buildSearchIndex();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
