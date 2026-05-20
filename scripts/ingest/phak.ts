/**
 * PHAK (Pilot's Handbook of Aeronautical Knowledge) ingest.
 *
 * Downloads the FAA's current PHAK PDF, extracts text via pdfjs-dist,
 * chunks by chapter section, and writes JSON to public/data/learn/phak/.
 * Vite serves public/ in dev and bundles it in build, so the static
 * site picks the JSON up automatically.
 *
 * PDFs cached locally in data/learn/_pdfs/ (gitignored). CI cache
 * restores them so we don't redownload on every push.
 *
 *   bun scripts/ingest/phak.ts          # use cache if present
 *   bun scripts/ingest/phak.ts --force  # re-download
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractPdfText } from "./_pdf-extract.ts";
import { chunkByHeading } from "./_chunker.ts";

// The FAA's current full PHAK (FAA-H-8083-25C). Found via
// https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak
// — if this 404s, browse that page for the new "full" PDF link.
const SOURCE_URL =
  "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/faa-h-8083-25c.pdf";
const PDF_PATH = "data/learn/_pdfs/phak.pdf";
const OUTPUT_DIR = "public/data/learn/phak";

async function downloadIfMissing(force: boolean): Promise<void> {
  if (existsSync(PDF_PATH) && !force) {
    console.log(`[phak] using cached ${PDF_PATH}`);
    return;
  }
  console.log(`[phak] downloading from ${SOURCE_URL}…`);
  // Some CDNs (incl. faa.gov edge) 403 requests with no UA header.
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "flightpath-learn-ingest/1.0 (+https://github.com/)" },
  });
  if (!res.ok) {
    console.error(`[phak] fetch failed: ${res.status} ${res.statusText} for ${SOURCE_URL}`);
    process.exit(1);
  }
  const buf = await res.arrayBuffer();
  await mkdir(dirname(PDF_PATH), { recursive: true });
  await Bun.write(PDF_PATH, buf);
  console.log(`[phak] cached ${PDF_PATH} (${buf.byteLength} bytes)`);
}

async function main() {
  const force = process.argv.includes("--force");
  await downloadIfMissing(force);

  console.log("[phak] extracting text…");
  const pages = await extractPdfText(PDF_PATH);
  console.log(`[phak] ${pages.length} pages extracted`);

  // PHAK chapter sections look like "1-1 Introduction" or "4-2 Forces in Flight"
  // at the start of a line. Chapter titles are "Chapter N Title".
  //
  // Tightening notes:
  //   - The section group requires `[A-Z][a-z]` after the number so we don't
  //     match figure refs like "14-3 — 8" or page refs like "4-2 5" as
  //     section headings.
  //   - The dot-leader skipLineRegex (5+ consecutive dots anywhere in a line)
  //     drops every TOC line. That's a universal indicator for TOC dot-leaders
  //     and eliminates the entire front-matter TOC noise in one rule.
  const headingRegex = /^(?:(Chapter\s+\d+)(?:\s+.+)?|(\d+[-]\d+)\s+([A-Z][a-z][^\n]+))$/;

  const chunks = chunkByHeading(pages, {
    headingRegex,
    titleFor: (m) => (m[1] ? m[1] : `${m[2]} — ${m[3]}`).trim(),
    skipLineRegex:
      /\.{5,}|^(?:Pilot's Handbook of Aeronautical Knowledge|FAA-H-8083-25C|\d+-\d+$|Page \d+)$/i,
  });

  // Dedupe by chunkId — TOC entries and actual chapter starts can collide
  // ("Chapter 4" appears in front-matter and at the real chapter start).
  // Keep the chunk with more body text since that's the real one.
  // Then drop tiny chunks (≤ 200 chars) — these are heading-match ghosts
  // where every body line got skipped by the dot-leader filter (TOC pages)
  // or where the regex caught a stray running-header reference.
  const byId = new Map<string, (typeof chunks)[number]>();
  for (const c of chunks) {
    const existing = byId.get(c.chunkId);
    if (!existing || c.text.length > existing.text.length) byId.set(c.chunkId, c);
  }
  const finalChunks = [...byId.values()].filter((c) => c.text.length > 200);

  // Threshold tuned for chapter-only chunking after oversized-split fans
  // chapters into sub-chunks. PHAK has 17 chapters; with splitOversized we
  // expect well over 100 sub-chunks.
  if (finalChunks.length < 60) {
    console.error(`[phak] only got ${finalChunks.length} chunks after dedup+filter — heading regex may be wrong`);
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
  console.log(`[phak] wrote ${finalChunks.length} chunks → ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
