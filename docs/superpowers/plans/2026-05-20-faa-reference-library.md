# FAA reference library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/learn` surface that hosts PHAK, Commercial Pilot ACS, and FAR (Part 61/91/141 focus) as searchable text chunks ingested from the official FAA PDFs at build time.

**Architecture:** Build-time ingest pipeline (`pdfjs-dist` in Bun) downloads each PDF, extracts text page-by-page, chunks into sections via doc-specific heading regex, and writes JSON into `public/data/learn/` so Vite serves it automatically in both dev and prod. The React UI gets a new `/learn` route detected via `BASE_URL`-aware path matching; routing inside `/learn` uses hash params. No server-side work, no LLM, no third-party API at request time.

**Tech Stack:** Bun (build-time scripts), TypeScript, `pdfjs-dist` (new dep, build-only), React 18 + Tailwind UI, Vite static bundling.

**Spec:** [docs/superpowers/specs/2026-05-20-faa-reference-library-design.md](../specs/2026-05-20-faa-reference-library-design.md)

**Verification regime:** No automated test suite. Each task uses ad-hoc `bun -e` scripts, `bunx tsc --noEmit`, and `bun run build:static` smoke checks. The final task does live deploy verification.

---

### Task 1: Add `pdfjs-dist`, shared PDF extractor, and chunker helpers

**Goal:** Get the build-time PDF parsing infrastructure in place — install `pdfjs-dist`, write a shared `_pdf-extract.ts` (yields lines per page) and `_chunker.ts` (groups lines into chunks by configurable heading regex). No PDFs ingested yet; helpers tested with a tiny PDF fixture.

**Files:**
- Modify: `package.json` (add `pdfjs-dist` to devDependencies)
- Create: `scripts/ingest/_pdf-extract.ts`
- Create: `scripts/ingest/_chunker.ts`

**Acceptance Criteria:**
- [ ] `pdfjs-dist` added to devDependencies (use latest 4.x or 5.x, whichever is current)
- [ ] `bunx pdfjs-dist --version` or equivalent confirms install
- [ ] `_pdf-extract.ts` exports `extractPdfText(pdfPath: string): Promise<{ page: number; lines: string[] }[]>`
- [ ] `_chunker.ts` exports `chunkByHeading(pages, headingRegex, opts): { chunkId: string; title: string; text: string }[]`
- [ ] Both helpers typecheck and run against a tiny test PDF without throwing

**Verify:**

```bash
bunx tsc --noEmit
# Sanity check the extractor with the existing flightpath.db SQLite file's "binary header" path? No — need a real PDF.
# Use a tiny known PDF: download the FAA PHAK chapter 1 standalone (~500 KB) if available, or use pdfjs-dist's own test PDF:
bun -e "
import { extractPdfText } from './scripts/ingest/_pdf-extract.ts';
// Bun ships with a built-in test PDF? No. Just download a small one from a stable URL:
const url = 'https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/phak/00_phak_cover.pdf';
const buf = await (await fetch(url)).arrayBuffer();
await Bun.write('/tmp/test.pdf', buf);
const pages = await extractPdfText('/tmp/test.pdf');
console.log('pages:', pages.length, 'lines on first:', pages[0]?.lines.length);
if (pages.length === 0) { console.error('FAIL'); process.exit(1); }
console.log('OK');
"
```

Expected: prints page count and line count, exits 0. (If the FAA cover URL 404s — most likely on the first try — substitute any small PDF URL. The point is exercising the helper, not the specific source.)

**Steps:**

- [ ] **Step 1: Install pdfjs-dist**

```bash
bun add -d pdfjs-dist
```

Confirm in `package.json` it's now in `devDependencies`.

- [ ] **Step 2: Write the PDF extractor**

Create `scripts/ingest/_pdf-extract.ts`:

```ts
/**
 * Shared PDF text extractor for the FAA reference library ingest scripts.
 *
 * Wraps pdfjs-dist. Reads a local PDF file, returns an array of pages
 * each with its raw text lines. Per-doc chunkers consume this output
 * and group lines into sections via heading regex.
 *
 * Build-time only — never imported by the client bundle.
 */

import { readFile } from "node:fs/promises";

export type PdfPage = {
  page: number;
  lines: string[];
};

export async function extractPdfText(pdfPath: string): Promise<PdfPage[]> {
  // pdfjs-dist's legacy build is the Node-friendly entry — the modern
  // ESM build wants browser globals we don't have under Bun.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Disable the worker — we're already in a worker-like script context.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const pages: PdfPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    // Group items by y-position to recover line structure. pdfjs returns
    // text "items" with x/y coords; same-line items have ~equal y.
    const byY = new Map<number, string[]>();
    for (const item of textContent.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str.trim()) continue;
      // transform[5] is the y-coordinate; round to suppress sub-pixel drift.
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push(item.str);
    }
    // Sort descending y → top-to-bottom reading order.
    const lines: string[] = [];
    const sortedYs = [...byY.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const line = byY.get(y)!.join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
    pages.push({ page: i, lines });
  }
  return pages;
}
```

- [ ] **Step 3: Write the chunker**

Create `scripts/ingest/_chunker.ts`:

```ts
/**
 * Shared chunker: groups extracted PDF lines into named chunks
 * by a heading regex. Each per-doc ingest script provides a regex
 * that matches its section headings; the chunker walks the line
 * stream and starts a new chunk every time a heading fires.
 *
 * Build-time only.
 */

import type { PdfPage } from "./_pdf-extract.ts";

export type Chunk = {
  chunkId: string;          // stable slug-style id, e.g. "ch-4-2"
  title: string;            // human-readable, e.g. "Chapter 4 — Forces in Flight"
  text: string;             // joined section text
  page: number;             // first page the chunk appears on
};

export type ChunkerOptions = {
  /** Regex that matches a heading line. The first capture group
   *  is used as the chunkId (slugified). */
  headingRegex: RegExp;
  /** Optional transform applied to the captured group to produce
   *  the title (default: trim + collapse whitespace). */
  titleFor?: (match: RegExpExecArray) => string;
  /** Skip these lines anywhere (page headers, footers, copyright). */
  skipLineRegex?: RegExp;
  /** Hard cap on chunk text length; longer chunks are kept anyway
   *  but a warning is logged. Default 12_000. */
  maxChars?: number;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function chunkByHeading(pages: PdfPage[], opts: ChunkerOptions): Chunk[] {
  const maxChars = opts.maxChars ?? 12_000;
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;

  for (const { page, lines } of pages) {
    for (const line of lines) {
      if (opts.skipLineRegex && opts.skipLineRegex.test(line)) continue;
      opts.headingRegex.lastIndex = 0;
      const m = opts.headingRegex.exec(line);
      if (m) {
        if (current) chunks.push(current);
        const title = opts.titleFor ? opts.titleFor(m) : m[0].trim();
        const id = m[1] ? slugify(m[1]) : slugify(title);
        current = { chunkId: id, title: title.replace(/\s+/g, " ").trim(), text: "", page };
      } else if (current) {
        current.text += (current.text ? " " : "") + line;
      }
    }
  }
  if (current) chunks.push(current);

  for (const c of chunks) {
    if (c.text.length > maxChars) {
      console.warn(`[chunker] chunk ${c.chunkId} is ${c.text.length} chars (cap ${maxChars}) — keeping but flagging`);
    }
  }
  return chunks;
}
```

- [ ] **Step 4: Sanity test with a small PDF**

Run:

```bash
mkdir -p /tmp/pdftest
bun -e "
import { extractPdfText } from './scripts/ingest/_pdf-extract.ts';
import { chunkByHeading } from './scripts/ingest/_chunker.ts';

// Use any small public PDF. pdfjs-dist's repo ships with a sample.
const url = 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf';
const buf = await (await fetch(url)).arrayBuffer();
await Bun.write('/tmp/pdftest/sample.pdf', buf);
const pages = await extractPdfText('/tmp/pdftest/sample.pdf');
console.log('pages:', pages.length);
const chunks = chunkByHeading(pages, {
  headingRegex: /^(\d+\.?\s+[A-Z][A-Za-z ]+)$/,
  skipLineRegex: /^Page \\d+$/,
});
console.log('chunks:', chunks.length);
console.log('first chunk:', chunks[0]?.title, '-', chunks[0]?.text.slice(0, 80));
if (pages.length === 0) { console.error('FAIL: 0 pages'); process.exit(1); }
console.log('OK');
"
```

Expected: pages > 0, OK, exit 0. Chunks count may be 0 or a few — depends on the sample PDF's heading style; we're just verifying the helpers don't crash.

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lockb scripts/ingest/_pdf-extract.ts scripts/ingest/_chunker.ts
git commit -m "feat(learn): pdfjs-dist + shared extractor and chunker

Build-time helpers for the FAA reference library ingest pipeline.
extractPdfText() returns text lines per page; chunkByHeading()
groups them into named sections via a doc-specific heading regex.
Both used by the per-doc ingest scripts in subsequent commits."
```

```json:metadata
{"files":["package.json","scripts/ingest/_pdf-extract.ts","scripts/ingest/_chunker.ts"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["pdfjs-dist installed","extractPdfText helper works","chunkByHeading helper works","Sanity-test PDF extracts without throwing"]}
```

---

### Task 2: PHAK ingest script

**Goal:** Download the latest PHAK PDF, extract via the shared helpers, write `public/data/learn/phak/{index,chunks}.json`. The chunker uses a heading regex tuned to PHAK's "Chapter N — Title" + "N-M Section Title" layout.

**Files:**
- Create: `scripts/ingest/phak.ts`

**Acceptance Criteria:**
- [ ] Script downloads PHAK PDF (cached to `data/learn/_pdfs/phak.pdf` if not already there)
- [ ] Produces `public/data/learn/phak/index.json` (TOC) and `chunks.json` (text)
- [ ] At least 30 chunks generated (sanity check — PHAK has 16+ chapters, each with subsections)
- [ ] No chunks have empty text
- [ ] Script exits 0

**Verify:**

```bash
bun scripts/ingest/phak.ts
bun -e "
const idx = await Bun.file('public/data/learn/phak/index.json').json();
const chunks = await Bun.file('public/data/learn/phak/chunks.json').json();
console.log('toc entries:', idx.length, 'chunks:', chunks.length);
const empty = chunks.filter(c => !c.text || c.text.length < 50);
console.log('empty/tiny chunks:', empty.length);
if (chunks.length < 30) { console.error('FAIL: chunk count too low'); process.exit(1); }
console.log('OK');
"
```

Expected: TOC and chunks files written, chunks ≥ 30, empty ≤ 5% of total, OK.

**Steps:**

- [ ] **Step 1: Write the script**

Create `scripts/ingest/phak.ts`:

```ts
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
import { chunkByHeading, type Chunk } from "./_chunker.ts";

const SOURCE_URL =
  "https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/phak/00_phak_full.pdf";
const PDF_PATH = "data/learn/_pdfs/phak.pdf";
const OUTPUT_DIR = "public/data/learn/phak";

async function downloadIfMissing(force: boolean): Promise<void> {
  if (existsSync(PDF_PATH) && !force) {
    console.log(`[phak] using cached ${PDF_PATH}`);
    return;
  }
  console.log(`[phak] downloading from ${SOURCE_URL}…`);
  const res = await fetch(SOURCE_URL);
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
    // Skip page headers / footers / chapter dividers that pdfjs sometimes
    // surfaces as standalone lines.
    skipLineRegex: /^(?:Pilot's Handbook of Aeronautical Knowledge|FAA-H-8083-25C|\d+-\d+$|Page \d+)$/i,
  });

  // Sanity check
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
```

- [ ] **Step 2: Run the script**

```bash
bun scripts/ingest/phak.ts
```

Expected: downloads PDF (or uses cache), extracts pages, writes index/chunks JSON. Prints `[phak] wrote N chunks`.

**If the download fails** (FAA URL changed, transient 404): the script prints the URL it tried. Hit https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak in a browser, find the new "Pilot's Handbook of Aeronautical Knowledge (Full)" PDF link, update `SOURCE_URL` in the script, and re-run.

**If chunk count is too low** (the heading regex didn't catch the doc's actual headings): inspect what `pdfjs-dist` is actually producing per page by adding a temporary `console.log(pages[10])` to the script, look at the line shapes, and adjust the regex.

- [ ] **Step 3: Verify output**

(Use the bun -e block from the **Verify** section above.)

Expected: TOC count > 30, chunks count > 30, empty chunks rare.

- [ ] **Step 4: Add .gitignore entry for the cached PDFs**

Edit `.gitignore` (create if missing) and append:

```
# FAA PDF cache for the learn-surface ingest (re-downloaded by CI).
data/learn/_pdfs/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/phak.ts public/data/learn/phak/ .gitignore
git commit -m "feat(learn): PHAK ingest

Downloads the FAA's current PHAK PDF and extracts it into TOC +
chunk JSON committed to public/data/learn/phak/. Cached PDFs live
in data/learn/_pdfs/ which is gitignored — CI re-downloads or
restores from actions cache."
```

```json:metadata
{"files":["scripts/ingest/phak.ts","public/data/learn/phak/index.json","public/data/learn/phak/chunks.json",".gitignore"],"verifyCommand":"bun scripts/ingest/phak.ts","acceptanceCriteria":["PDF downloaded and cached","TOC json written","Chunks json written","≥30 chunks generated","Empty chunks rare"]}
```

---

### Task 3: Commercial Pilot ACS ingest script

**Goal:** Same shape as Task 2, for the Commercial Pilot ACS. Smaller doc (~80 pages); chunks by "Area of Operation" + "Task".

**Files:**
- Create: `scripts/ingest/commercial-acs.ts`

**Acceptance Criteria:**
- [ ] Script downloads Commercial ACS PDF (cached to `data/learn/_pdfs/commercial-acs.pdf`)
- [ ] Produces `public/data/learn/commercial-acs/index.json` + `chunks.json`
- [ ] At least 10 chunks (ACS has ~9 Areas of Operation, each with multiple Tasks)
- [ ] Script exits 0

**Verify:** Same shape as Task 2 — bun -e checks the file shape and chunk count threshold (here ≥ 10).

**Steps:**

- [ ] **Step 1: Write the script**

Create `scripts/ingest/commercial-acs.ts`:

```ts
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

const SOURCE_URL =
  "https://www.faa.gov/sites/faa.gov/files/training_testing/testing/acs/commercial_pilot_acs.pdf";
const PDF_PATH = "data/learn/_pdfs/commercial-acs.pdf";
const OUTPUT_DIR = "public/data/learn/commercial-acs";

async function downloadIfMissing(force: boolean): Promise<void> {
  if (existsSync(PDF_PATH) && !force) {
    console.log(`[commercial-acs] using cached ${PDF_PATH}`);
    return;
  }
  console.log(`[commercial-acs] downloading from ${SOURCE_URL}…`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    console.error(`[commercial-acs] fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const buf = await res.arrayBuffer();
  await mkdir(dirname(PDF_PATH), { recursive: true });
  await Bun.write(PDF_PATH, buf);
}

async function main() {
  const force = process.argv.includes("--force");
  await downloadIfMissing(force);

  const pages = await extractPdfText(PDF_PATH);
  console.log(`[commercial-acs] ${pages.length} pages`);

  // ACS headings: "Area of Operation: I. Preflight Preparation"
  //               "Task A. Pilot Qualifications"
  const headingRegex =
    /^(?:(Area of Operation\s*:\s*[IVX]+\.\s+.+)|(Task\s+[A-Z]\.\s+.+))$/;

  const chunks = chunkByHeading(pages, {
    headingRegex,
    titleFor: (m) => (m[1] ?? m[2]).trim(),
    skipLineRegex:
      /^(?:Commercial Pilot — Airplane|FAA-S-ACS-7B|Page \d+|Airman Certification Standards)$/i,
  });

  if (chunks.length < 10) {
    console.error(`[commercial-acs] only got ${chunks.length} chunks — heading regex may be wrong`);
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
  console.log(`[commercial-acs] wrote ${chunks.length} chunks → ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run + verify**

```bash
bun scripts/ingest/commercial-acs.ts
bun -e "
const idx = await Bun.file('public/data/learn/commercial-acs/index.json').json();
const chunks = await Bun.file('public/data/learn/commercial-acs/chunks.json').json();
console.log('toc:', idx.length, 'chunks:', chunks.length);
if (chunks.length < 10) { console.error('FAIL'); process.exit(1); }
console.log('OK');
"
```

If the URL 404s, browse to https://www.faa.gov/training_testing/testing/acs and find the current Commercial ACS PDF link. Update `SOURCE_URL` and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest/commercial-acs.ts public/data/learn/commercial-acs/
git commit -m "feat(learn): Commercial Pilot ACS ingest

FAA-S-ACS-7B downloaded, extracted, and chunked by Area of
Operation and Task."
```

```json:metadata
{"files":["scripts/ingest/commercial-acs.ts","public/data/learn/commercial-acs/index.json","public/data/learn/commercial-acs/chunks.json"],"verifyCommand":"bun scripts/ingest/commercial-acs.ts","acceptanceCriteria":["PDF downloaded","TOC + chunks written","≥10 chunks generated"]}
```

---

### Task 4: FAR ingest script

**Goal:** Same shape, FAR portion of FAR/AIM. The FAA publishes individual parts as PDFs; we'll pull Parts 61, 91, 119, 135, 141 (the parts a low-time CFI most often touches) and concatenate into a single doc.

**Files:**
- Create: `scripts/ingest/far.ts`

**Acceptance Criteria:**
- [ ] Script downloads PDFs for Parts 61, 91, 119, 135, 141 (skip individually-failed parts but continue)
- [ ] Produces `public/data/learn/far/index.json` + `chunks.json`
- [ ] At least 50 chunks (each Part has many sections)
- [ ] Each chunk's title includes the Part number for grouping

**Verify:** Same shape — bun -e checks chunk count ≥ 50.

**Steps:**

- [ ] **Step 1: Write the script**

Create `scripts/ingest/far.ts`:

```ts
/**
 * FAR (Federal Aviation Regulations) ingest — Parts 61, 91, 119, 135, 141.
 *
 * The FAA publishes the FARs through eCFR. The most stable per-part
 * PDF URLs use the GPO Title 14 CFR endpoints. We fetch each part's
 * PDF, extract, chunk by section, and concatenate.
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

const PARTS: PartSource[] = [
  { part: 61, url: "https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-01-01/title-14?part=61&format=pdf" },
  { part: 91, url: "https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-01-01/title-14?part=91&format=pdf" },
  { part: 119, url: "https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-01-01/title-14?part=119&format=pdf" },
  { part: 135, url: "https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-01-01/title-14?part=135&format=pdf" },
  { part: 141, url: "https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-01-01/title-14?part=141&format=pdf" },
];

const OUTPUT_DIR = "public/data/learn/far";
const PDF_DIR = "data/learn/_pdfs";

async function downloadPart(p: PartSource, force: boolean): Promise<string | null> {
  const pdfPath = `${PDF_DIR}/far-part-${p.part}.pdf`;
  if (existsSync(pdfPath) && !force) return pdfPath;
  console.log(`[far] downloading Part ${p.part}…`);
  try {
    const res = await fetch(p.url, { headers: { "User-Agent": "flightpath-build (+https://github.com/MohamedSerhan/flightpath)" } });
    if (!res.ok) {
      console.error(`[far] Part ${p.part} fetch failed: ${res.status}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    await mkdir(dirname(pdfPath), { recursive: true });
    await Bun.write(pdfPath, buf);
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

    // FAR section headings: "§ 61.65 Instrument rating requirements."
    const headingRegex = /^§\s*(\d{1,3}\.\d{1,4})\s+(.+?)(?:\.|$)/;
    const partChunks = chunkByHeading(pages, {
      headingRegex,
      titleFor: (m) => `§ ${m[1]} — ${m[2].replace(/\.$/, "")}`,
      skipLineRegex: /^(?:Page \d+|\d+ CFR Ch\.|Title 14)/i,
    });
    // Prepend the part to chunkIds and titles so the global namespace stays clean.
    for (const c of partChunks) {
      allChunks.push({
        ...c,
        chunkId: `p${p.part}-${c.chunkId}`,
        title: `Part ${p.part}: ${c.title}`,
      });
    }
  }

  if (allChunks.length < 50) {
    console.error(`[far] only got ${allChunks.length} chunks — heading regex or downloads may be off`);
    process.exit(1);
  }

  const index = allChunks.map((c, i) => ({
    chunkId: c.chunkId || `c${i}`,
    title: c.title,
    page: c.page,
  }));
  await writeFile(`${OUTPUT_DIR}/index.json`, JSON.stringify(index, null, 2));
  await writeFile(
    `${OUTPUT_DIR}/chunks.json`,
    JSON.stringify(
      allChunks.map((c, i) => ({
        chunkId: c.chunkId || `c${i}`,
        title: c.title,
        text: c.text,
      })),
      null,
      2,
    ),
  );
  console.log(`[far] wrote ${allChunks.length} chunks → ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run + verify**

```bash
bun scripts/ingest/far.ts
bun -e "
const idx = await Bun.file('public/data/learn/far/index.json').json();
const chunks = await Bun.file('public/data/learn/far/chunks.json').json();
console.log('toc:', idx.length, 'chunks:', chunks.length);
if (chunks.length < 50) { console.error('FAIL'); process.exit(1); }
console.log('OK');
"
```

If a Part's URL 404s, the script skips it and continues. Check the eCFR site for the current per-part PDF URL and update.

**Risk: eCFR PDF endpoint may not exist as written above.** If `https://www.ecfr.gov/api/renderer/v1/content/enhanced/2025-01-01/title-14?part=61&format=pdf` returns 404, fall back to the federalregister.gov or govinfo.gov sources. The faa.gov "regulations and policies" landing page has authoritative links. Document whichever URLs work in the script's comment.

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest/far.ts public/data/learn/far/
git commit -m "feat(learn): FAR Parts 61/91/119/135/141 ingest

Pulls each Part's official PDF, extracts via pdfjs-dist, chunks by
section (§ N.NN). Concatenated into a single FAR doc namespace
prefixed by part number."
```

```json:metadata
{"files":["scripts/ingest/far.ts","public/data/learn/far/index.json","public/data/learn/far/chunks.json"],"verifyCommand":"bun scripts/ingest/far.ts","acceptanceCriteria":["At least 4 of 5 Parts downloaded","TOC + chunks written","≥50 chunks total","Each chunk includes Part number in title"]}
```

---

### Task 5: Orchestrator + search index

**Goal:** Single entry-point `scripts/ingest-faa-docs.ts` that runs the three per-doc scripts and builds a flat `search-index.json` covering all chunks.

**Files:**
- Create: `scripts/ingest-faa-docs.ts`
- Create: `public/data/learn/search-index.json` (output)

**Acceptance Criteria:**
- [ ] Orchestrator runs all three per-doc scripts via `Bun.spawn`
- [ ] Continues if one doc fails (logs but doesn't exit)
- [ ] After all docs complete, reads each `chunks.json` and builds `search-index.json`
- [ ] Search index has one entry per chunk: `{ docId, docTitle, chunkId, title, snippet }`
- [ ] Snippet is first ~200 chars of chunk text

**Verify:**

```bash
bun scripts/ingest-faa-docs.ts
bun -e "
const search = await Bun.file('public/data/learn/search-index.json').json();
console.log('search entries:', search.length);
console.log('sample:', search.slice(0, 2));
const byDoc = {};
for (const e of search) byDoc[e.docId] = (byDoc[e.docId] ?? 0) + 1;
console.log('by doc:', byDoc);
if (search.length < 80) { console.error('FAIL'); process.exit(1); }
console.log('OK');
"
```

Expected: search-index has ≥ 80 entries across the three docs, three doc IDs represented.

**Steps:**

- [ ] **Step 1: Write the orchestrator**

Create `scripts/ingest-faa-docs.ts`:

```ts
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
```

- [ ] **Step 2: Run + verify**

```bash
bun scripts/ingest-faa-docs.ts
```

(Use the bun -e block from the **Verify** section above.)

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest-faa-docs.ts public/data/learn/search-index.json
git commit -m "feat(learn): ingest orchestrator + cross-doc search index

Runs the three per-doc scripts and builds a flat search-index.json
with { docId, docTitle, chunkId, title, snippet } for each chunk.
Continues if one doc fails so the build doesn't catastrophically
break on a single bad source URL."
```

```json:metadata
{"files":["scripts/ingest-faa-docs.ts","public/data/learn/search-index.json"],"verifyCommand":"bun scripts/ingest-faa-docs.ts","acceptanceCriteria":["Orchestrator runs all 3 ingest scripts","Search index built across docs","≥80 entries total","Three docIds represented"]}
```

---

### Task 6: package.json script + CI cache for PDFs

**Goal:** Wire `build:learn` into npm scripts so `build:static` invokes it. Add a GitHub Actions cache for `data/learn/_pdfs/` so subsequent builds don't redownload.

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/scrape-and-deploy.yml`

**Acceptance Criteria:**
- [ ] `bun run build:learn` runs the orchestrator
- [ ] `bun run build:static` runs `build:learn` first
- [ ] CI workflow has a step that caches `data/learn/_pdfs/` keyed by month-bucket (so revisions are picked up monthly without manual intervention)
- [ ] CI workflow runs `bun run build:learn` before the existing `bun run build:static`

**Verify:**

```bash
bun run build:learn
bun run build:static 2>&1 | tail -10
ls dist/web/data/learn/
```

Expected: `build:learn` invokes the orchestrator; `build:static` succeeds and copies the JSON into `dist/web/data/learn/`.

**Steps:**

- [ ] **Step 1: Update package.json**

Add `build:learn` to the `scripts` block, and prepend it to `build:static`:

```json
{
  "scripts": {
    "build:learn": "bun scripts/ingest-faa-docs.ts",
    "build:static": "bun run build:learn && VITE_STATIC_DATA=1 vite build && bun src/scrapers/export.ts && bun src/scrapers/export-rss.ts"
  }
}
```

(Merge with existing scripts; don't replace the whole block.)

- [ ] **Step 2: Update CI workflow**

Edit `.github/workflows/scrape-and-deploy.yml`. Find the existing "Restore listings DB cache" step. Add a parallel cache step for PDFs immediately after:

```yaml
      - name: Cache FAA PDFs
        uses: actions/cache@v4
        with:
          path: data/learn/_pdfs
          # Month-bucket key so we re-download monthly (catches FAA revisions
          # without manual intervention).
          key: faa-pdfs-${{ github.run_id }}-${{ steps.now.outputs.month }}
          restore-keys: |
            faa-pdfs-
```

The `${{ steps.now.outputs.month }}` reference needs a small new step before the cache step:

```yaml
      - name: Compute month bucket
        id: now
        run: echo "month=$(date +%Y-%m)" >> "$GITHUB_OUTPUT"
```

Place this BEFORE the "Cache FAA PDFs" step.

- [ ] **Step 3: Local verification**

```bash
bun run build:learn
bun run build:static 2>&1 | tail -10
ls -la dist/web/data/learn/
```

Expected: `build:learn` invokes the orchestrator (cached PDFs, so quick). `build:static` builds the Vite bundle and copies `public/data/learn/` into `dist/web/data/learn/` automatically (Vite handles public/ → dist).

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/scrape-and-deploy.yml
git commit -m "feat(learn): wire build:learn into build:static + CI PDF cache

build:learn runs the ingest orchestrator. build:static now invokes
it first. CI gets a month-bucket cache for the FAA PDFs so we
re-download monthly without manual intervention."
```

```json:metadata
{"files":["package.json",".github/workflows/scrape-and-deploy.yml"],"verifyCommand":"bun run build:static","acceptanceCriteria":["build:learn script added","build:static invokes it","CI workflow caches FAA PDFs"]}
```

---

### Task 7: `/learn` route data layer + types

**Goal:** Set up the React route's data fetching layer with typed lazy fetchers and a shared types file. No UI yet.

**Files:**
- Create: `src/web/learn/types.ts`
- Create: `src/web/learn/data.ts`

**Acceptance Criteria:**
- [ ] Types file exports `LearnChunk`, `LearnTocEntry`, `LearnSearchHit`, `LearnDocId`
- [ ] Data file exports `getDocIndex(docId)`, `getDocChunks(docId)`, `getSearchIndex()` — all async, cached in-memory
- [ ] Fetch URLs use `import.meta.env.BASE_URL` for deploy-target-agnostic paths
- [ ] `bunx tsc --noEmit` clean

**Verify:** Typecheck clean; no runtime verification possible until the UI lands.

**Steps:**

- [ ] **Step 1: Create types**

Create `src/web/learn/types.ts`:

```ts
export type LearnDocId = "phak" | "commercial-acs" | "far";

export type LearnTocEntry = {
  chunkId: string;
  title: string;
  page: number;
};

export type LearnChunk = {
  chunkId: string;
  title: string;
  text: string;
};

export type LearnSearchHit = {
  docId: LearnDocId;
  docTitle: string;
  chunkId: string;
  title: string;
  snippet: string;
};

export const LEARN_DOCS: { id: LearnDocId; title: string; short: string }[] = [
  { id: "phak", title: "Pilot's Handbook of Aeronautical Knowledge", short: "PHAK" },
  { id: "commercial-acs", title: "Commercial Pilot ACS", short: "Commercial ACS" },
  { id: "far", title: "FAR (Parts 61/91/119/135/141)", short: "FAR" },
];
```

- [ ] **Step 2: Create data fetchers**

Create `src/web/learn/data.ts`:

```ts
import type { LearnChunk, LearnDocId, LearnSearchHit, LearnTocEntry } from "./types.ts";

const base = (() => {
  const b = import.meta.env.BASE_URL || "/";
  return b.endsWith("/") ? b : `${b}/`;
})();

const indexCache = new Map<LearnDocId, LearnTocEntry[]>();
const chunksCache = new Map<LearnDocId, LearnChunk[]>();
let searchCache: LearnSearchHit[] | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`fetch ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function getDocIndex(docId: LearnDocId): Promise<LearnTocEntry[]> {
  const cached = indexCache.get(docId);
  if (cached) return cached;
  const data = await fetchJson<LearnTocEntry[]>(`data/learn/${docId}/index.json`);
  indexCache.set(docId, data);
  return data;
}

export async function getDocChunks(docId: LearnDocId): Promise<LearnChunk[]> {
  const cached = chunksCache.get(docId);
  if (cached) return cached;
  const data = await fetchJson<LearnChunk[]>(`data/learn/${docId}/chunks.json`);
  chunksCache.set(docId, data);
  return data;
}

export async function getSearchIndex(): Promise<LearnSearchHit[]> {
  if (searchCache) return searchCache;
  searchCache = await fetchJson<LearnSearchHit[]>(`data/learn/search-index.json`);
  return searchCache;
}
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/learn/types.ts src/web/learn/data.ts
git commit -m "feat(learn): /learn route data layer

Typed lazy fetchers for index, chunks, and search-index JSON.
In-memory cache so doc-switching doesn't re-fetch. Paths use
import.meta.env.BASE_URL for deploy-target-agnostic routing."
```

```json:metadata
{"files":["src/web/learn/types.ts","src/web/learn/data.ts"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["LearnDocId, LearnTocEntry, LearnChunk, LearnSearchHit types exported","getDocIndex, getDocChunks, getSearchIndex fetchers","BASE_URL-aware paths","Typecheck clean"]}
```

---

### Task 8: `/learn` UI — LearnApp shell + TOC + reader

**Goal:** The visible product surface. `LearnApp` renders three-column-ish layout: left TOC (doc selector + section list), right reader pane (current chunk's title + body). No search yet.

**Files:**
- Create: `src/web/learn/LearnApp.tsx`
- Create: `src/web/learn/TocList.tsx`
- Create: `src/web/learn/ChunkReader.tsx`

**Acceptance Criteria:**
- [ ] Three components compile and render
- [ ] Selecting a doc loads its TOC
- [ ] Selecting a TOC entry loads and displays its chunk
- [ ] Hash params drive state: `#doc=phak&chunk=ch-4-2`
- [ ] Prev/Next chunk navigation works
- [ ] Tailwind styling matches the listings UI's visual language

**Verify:** Typecheck clean; `bun run dev` and navigate to `/learn` (or `/flightpath/learn` if VITE_BASE is set); confirm rendering manually.

**Steps:**

- [ ] **Step 1: Write TocList**

Create `src/web/learn/TocList.tsx`:

```tsx
import { LEARN_DOCS, type LearnDocId, type LearnTocEntry } from "./types.ts";

export function TocList({
  docId,
  toc,
  currentChunkId,
  onSelectDoc,
  onSelectChunk,
}: {
  docId: LearnDocId;
  toc: LearnTocEntry[];
  currentChunkId: string | null;
  onSelectDoc: (id: LearnDocId) => void;
  onSelectChunk: (chunkId: string) => void;
}) {
  return (
    <aside className="w-full md:w-72 shrink-0 border-r border-ink-200 dark:border-ink-700 md:h-screen md:overflow-y-auto">
      <div className="p-3 border-b border-ink-200 dark:border-ink-700">
        <h2 className="text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">Document</h2>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {LEARN_DOCS.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelectDoc(d.id)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                d.id === docId
                  ? "bg-sky-500 text-white"
                  : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              }`}
              title={d.title}
            >
              {d.short}
            </button>
          ))}
        </div>
      </div>
      <nav className="p-2">
        {toc.map((entry) => {
          const active = entry.chunkId === currentChunkId;
          return (
            <button
              key={entry.chunkId}
              onClick={() => onSelectChunk(entry.chunkId)}
              className={`block w-full text-left rounded-md px-2 py-1.5 text-sm transition ${
                active
                  ? "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100"
                  : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
              }`}
            >
              {entry.title}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Write ChunkReader**

Create `src/web/learn/ChunkReader.tsx`:

```tsx
import type { LearnChunk } from "./types.ts";

export function ChunkReader({
  chunk,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  chunk: LearnChunk | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!chunk) {
    return (
      <div className="flex-1 p-8 text-center text-ink-500 dark:text-ink-400">
        Select a section from the left to start reading.
      </div>
    );
  }
  return (
    <article className="flex-1 md:h-screen md:overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 md:p-10">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-50">{chunk.title}</h1>
        <div className="mt-6 text-ink-800 dark:text-ink-100 whitespace-pre-wrap leading-relaxed">
          {chunk.text}
        </div>
        <div className="mt-10 flex items-center justify-between border-t border-ink-200 dark:border-ink-700 pt-4">
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 disabled:opacity-40 disabled:cursor-not-allowed dark:border-ink-700 dark:text-ink-200"
          >
            ← Previous
          </button>
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 disabled:opacity-40 disabled:cursor-not-allowed dark:border-ink-700 dark:text-ink-200"
          >
            Next →
          </button>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Write LearnApp shell**

Create `src/web/learn/LearnApp.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChunkReader } from "./ChunkReader.tsx";
import { TocList } from "./TocList.tsx";
import { getDocChunks, getDocIndex } from "./data.ts";
import type { LearnDocId } from "./types.ts";

function readHash(): { doc: LearnDocId; chunk: string | null } {
  if (typeof window === "undefined") return { doc: "phak", chunk: null };
  const usp = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const doc = (usp.get("doc") as LearnDocId) || "phak";
  const chunk = usp.get("chunk");
  return { doc, chunk };
}

function writeHash(doc: LearnDocId, chunk: string | null) {
  const usp = new URLSearchParams();
  usp.set("doc", doc);
  if (chunk) usp.set("chunk", chunk);
  window.location.hash = usp.toString();
}

export function LearnApp() {
  const [{ doc, chunk: chunkId }, setState] = useState(readHash());

  useEffect(() => {
    const onHashChange = () => setState(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const tocQ = useQuery({
    queryKey: ["learn-toc", doc],
    queryFn: () => getDocIndex(doc),
  });
  const chunksQ = useQuery({
    queryKey: ["learn-chunks", doc],
    queryFn: () => getDocChunks(doc),
  });

  const toc = tocQ.data ?? [];
  const chunks = chunksQ.data ?? [];
  const currentIndex = chunks.findIndex((c) => c.chunkId === chunkId);
  const current = currentIndex >= 0 ? chunks[currentIndex] : null;

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-900 text-ink-900 dark:text-ink-50">
      <header className="border-b border-ink-200 dark:border-ink-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Flightpath — Learn</h1>
        </div>
        <a
          href={import.meta.env.BASE_URL}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 dark:border-ink-700 dark:text-ink-200"
        >
          ← Listings
        </a>
      </header>
      <div className="flex flex-col md:flex-row">
        <TocList
          docId={doc}
          toc={toc}
          currentChunkId={chunkId}
          onSelectDoc={(d) => writeHash(d, null)}
          onSelectChunk={(c) => writeHash(doc, c)}
        />
        <ChunkReader
          chunk={current}
          hasPrev={currentIndex > 0}
          hasNext={currentIndex >= 0 && currentIndex < chunks.length - 1}
          onPrev={() => writeHash(doc, chunks[currentIndex - 1]?.chunkId ?? null)}
          onNext={() => writeHash(doc, chunks[currentIndex + 1]?.chunkId ?? null)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/web/learn/LearnApp.tsx src/web/learn/TocList.tsx src/web/learn/ChunkReader.tsx
git commit -m "feat(learn): LearnApp shell, TOC, chunk reader

Three-column layout with doc selector + TOC on the left and chunk
reader on the right. Hash params drive state. No search yet — that
lands in the next commit."
```

```json:metadata
{"files":["src/web/learn/LearnApp.tsx","src/web/learn/TocList.tsx","src/web/learn/ChunkReader.tsx"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["3 components compile","Doc selector switches docs","TOC selection loads chunk","Prev/Next nav works","Hash params drive state"]}
```

---

### Task 9: `/learn` UI — search bar

**Goal:** Add a search input at the top of LearnApp that filters across all three docs' search-index entries client-side. Clicking a result navigates to its chunk.

**Files:**
- Create: `src/web/learn/SearchBar.tsx`
- Modify: `src/web/learn/LearnApp.tsx` (mount SearchBar)

**Acceptance Criteria:**
- [ ] SearchBar input with 150ms debounce
- [ ] Substring match against title + snippet (lowercased)
- [ ] Up to 50 results, grouped by doc
- [ ] Click result → navigates to that chunk (writeHash)
- [ ] Empty input shows no results pane

**Verify:** Manual via `bun run dev` — type "stall" or "engine fire", see results across PHAK and FAR.

**Steps:**

- [ ] **Step 1: Write SearchBar**

Create `src/web/learn/SearchBar.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSearchIndex } from "./data.ts";
import type { LearnDocId, LearnSearchHit } from "./types.ts";

export function SearchBar({
  onSelectHit,
}: {
  onSelectHit: (docId: LearnDocId, chunkId: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw), 150);
    return () => clearTimeout(t);
  }, [raw]);

  const indexQ = useQuery({
    queryKey: ["learn-search-index"],
    queryFn: getSearchIndex,
    staleTime: Infinity,
  });

  const q = debounced.trim().toLowerCase();
  const hits: LearnSearchHit[] = (() => {
    if (!q || !indexQ.data) return [];
    const out: LearnSearchHit[] = [];
    for (const e of indexQ.data) {
      if (e.title.toLowerCase().includes(q) || e.snippet.toLowerCase().includes(q)) {
        out.push(e);
        if (out.length >= 50) break;
      }
    }
    return out;
  })();

  // Group hits by docId for display
  const byDoc = new Map<LearnDocId, LearnSearchHit[]>();
  for (const h of hits) {
    if (!byDoc.has(h.docId)) byDoc.set(h.docId, []);
    byDoc.get(h.docId)!.push(h);
  }

  return (
    <div className="px-4 py-3 border-b border-ink-200 dark:border-ink-700">
      <input
        type="search"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Search across PHAK, ACS, and FAR…"
        className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
      />
      {q && (
        <div className="mt-3 space-y-3">
          {hits.length === 0 && (
            <p className="text-sm text-ink-500 dark:text-ink-400">No matches.</p>
          )}
          {[...byDoc.entries()].map(([docId, group]) => (
            <div key={docId}>
              <h3 className="text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {group[0].docTitle}
              </h3>
              <ul className="mt-1 space-y-1">
                {group.map((hit) => (
                  <li key={`${hit.docId}-${hit.chunkId}`}>
                    <button
                      onClick={() => {
                        onSelectHit(hit.docId, hit.chunkId);
                        setRaw("");
                      }}
                      className="block w-full text-left rounded-md px-2 py-1.5 text-sm text-ink-800 hover:bg-ink-100 dark:text-ink-100 dark:hover:bg-ink-800"
                    >
                      <span className="font-medium">{hit.title}</span>
                      <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                        {hit.snippet.slice(0, 80)}…
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount SearchBar in LearnApp**

Edit `src/web/learn/LearnApp.tsx`. Add the import:

```tsx
import { SearchBar } from "./SearchBar.tsx";
```

Insert the SearchBar between the header and the main flex row:

```tsx
      </header>
      <SearchBar onSelectHit={(d, c) => writeHash(d, c)} />
      <div className="flex flex-col md:flex-row">
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/learn/SearchBar.tsx src/web/learn/LearnApp.tsx
git commit -m "feat(learn): cross-doc search bar

Debounced substring search across the flat search-index.json.
Results grouped by doc, capped at 50. Clicking a hit navigates to
the chunk via hash params."
```

```json:metadata
{"files":["src/web/learn/SearchBar.tsx","src/web/learn/LearnApp.tsx"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["Debounced input","Substring match across title + snippet","Grouped by doc","Click result navigates"]}
```

---

### Task 10: Route detection + nav link + Pages 404 workaround

**Goal:** Wire `/learn` into the existing App so the user can get to it. Detect the route via `BASE_URL`-aware path matching. Add a "Learn" link in the listings header. Copy `index.html` to `learn/index.html` in the build output so GitHub Pages doesn't 404 on direct visits.

**Files:**
- Modify: `src/web/App.tsx` (route detection + nav link)
- Modify: `src/web/main.tsx` (or wherever the root component is mounted)
- Modify: `package.json` (post-build copy step in `build:static`)

**Acceptance Criteria:**
- [ ] Visiting `/learn` (or `/<base>/learn`) renders `<LearnApp />`
- [ ] Visiting any other path renders the existing listings UI
- [ ] Header link "Learn" appears on the listings UI; clicks navigate
- [ ] `dist/web/learn/index.html` exists after `build:static`

**Verify:**

```bash
bun run build:static
ls dist/web/learn/index.html
# Manual: bun run dev, visit /learn — confirm route swap
```

**Steps:**

- [ ] **Step 1: Find the root component mount point**

```bash
grep -n "createRoot\|ReactDOM.render\|<App" src/web/main.tsx src/web/App.tsx | head -5
```

The mount is typically in `src/web/main.tsx`. The simplest route swap is at the App level — App.tsx returns either the listings UI or `<LearnApp />` based on the current path.

- [ ] **Step 2: Add route detection to App.tsx**

In `src/web/App.tsx`, at the top of the default-exported `App` component (before any existing return), add:

```tsx
import { LearnApp } from "./learn/LearnApp.tsx";

// ... inside App() function, at the top:
const isLearnRoute = (() => {
  if (typeof window === "undefined") return false;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return window.location.pathname.startsWith(`${base}/learn`);
})();
if (isLearnRoute) return <LearnApp />;
```

This is the minimum-disruption hook. The rest of the existing App body is unchanged.

- [ ] **Step 3: Add the nav link**

Still in `App.tsx`, find the header area that contains the existing "Logbook" / "Filters" buttons. Add a "Learn" link adjacent to them:

```tsx
<a
  href={`${import.meta.env.BASE_URL}learn`}
  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 dark:border-ink-700 dark:text-ink-200"
>
  <BookOpen className="inline h-4 w-4 mr-1" />
  Learn
</a>
```

(The `BookOpen` icon is already imported from `lucide-react` at the top of the file. If it isn't, add it.)

- [ ] **Step 4: Post-build copy for GitHub Pages**

Edit `package.json`. The current `build:static` script:

```json
"build:static": "bun run build:learn && VITE_STATIC_DATA=1 vite build && bun src/scrapers/export.ts && bun src/scrapers/export-rss.ts"
```

Append a small inline copy step:

```json
"build:static": "bun run build:learn && VITE_STATIC_DATA=1 vite build && bun src/scrapers/export.ts && bun src/scrapers/export-rss.ts && bun -e \"await Bun.write('dist/web/learn/index.html', await Bun.file('dist/web/index.html').text())\""
```

This duplicates the SPA root into `dist/web/learn/index.html` so visiting `/learn` directly on GitHub Pages serves the React app instead of a 404.

- [ ] **Step 5: Build + smoke test**

```bash
bun run build:static
ls dist/web/learn/
```

Expected: `index.html` exists at `dist/web/learn/index.html`.

- [ ] **Step 6: Manual dev check (note for human reviewer)**

```bash
bun run dev
```

In a browser, visit `http://localhost:5173/learn` (or whatever the dev URL prints). Confirm `<LearnApp />` renders. Visit `/` — confirm listings still work. Click the new "Learn" header link — confirm route swap.

(A dispatched subagent can't open a browser; report DONE with the build artifact verification only. The controller does the live UI check.)

- [ ] **Step 7: Commit**

```bash
git add src/web/App.tsx package.json
git commit -m "feat(learn): wire /learn route + Pages 404 workaround

App.tsx checks pathname against BASE_URL + /learn and renders
LearnApp when matched. Header gains a Learn link. build:static
duplicates index.html into dist/web/learn/ so GitHub Pages serves
the SPA on direct visits to /learn instead of 404ing."
```

```json:metadata
{"files":["src/web/App.tsx","package.json"],"verifyCommand":"bun run build:static && ls dist/web/learn/index.html","acceptanceCriteria":["Route detection works in App.tsx","Header link present","dist/web/learn/index.html created"]}
```

---

### Task 11: End-to-end deploy verification

**Goal:** Merge to master, deploy, spot-check the live `/learn` surface.

**Files:** None (verification only)

**Acceptance Criteria:**
- [ ] `bun run build:static` clean locally
- [ ] Merged to master, pushed to origin
- [ ] CI deploy succeeds (`gh run list --branch master --limit 1` shows success)
- [ ] Live `/learn` URL renders with all three docs in the doc selector
- [ ] Search returns hits across all three docs

**Verify:**

```bash
bun run build:static 2>&1 | tail -15
# (Controller handles the merge + push from the main repo path.)
```

**Steps:**

- [ ] **Step 1: Local full build**

```bash
bun run build:static 2>&1 | tail -15
```

Expected: clean build, lists `dist/web/data/learn/` files in passing.

- [ ] **Step 2: Merge to master and push** (controller does this from the main repo, not the worktree)

```bash
git --git-dir="C:/Users/xxsku/repos/flightpath/.git" --work-tree="C:/Users/xxsku/repos/flightpath" merge --no-ff claude/determined-wiles-e01ea7 -m "Merge sub-project C (FAA reference library) onto master"
git --git-dir="C:/Users/xxsku/repos/flightpath/.git" --work-tree="C:/Users/xxsku/repos/flightpath" push origin master
```

- [ ] **Step 3: Watch CI**

```bash
gh run list --branch master --limit 1
```

Expected: a successful run within ~2-5 minutes (downloads PDFs first time, builds, deploys).

- [ ] **Step 4: Live spot-check**

Open `https://mohamedserhan.github.io/flightpath/learn` in a browser. Hard-refresh. Confirm:
- Three doc selector buttons (PHAK / Commercial ACS / FAR)
- Clicking each loads a TOC of sections
- Clicking a TOC entry shows the chunk text
- Search bar at top — typing "stall" or "altitude" returns hits

If anything's broken, add a small follow-up commit and re-deploy.

```json:metadata
{"files":[],"verifyCommand":"gh run list --branch master --limit 1","acceptanceCriteria":["Local build clean","Merged + pushed","CI deploy succeeds","Live /learn renders","Search works"]}
```

---

## Self-review

- **Spec coverage:** All 6 architecture sections in the spec map to tasks (ingest helpers → Task 1; per-doc scripts → Tasks 2-4; orchestrator → Task 5; build wiring → Task 6; data layer → Task 7; UI components → Tasks 8-9; route + Pages fix → Task 10; deploy verification → Task 11). The risk notes in the spec (URL drift, chunk count) are mitigated by sanity asserts in each ingest script.
- **Placeholders:** Each step has real code, real commands, real expected output.
- **Type consistency:** `LearnDocId`, `LearnChunk`, `LearnTocEntry`, `LearnSearchHit` are defined once in Task 7 and used uniformly in Tasks 8-9. The `Chunk` type from `_chunker.ts` (used by Tasks 1-5) has matching `chunkId`/`title`/`text` fields with one extra `page` field that only the TOC carries through.

## Out of scope (per spec)

- Other ACSes (Private/Instrument/CFI/ATP)
- Semantic/embeddings search
- Cross-link from listings to FAR sections
- Bookmarks / read-tracking
- AIM (separate doc; FAR-only for v1)
- Lesson plans (sub-project D, blocked)
- Diagrams (sub-project E)
