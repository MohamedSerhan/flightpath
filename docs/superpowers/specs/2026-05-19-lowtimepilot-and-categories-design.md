# lowtimepilot.com seed + non-CFI category split

Date: 2026-05-19
Status: Approved, ready for implementation plan
Sub-project A of the "Ahmad feedback" batch (items 1+2 of 7)

## Context

This is sub-project A of a five-piece decomposition of feedback from the user's brother (the primary user) on 2026-05-12. Full feedback:

1. Cross-reference listings on https://www.lowtimepilot.com/company-map and have the scraper visit each company's website for career opportunities.
2. Add a tab specifically for non-CFI positions (aerial survey, skydiving, etc.).
3. Differentiate hours by type (Single Engine, Multi Engine, Turbine, etc.).
4. Lesson plans for the learning side (might send materials).
5. Diagrams for complex concepts.
6. Scrape free FAA resources (PHAK, ACS, FAR/AIM).
7. Scrape other learning institutes and "reiterate it or make it our own". **Dropped — plagiarism risk.**

Sub-projects:

| Sub-project | Items | Blocked on |
|---|---|---|
| **A (this doc)** | 1, 2 | — |
| B — Hours-by-class enrichment | 3 | — |
| C — FAA reference library | 6 | — |
| D — Lesson-plan content | 4 | bro sends materials |
| E — Diagrams | 5 | C or D having content |

A is first because it directly extends the scraper shipped in commit `94f5b1a` (584 US flight schools + adapter) and is the bro's headline ask.

## Goals

1. Add `lowtimepilot.com/company-map` as a second source of aviation employers — broader than CFI-only flight schools.
2. Extend the `JobCategory` taxonomy so the bro's "non-CFI" buckets (aerial survey, skydiving, banner tow, pipeline patrol) are distinct, not lumped into `part91`.
3. Add a category filter in the web UI so non-CFI listings can be surfaced as their own view.

## Non-goals

- Hours-by-class enrichment (sub-project B).
- Cross-source enrichment: using lowtimepilot's category data to enrich listings that originated from other adapters. First pass is additive only.
- Per-category hiring-signal regex tuning. First pass uses the existing generic regex from `flight-schools.ts`; tune later from real data.

## Architecture

### 1. Taxonomy extension

Extend `JobCategory` in [src/shared/types.ts](../../../src/shared/types.ts):

```ts
export type JobCategory =
  // Existing
  | "cfi" | "cfii" | "mei"
  | "part135" | "part91" | "corporate" | "airline" | "other"
  // New (non-CFI part-91-adjacent operations)
  | "aerial_survey"
  | "pipeline_patrol"
  | "skydiving"
  | "banner_tow"
  | "traffic_watch"
  | "air_ambulance";
```

`part91` stays as the catch-all for personal/business general aviation that doesn't fit a more specific bucket.

**Excluded for v1:** `time_building`. Time-building programs (e.g., right-seat hour-building) are typically pay-to-play rather than paid positions; including them as a job category would mislead the sibling. The bootstrap still captures these companies in the seed (so we don't lose the data) — the adapter filters category=`time_building` companies out before probing for hiring signals. Revisit if it turns out some of them do hire pilots in a meaningful way.

Update `classifyCategory` in [src/scrapers/enrich.ts](../../../src/scrapers/enrich.ts) at the line currently reading:

```ts
if (/\b(banner tow|pipeline patrol|skydive|aerial survey|traffic watch)\b/.test(fullLc)) return "part91";
```

…to split into per-category branches matching the new taxonomy. Order matters — more specific patterns first. Air ambulance gets its own branch (`\bair\s+ambulance|hems|helicopter\s+ems|medevac\b`).

### 2. Reclassify backfill

The repo already has a reclassify-backfill CI step (commit `b928356`). It re-runs `classifyCategory` over existing rows. Verify it picks up the new branches; if it iterates listings and rewrites `job_category` from current text it should "just work" without changes.

### 3. New bootstrap script

Create `src/scrapers/bootstrap-lowtimepilot.ts`. Mirrors the structure of [src/scrapers/bootstrap-schools.ts](../../../src/scrapers/bootstrap-schools.ts) but uses the Playwright runner because lowtimepilot's company map is JS-rendered.

Steps:
1. `withContext` from [src/scrapers/browser/runner.ts](../../../src/scrapers/browser/runner.ts).
2. Navigate to `https://www.lowtimepilot.com/company-map`.
3. Wait for map markers / company list to populate (`page.waitForSelector` on whatever the rendered list root is — to be determined when implementing by opening devtools on the live page).
4. **If the page exposes a JSON network call** that returns the company list: capture that response via `page.on("response", ...)` instead of scraping the DOM. Faster, more stable. The implementation plan should include "inspect network tab first" as the first task.
5. Harvest per company:
   - `id` (their internal id if present, else a slug derived from name + city)
   - `name`
   - `city`, `state` (normalize to 2-letter US state code; drop non-US entries — matches existing `bootstrap-schools.ts` policy)
   - `category` (mapped from lowtimepilot's taxonomy to ours — see mapping table below)
   - `website` (the external link, not the lowtimepilot detail page)
6. Output: `data/lowtimepilot-companies.json`, committed.
7. Run manually like `bootstrap-schools.ts`; not on every scrape.

#### Category mapping

| lowtimepilot label | Our `JobCategory` |
|---|---|
| Aerial Survey | `aerial_survey` |
| Pipeline Patrol | `pipeline_patrol` |
| Air Ambulance | `air_ambulance` |
| Skydiving / Jump | `skydiving` |
| Banner Tow | `banner_tow` |
| Traffic Watch | `traffic_watch` |
| Time-building flight programs | `time_building` |
| Airline domiciles | `airline` |
| Charter / on-demand | `part135` |
| (anything else) | `part91` |

Concrete lowtimepilot labels will be confirmed when implementing — the live taxonomy may use slightly different names. Implementation task: log unmapped labels during bootstrap so we can extend the table.

### 4. New adapter

Create `src/scrapers/adapters/lowtimepilot.ts`. Same general shape as [src/scrapers/adapters/flight-schools.ts](../../../src/scrapers/adapters/flight-schools.ts) — load the seed, batch by time rotation, probe each company's careers page for a hiring signal.

Key differences from `flight-schools.ts`:
- Reads `data/lowtimepilot-companies.json` instead of `data/flight-schools.json`.
- Each company carries a `category` field that bypasses the title-based classifier.
- `externalId` prefix `lowtimepilot-<id>` so dedup with flight-schools-sourced listings works.
- Full-scan opt-out env var `LOWTIMEPILOT_FULL=1` (mirrors `FLIGHT_SCHOOLS_FULL=1` from [flight-schools.ts:292](../../../src/scrapers/adapters/flight-schools.ts:292)). When set, disables time-bucket rotation and probes every company in one go. Used for initial DB seed.
- Filters out companies with `category === 'time_building'` before probing (see Section 1).

### 5. Carrying `category` through enrichment

Add an optional field on `RawListing` in [src/scrapers/types.ts](../../../src/scrapers/types.ts):

```ts
export type RawListing = {
  // ... existing fields
  /** Adapter-provided category hint. When set, classifyCategory uses it
   *  as the answer instead of running its title/description regexes.
   *  Used by adapters whose source already tags each posting (lowtimepilot). */
  categoryHint?: JobCategory | null;
};
```

In `enrichListing` ([enrich.ts:193](../../../src/scrapers/enrich.ts:193)):

```ts
jobCategory: raw.categoryHint ?? classifyCategory(raw.title, raw.description, raw.employer),
```

This avoids special-casing in the adapter and keeps the classifier as the single source of truth for everything else.

### 6. Refactor shared probe logic

The `flight-schools` adapter and the new `lowtimepilot` adapter both need the same "fetch homepage → try common careers paths → run hiring-signal match → return RawListing-or-null" pipeline. Extract into a shared module `src/scrapers/adapters/_probe-careers.ts`:

```ts
export type Company = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
};

export type ProbeOptions = {
  sourceId: string;              // for externalId prefix
  titleTemplate: (c: Company) => string;
  categoryHint?: JobCategory;    // optional: from seed data
};

export async function probeCareerPage(
  company: Company,
  opts: ProbeOptions,
): Promise<RawListing | null>;
```

Move from [flight-schools.ts](../../../src/scrapers/adapters/flight-schools.ts): `CAREERS_PATHS`, `INSTRUCTOR_RE`/`HIRING_RE`/`SOFT_404_RE`, `decode`, `stripTags`, `isCareersUrl`, `hasCooccurringMatch`, `isMatch`, `fetchText`, `normalizeBase`, `findCareersLinks`, `snippet`, `probeSchool`.

Both adapters keep their own: seed loading, batching/rotation, top-level `adapter.fetch()`. Internal helpers move to the shared file.

**Category-aware keyword sets:** the shared probe should accept an optional `keywordSet` parameter. Default is the existing CFI-flavored `INSTRUCTOR_RE`. lowtimepilot adapter can override for skydiving ("jump pilots"), aerial survey ("survey pilots"), etc. — but first pass uses the default for everything; we can add category-specific keyword sets once we see what real career pages look like.

### 7. Dedup across seeds

Some companies will appear in both `flight-schools.json` and `lowtimepilot-companies.json`. To avoid double-listing:

- Normalize each company's website to a canonical host key: `new URL(site).host.toLowerCase().replace(/^www\./, "")`.
- In the lowtimepilot adapter, before probing, load the flight-schools seed's host set. Skip any lowtimepilot company whose host is already in the flight-schools seed.
- Rationale: flight-schools is CFI-flavored; if a company is in both, the CFI angle is the dominant value. Dropping the dup on the lowtimepilot side keeps the schools adapter as the source of truth for those.
- Tradeoff: we lose the lowtimepilot category tag on those duplicates. Acceptable for v1; revisit if it matters.

### 8. UI

The `ListingFilter.category` field already exists ([shared/types.ts:36](../../../src/shared/types.ts:36)) and the API uses it. Frontend change only:

- Add a category chip group above the listings table.
- Default selection: "All" (no filter).
- Other chips: "CFI" (matches `cfi`, `cfii`, `mei`), "Charter / Part 135" (`part135`), "Corporate" (`corporate`, `part91`), "Non-CFI" (`aerial_survey | pipeline_patrol | skydiving | banner_tow | traffic_watch | air_ambulance | time_building`), "Airline" (`airline`), "Other" (`other`).
- The "Non-CFI" chip is the bro's specific ask. Internally it maps to the union of the new buckets.
- Multiple categories per chip: API currently takes a single `category`. Either extend it to accept an array, or chips that map to multiple categories make multiple parallel requests and merge client-side. **Pick: extend API.** Cleaner, fewer round-trips.

### 9. Sources table / scrapers registry

Register the new adapter in [src/scrapers/registry.ts](../../../src/scrapers/registry.ts). Add to the browser-adapters list (it's not in the regular `bun run scrape` list because it needs Playwright). Mention in the CI workflow if there's a separate `scrape:browser` job (commit `b3515a2` added a `flight_schools_full` workflow input — similar pattern for lowtimepilot if a full-scan flag is wanted).

## Data flow

```
bootstrap-lowtimepilot.ts (manual, one-shot)
    ↓ Playwright fetch
  lowtimepilot.com/company-map (rendered)
    ↓ harvest
  data/lowtimepilot-companies.json (committed)

cron (every 4h)
    ↓
runBrowserAdapters([flightSchoolsAdapter, lowtimepilotAdapter, ...])
    ↓ each adapter
  for each company in rotation batch:
    probeCareerPage(company, opts)  ← shared module
      → RawListing { categoryHint }   or   null
    ↓
  enrichListing  ← respects categoryHint
    ↓
  db.insert listings (sourceId='lowtimepilot', external_id='lowtimepilot-<id>')

web UI
    ↓ ListingFilter.category (now array)
  GET /api/listings?category=aerial_survey&category=skydiving&...
    ↓
  Category chip group renders filtered results
```

## Verification

After implementation:

1. `bun src/scrapers/bootstrap-lowtimepilot.ts` runs to completion and produces a non-empty `data/lowtimepilot-companies.json`. Manual spot-check: 5 random entries have non-null `website` and a valid `category`.
2. `bun run scrape:browser` (or whichever invocation runs browser adapters) executes the lowtimepilot adapter without error. Sources table has a `lowtimepilot` row with `lastSuccessAt` set.
3. DB query: `SELECT job_category, COUNT(*) FROM listings GROUP BY job_category;` shows non-zero counts in at least 3 of the new buckets after one full rotation completes (~3 days, or set `LOWTIMEPILOT_FULL=1` for an immediate full scan).
4. Reclassify backfill: pre-existing rows whose text matches "skydive" or "aerial survey" now sit in the dedicated bucket instead of `part91`. Manual spot-check on 20 rows.
5. Web UI: the new "Non-CFI" category chip filters the listings table down to just non-CFI buckets. Counts in the chip match a corresponding API query.
6. Dedup: pick a company that appears in both seeds (likely candidate: any large school that also offers air ambulance or charter). Confirm it produces only one listing row, not two.

## Open questions resolved during implementation

These don't block the design but need answers before code goes in:

- **Does lowtimepilot expose website URLs per company?** If not, the adapter degrades to emitting "synthetic" discovery listings pointing at lowtimepilot's own detail page. Decide at impl time after inspecting the live page.
- **What's lowtimepilot's actual category taxonomy on the rendered map?** The mapping table above is best-guess based on the page's nav labels — confirm and adjust.
- **Network request vs DOM scrape?** If a single JSON XHR returns the whole company list, use it. Falls back to DOM scrape if not.
- **Playwright on Windows.** Existing runner notes chromium hangs locally; falls back to firefox via `PLAYWRIGHT_BROWSER=firefox`. Bootstrap script inherits the same convention.

## Out of scope (deferred to later sub-projects)

- Hours-by-class extraction → sub-project B.
- FAA reference library (PHAK, ACS, FAR/AIM ingest) → sub-project C.
- Lesson plans from bro → sub-project D (blocked).
- Diagrams → sub-project E (blocked).
- Per-category hiring-signal keyword tuning (would let us catch "we're seeking jump pilots" specifically). First pass uses existing generic regex.
- Cross-source enrichment: if a flight-schools listing has the same employer as a lowtimepilot company tagged "skydiving", promote that listing's category. Defer.
