/**
 * Commercial Pilot ACS (Airman Certification Standards) ingest.
 *
 * Downloads FAA-S-ACS-7B (Commercial), extracts text, chunks by
 * Area of Operation and Task. Writes JSON to
 * public/data/learn/commercial-acs/.
 *
 *   bun scripts/ingest/commercial-acs.ts
 *   bun scripts/ingest/commercial-acs.ts --force
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractPdfText } from "./_pdf-extract.ts";
import { chunkByHeading } from "./_chunker.ts";

// FAA's current Commercial Pilot Airplane ACS. Found via
// https://www.faa.gov/training_testing/testing/acs — the filename
// has a numeric suffix that FAA bumps with each revision, so if this
// 404s, scrape the landing page for the new "commercial_airplane_acs_*.pdf".
const SOURCE_URL =
  "https://www.faa.gov/training_testing/testing/acs/commercial_airplane_acs_7.pdf";
const PDF_PATH = "data/learn/_pdfs/commercial-acs.pdf";
const OUTPUT_DIR = "public/data/learn/commercial-acs";

const UA = "flightpath-build (+https://github.com/MohamedSerhan/flightpath)";

async function downloadIfMissing(force: boolean): Promise<void> {
  if (existsSync(PDF_PATH) && !force) {
    console.log(`[commercial-acs] using cached ${PDF_PATH}`);
    return;
  }
  console.log(`[commercial-acs] downloading from ${SOURCE_URL}…`);
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error(`[commercial-acs] fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const buf = await res.arrayBuffer();
  await mkdir(dirname(PDF_PATH), { recursive: true });
  await Bun.write(PDF_PATH, buf);
  console.log(`[commercial-acs] cached ${PDF_PATH} (${buf.byteLength} bytes)`);
}

async function main() {
  const force = process.argv.includes("--force");
  await downloadIfMissing(force);

  const pages = await extractPdfText(PDF_PATH);
  console.log(`[commercial-acs] ${pages.length} pages`);

  // ACS headings — most common shapes are:
  //   "I. Preflight Preparation"  (Area of Operation, Roman numeral + period)
  //   "Task A. Pilot Qualifications"
  // Match either. Drop lines containing dot-leaders to avoid TOC entries
  // like "Task A. Pilot Qualifications .......... 2" polluting chunk titles.
  const headingRegex =
    /^(?:([IVX]+\.\s+[A-Z][^\n]+)|(Task\s+[A-Z]\.\s+[A-Z][^\n]+))$/;

  const chunks = chunkByHeading(pages, {
    headingRegex,
    titleFor: (m) => (m[1] ?? m[2]).trim(),
    skipLineRegex:
      /\.{5,}|^(?:Commercial Pilot — Airplane|Commercial Pilot - Airplane|FAA-S-ACS-7B|Page \d+|Airman Certification Standards|U\.?S\.? Department of Transportation)$/i,
  });

  // Dedupe by chunkId — TOC entries and body Tasks can collide on the same
  // slug. Keep the longer-bodied chunk. Then drop tiny chunks (≤ 200 chars)
  // — heading-match ghosts from running headers or partial-page captures.
  const byId = new Map<string, (typeof chunks)[number]>();
  for (const c of chunks) {
    const existing = byId.get(c.chunkId);
    if (!existing || c.text.length > existing.text.length) byId.set(c.chunkId, c);
  }
  const finalChunks = [...byId.values()].filter((c) => c.text.length > 200);

  if (finalChunks.length < 10) {
    console.error(`[commercial-acs] only got ${finalChunks.length} chunks after dedup+filter — heading regex may be wrong`);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const index = finalChunks.map((c, i) => ({
    chunkId: c.chunkId || `c${i}`,
    title: c.title,
    page: c.page,
  }));
  await writeFile(`${OUTPUT_DIR}/index.json`, JSON.stringify(index, null, 2));
  await writeFile(
    `${OUTPUT_DIR}/chunks.json`,
    JSON.stringify(
      finalChunks.map((c, i) => ({
        chunkId: c.chunkId || `c${i}`,
        title: c.title,
        text: c.text,
      })),
      null,
      2,
    ),
  );
  console.log(`[commercial-acs] wrote ${finalChunks.length} chunks → ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
