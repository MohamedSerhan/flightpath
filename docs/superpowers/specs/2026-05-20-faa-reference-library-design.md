# FAA reference library (sub-project C)

Date: 2026-05-20
Status: Approved, ready for implementation plan
Sub-project C of the "Ahmad feedback" batch (item 6 of 7)

## Context

Ahmad's request on 2026-05-12:

> There are a bunch of free resources that we can also scrap to add to the learning side:
> - Pilot's Handbook of Aeronautical Knowledge
> - Airmen Certification Standard
> - FAR/AIM

All three are public-domain FAA PDFs hosted on faa.gov — no plagiarism risk, no scraping ethics question. The audience is the same low-time CFI cohort the job-search side serves; surfacing study material on the same site folds the two halves of the bro's request into one product.

This sub-project is independent of A (lowtimepilot + non-CFI categories, master `05b0f37`) and B (hours-by-class, master `daf53df`). It adds an entirely new product surface — a `/learn` route — without touching the existing listings flow.

## Goals

1. Ingest PHAK, Commercial Pilot ACS, and FAR/AIM into searchable text chunks committed to git.
2. Add a `/learn` route to the React app with TOC navigation, chunk reader, and full-text search across all three docs.
3. Keep the architecture static — no server work, no API calls, no LLM. JSON files in the bundle.

## Non-goals

- Other ACSes (Private, Instrument, CFI, ATP). Land later as additional `scripts/ingest/<doc>.ts` files.
- Semantic/embeddings search. Substring matching is fine for v1; swap to `flexsearch` if quality is poor.
- Cross-linking from job listings to relevant FAR sections. Interesting but separate work — depends on the learn surface stabilizing.
- Bookmarks / read-tracking. Defer.
- Lesson plans (sub-project D — blocked on Ahmad's materials).
- Diagrams (sub-project E — depends on this).
- Anything that requires running an LLM or hitting a third-party API at request time.
- "Make it our own" rewriting (item 7) — dropped, plagiarism risk.

## Architecture

Three concerns, separated by file:

1. **Ingest pipeline** (build-time, Node/Bun): downloads each PDF, extracts text, chunks into sections, writes JSON.
2. **Static bundle** (Vite): copies the JSON into `dist/web/data/learn/` so the deployed site can fetch it.
3. **`/learn` UI** (React): TOC navigation, chunk reader, search bar.

### Ingest pipeline

One orchestrator + three per-doc scripts + two shared helpers.

```
scripts/
  ingest-faa-docs.ts              orchestrator — invokes each per-doc script
  ingest/
    phak.ts                       PHAK source URL + doc-specific chunker config
    commercial-acs.ts             ACS source URL + chunker config
    far-aim.ts                    FAR/AIM source URL + chunker config
    _pdf-extract.ts               shared: pdfjs-dist wrapper that yields text per page
    _chunker.ts                   shared: group lines into chunks by configurable heading regex
```

Each per-doc script exports a single `ingest()` function that:
1. Downloads the PDF from faa.gov to `data/learn/_pdfs/<doc-id>.pdf` (cached — skip if present unless `--force`).
2. Calls the shared PDF extractor to get an array of `{ page, lines: string[] }`.
3. Calls the shared chunker with a doc-specific heading regex.
4. Writes `data/learn/<doc-id>/index.json` (TOC: `{ chunkId, title, parent? }[]`) and `data/learn/<doc-id>/chunks.json` (content: `{ chunkId, title, text }[]`).
5. Returns chunk count for the orchestrator to log.

The orchestrator additionally builds `data/learn/search-index.json` — a flat array of `{ docId, docTitle, chunkId, title, snippet }` covering every chunk for client-side search.

PDFs live in `data/learn/_pdfs/` which is `.gitignore`'d (10-30 MB each). The extracted JSON is committed (~5 MB total). CI re-downloads the PDFs on every build to pick up FAA revisions; the actions cache stores the `_pdfs/` directory keyed on a manual cache-bust input.

### Doc sources and chunk strategy

| Doc ID | Title | Source URL (canonical landing page) | Chunk strategy |
|---|---|---|---|
| `phak` | Pilot's Handbook of Aeronautical Knowledge | https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak | Per chapter section (`Chapter N — Title → N-M Section Title`) |
| `commercial-acs` | Commercial Pilot ACS | https://www.faa.gov/training_testing/testing/acs | Per Area of Operation → Task |
| `far-aim` | FAR/AIM | https://www.faa.gov/regulations_policies/faa_regulations | By Part / Section (e.g., 14 CFR 61.65) |

The per-doc script names the actual PDF download URL — these landing pages tend to be stable and link to the current revision. If a URL 404s during ingest, the script fails loud with the URL it tried so we can update.

Chunk size target: 300–2000 words. Configurable via the chunker's `splitLargeChunks` flag — if a chunk exceeds the upper bound and contains identifiable sub-headings, split further.

### Static bundle

Vite picks up `data/learn/**/*.json` via a small `vite.config` addition that copies the directory to `dist/web/data/learn/` at build time. No code change in Vite plugin land — just an `assetsInclude` glob or a `publicDir` reference, whichever fits the existing pattern.

The build script gets a new prerequisite:

```json
"build:learn": "bun scripts/ingest-faa-docs.ts",
"build:static": "bun run build:learn && VITE_STATIC_DATA=1 vite build && bun src/scrapers/export.ts && bun src/scrapers/export-rss.ts"
```

`build:learn` is idempotent — it skips PDFs that are already cached and already-extracted unless `--force` is set. In CI, the cache restore step provides the PDFs, so this step finishes fast on most runs.

### `/learn` UI

New React route. Sits alongside the existing listings UI; nav link added in the header.

```
src/web/learn/
  LearnApp.tsx                   route root — layout shell + state
  TocList.tsx                    left nav: doc selector + chapter/section tree
  ChunkReader.tsx                main pane: title + body + prev/next nav
  SearchBar.tsx                  top: filter input + result list
  data.ts                        lazy fetchers: getDocIndex, getDocChunks, getSearchIndex
  types.ts                       Chunk, TocEntry, SearchHit types
```

Routing: the app is a Vite SPA today with hash-based filter state, no router library. Simplest add: detect a `/learn` segment relative to Vite's base URL at App.tsx mount and render `<LearnApp />` instead of the listings view. Inside `LearnApp`, navigation between docs and chunks is via hash params.

**Base URL handling.** The site is served from `/<repo>/` on GitHub Pages (env `VITE_BASE`) and from `/` on custom domains. The route detector compares `window.location.pathname` against `import.meta.env.BASE_URL + 'learn'`, not a hardcoded `/learn`. All `fetch` calls for `data/learn/...` JSON files use `import.meta.env.BASE_URL` as the prefix. The header link href is `${import.meta.env.BASE_URL}learn` — relative-safe, deploy-target-agnostic.

GitHub Pages serves SPAs from one HTML file but `/learn` is a virtual route — visiting it directly returns a 404 from Pages. Workaround: copy `dist/web/index.html` to `dist/web/learn/index.html` at build time so the Pages 404 doesn't fire. Done in the existing `build:static` postprocess (or as a small `bun -e` step appended to the script).

State flow:
- On mount: fetch `data/learn/search-index.json` (one network call, ~200 KB compressed).
- When a doc is opened: fetch `data/learn/<doc-id>/index.json` (TOC, small) and `chunks.json` (lazy, 1–3 MB per doc).
- Render the selected chunk's text in `ChunkReader`.
- Search bar filter runs client-side against the loaded search index — no waiting on chunks.

Search behavior:
- Input is debounced 150ms.
- Match: lowercased substring against `title` and `snippet` fields (sufficient for v1).
- Results list shows up to 50 hits, grouped by doc.
- Clicking a result navigates to the chunk and highlights the matched substring in the reader.

Header link in the existing listings App.tsx: add a small "Learn" link next to the "Logbook" / "Filters" buttons. Clicking it sets `window.location.pathname = '/learn'`. Returning is via a "Listings" link in the `/learn` header.

### Error handling

- Ingest failures: each per-doc script writes failure markers to stderr with the doc-id and the failing URL/step. Orchestrator continues with remaining docs (don't fail the whole build for one doc).
- PDF parse errors: extractor catches per-page errors and emits a placeholder chunk so the TOC stays consistent.
- 404 on PDF fetch: hard-fail that doc (URL needs human update) but continue orchestrator. The CI workflow's existing "continue-on-error" pattern for alerts is a model.
- Client-side: missing chunks.json → show a friendly "couldn't load this section, try refreshing" with a link back to the doc TOC.

### Testing / verification

No test suite in the repo (same as A and B). Verification regime:

1. Run `bun run build:learn` locally. Confirm three `data/learn/<doc-id>/{index,chunks}.json` files exist and have reasonable sizes (1 MB – 5 MB each).
2. Spot-check a few chunks in each doc — text should be readable (no widespread garbling), TOC entries match section headings.
3. `bun run build:static` builds without error and includes `dist/web/data/learn/` in the output.
4. `bun run dev` and navigate to `/learn` — TOC renders, a chunk reads cleanly, search returns hits within ~100ms.
5. Deploy + spot-check the live site. CI's existing `actions/cache@v4` for the SQLite DB pattern extends to `data/learn/_pdfs/`.

## Data flow

```
faa.gov PDFs
  ↓ download (per-doc script)
data/learn/_pdfs/<doc>.pdf  (gitignored, CI-cached)
  ↓ pdfjs-dist extract (_pdf-extract.ts)
{ page, lines }[]
  ↓ chunker (_chunker.ts, doc-specific heading regex)
{ chunkId, title, text }[]
  ↓ write
data/learn/<doc>/index.json + chunks.json   (committed)
  ↓ orchestrator combines
data/learn/search-index.json   (committed)
  ↓ vite build:static
dist/web/data/learn/**/*.json
  ↓ client fetch on /learn route
LearnApp state → TocList + ChunkReader + SearchBar
```

## Open questions resolved during design

- **Should the FAR/AIM be the combined publication or just the federal regs (CFR)?** Just the FARs (14 CFR Part 1–199 as relevant). The AIM is a separate, much-shorter doc and can be ingested as a fourth source later if Ahmad asks for it. v1 ingests "the FAR" specifically.
- **What about checkride prep / oral exam guides?** Out of scope — those are commercial products (Gleim, ASA, etc.).
- **Tables in PDFs?** The chunker preserves the line-by-line text. Tables come out garbled; that's a known tradeoff for v1. Acceptable because the user's primary use is reading prose sections, not consulting tables.
- **Bundle size concern?** PHAK ~1.5 MB JSON, Commercial ACS ~200 KB, FAR ~3 MB. Total ~5 MB committed; ~1 MB gzipped over the wire when each doc is fetched. Search index ~200 KB. Acceptable for a static site.

## Risk notes

- **FAA URLs change.** Each per-doc script must fail loud with the URL it tried, so URL drift is a 5-minute fix not a debugging session.
- **PDF revisions could break the chunker.** A new edition of PHAK with different heading formatting could push chunk count to 1 (whole doc) or 600 (each line). Chunk count assertions in each script (`if (chunks.length < 30 || chunks.length > 500) throw new Error("chunk count out of expected range")`) catch this.
- **The hash-based router has a sharp edge.** Currently the listings UI uses hash params for filters. The `/learn` route uses hash for chunk navigation. Both can coexist because they live on different pathnames, but link-sharing must use the full URL including the hash.
- **`pdfjs-dist` is heavyweight at runtime.** It's only used at build time in this design — never bundled into the client. The build will get larger by ~30 MB in `node_modules`, but the deploy artifact stays small.
