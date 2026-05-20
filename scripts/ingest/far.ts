/**
 * FAR (Federal Aviation Regulations) ingest — Parts 61, 91, 119, 135, 141.
 *
 * The FARs are published in many places (eCFR, govinfo, FAA mirrors).
 * The plan originally pointed at eCFR's renderer endpoint, but that
 * endpoint now rejects the `format=pdf` parameter and only serves
 * HTML. govinfo.gov mirrors the official annual CFR snapshot and
 * exposes per-part PDFs at predictable URLs:
 *
 *   https://www.govinfo.gov/content/pkg/CFR-<year>-title14-vol<N>/pdf/CFR-<year>-title14-vol<N>-part<N>.pdf
 *
 * Title 14 is split across multiple volumes; the parts a low-time CFI
 * touches map to volumes 2 and 3 of the 2024 edition:
 *
 *   Part 61, 91  -> vol 2
 *   Part 119, 135, 141 -> vol 3
 *
 * If a URL fails, the script continues with the remaining parts.
 *
 *   bun scripts/ingest/far.ts
 *   bun scripts/ingest/far.ts --force
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractPdfText } from "./_pdf-extract.ts";
import { chunkByHeading, type Chunk } from "./_chunker.ts";

type PartSource = { part: number; url: string };

// govinfo CFR Title 14, edition year 2024 — bump if a future year's
// PDFs replace these. If govinfo moves the file, FAA's regs portal
// at https://www.faa.gov/regulations_policies/faa_regulations links
// per-part downloads as a manual fallback.
const CFR_YEAR = 2024;
const govinfoUrl = (vol: number, part: number) =>
  `https://www.govinfo.gov/content/pkg/CFR-${CFR_YEAR}-title14-vol${vol}/pdf/CFR-${CFR_YEAR}-title14-vol${vol}-part${part}.pdf`;

const PARTS: PartSource[] = [
  { part: 61, url: govinfoUrl(2, 61) },
  { part: 91, url: govinfoUrl(2, 91) },
  { part: 119, url: govinfoUrl(3, 119) },
  { part: 135, url: govinfoUrl(3, 135) },
  { part: 141, url: govinfoUrl(3, 141) },
];

const OUTPUT_DIR = "public/data/learn/far";
const PDF_DIR = "data/learn/_pdfs";
const UA = "flightpath-build (+https://github.com/MohamedSerhan/flightpath)";

async function downloadPart(p: PartSource, force: boolean): Promise<string | null> {
  const pdfPath = `${PDF_DIR}/far-part-${p.part}.pdf`;
  if (existsSync(pdfPath) && !force) {
    console.log(`[far] using cached ${pdfPath}`);
    return pdfPath;
  }
  console.log(`[far] downloading Part ${p.part} from ${p.url}…`);
  try {
    const res = await fetch(p.url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`[far] Part ${p.part} fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("pdf")) {
      console.error(`[far] Part ${p.part} unexpected content-type: ${ct}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    await mkdir(dirname(pdfPath), { recursive: true });
    await Bun.write(pdfPath, buf);
    console.log(`[far] cached ${pdfPath} (${buf.byteLength} bytes)`);
    return pdfPath;
  } catch (err) {
    console.error(`[far] Part ${p.part} error:`, err);
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const allChunks: Chunk[] = [];
  for (const p of PARTS) {
    const path = await downloadPart(p, force);
    if (!path) continue;
    const pages = await extractPdfText(path);
    console.log(`[far] Part ${p.part}: ${pages.length} pages`);

    // FAR section headings look like: "§ 61.65 Instrument rating requirements."
    // The § symbol may render as "Â§" or "§" depending on the PDF
    // encoding; we accept both, plus the spelled-out "Section"
    // fallback. We require the § prefix because the bare numeric form
    // also appears throughout each Part's table-of-contents and in
    // cross-references inside body text, which would otherwise
    // generate hundreds of false-positive chunks.
    const headingRegex = new RegExp(
      `^(?:§|Â§|Section\\s)\\s*(${p.part}\\.\\d{1,4})\\s+(.+?)(?:\\.|$)`,
    );

    const partChunks = chunkByHeading(pages, {
      headingRegex,
      titleFor: (m) => `§ ${m[1]} — ${m[2].replace(/\.$/, "").trim()}`,
      skipLineRegex: /^(?:Page \d+|\d+ CFR Ch\.|Title 14|VerDate|Jkt \d+|PO \d+|Frm \d+|Fmt \d+|Sfmt \d+|E:\\)/i,
    });

    for (const c of partChunks) {
      allChunks.push({
        ...c,
        chunkId: `p${p.part}-${c.chunkId}`,
        title: `Part ${p.part}: ${c.title}`,
      });
    }
    console.log(`[far] Part ${p.part}: produced ${partChunks.length} chunks`);
  }

  // Drop tiny chunks — § heading matches inside running headers / TOC
  // entries leave near-empty ghosts behind. Real sections always have
  // substantive regulatory text.
  const finalChunks = allChunks.filter((c) => c.text.length > 200);
  const dropped = allChunks.length - finalChunks.length;
  if (dropped > 0) console.log(`[far] dropped ${dropped} tiny/empty chunks`);

  if (finalChunks.length < 50) {
    console.error(`[far] only got ${finalChunks.length} chunks after filter — heading regex or downloads may be off`);
    process.exit(1);
  }

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
  console.log(`[far] wrote ${finalChunks.length} chunks → ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
