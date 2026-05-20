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
  // at the start of a line. Chapter titles are "Chapter N Title" or
  // "Chapter N — Title". We chunk on either pattern.
  const headingRegex = /^(?:(Chapter\s+\d+)\b[^\n]*|(\d+[-]\d+)\s+(.+))$/;

  const chunks = chunkByHeading(pages, {
    headingRegex,
    titleFor: (m) => (m[1] ? m[1] : `${m[2]} — ${m[3]}`).trim(),
    skipLineRegex: /^(?:Pilot's Handbook of Aeronautical Knowledge|FAA-H-8083-25C|\d+-\d+$|Page \d+)$/i,
  });

  if (chunks.length < 30) {
    console.error(`[phak] only got ${chunks.length} chunks — heading regex may be wrong`);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const index = chunks.map((c, i) => ({
    chunkId: c.chunkId || `c${i}`,
    title: c.title,
    page: c.page,
  }));
  await writeFile(`${OUTPUT_DIR}/index.json`, JSON.stringify(index, null, 2));
  await writeFile(
    `${OUTPUT_DIR}/chunks.json`,
    JSON.stringify(
      chunks.map((c, i) => ({
        chunkId: c.chunkId || `c${i}`,
        title: c.title,
        text: c.text,
      })),
      null,
      2,
    ),
  );
  console.log(`[phak] wrote ${chunks.length} chunks → ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
