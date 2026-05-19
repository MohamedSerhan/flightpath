# lowtimepilot.com seed + non-CFI category split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lowtimepilot.com/company-map as a second seed of aviation employers, split the lumped `part91` category into per-operation buckets (aerial survey, skydiving, banner tow, pipeline patrol, traffic watch, air ambulance), and surface a "Non-CFI" filter in the web UI.

**Architecture:** Browser-driven Playwright bootstrap produces a committed JSON seed; a new SourceAdapter probes each company's careers page using shared probe logic refactored out of the existing flight-schools adapter. A `categoryHint` field on `RawListing` lets the seed's per-company category bypass title-based classification. The Hono API's category filter switches from single-value to array; the React UI groups categories into chips, including a "Non-CFI" composite.

**Tech Stack:** Bun (runtime + script runner), TypeScript, Playwright (browser scrape), Drizzle ORM + SQLite, Hono (API), React 18 + TanStack Query (UI), Tailwind.

**Spec:** [docs/superpowers/specs/2026-05-19-lowtimepilot-and-categories-design.md](../specs/2026-05-19-lowtimepilot-and-categories-design.md)

**Verification notes:** This repo has no automated test suite. Verification uses `bun -e "…"` ad-hoc scripts, scraper integration runs against a temp SQLite DB, and dev-server manual checks. Each task lists its verification commands.

---

### Task 1: Extend `JobCategory` taxonomy and split `part91` regex

**Files:**
- Modify: `src/shared/types.ts:25-33`
- Modify: `src/scrapers/enrich.ts:147` (the lumped `part91` branch)
- Modify: `src/web/App.tsx:141-161` (CATEGORY_LABELS, CATEGORY_ORDER — minimal additions; full chip UI lands in Task 9)

- [ ] **Step 1: Extend the `JobCategory` union**

Edit `src/shared/types.ts`. Replace the existing block:

```ts
export type JobCategory =
  | "cfi"
  | "cfii"
  | "mei"
  | "part135"
  | "part91"
  | "airline"
  | "corporate"
  | "other";
```

with:

```ts
export type JobCategory =
  | "cfi"
  | "cfii"
  | "mei"
  | "part135"
  | "part91"
  | "airline"
  | "corporate"
  | "other"
  // Non-CFI part-91-adjacent operations. Split out from the old
  // catch-all `part91` so the sibling can filter for them directly.
  // `part91` remains the bucket for personal/general GA that doesn't fit
  // a more specific operation.
  | "aerial_survey"
  | "pipeline_patrol"
  | "skydiving"
  | "banner_tow"
  | "traffic_watch"
  | "air_ambulance";
```

- [ ] **Step 2: Split the lumped regex in `classifyCategory`**

Edit `src/scrapers/enrich.ts`. Find the line:

```ts
if (/\b(banner tow|pipeline patrol|skydive|aerial survey|traffic watch)\b/.test(fullLc)) return "part91";
```

Replace with these per-category branches, **in this order** (more specific first so e.g. "air ambulance" can't be matched by a stray "skydive"):

```ts
// Per-operation non-CFI part-91 buckets. Order matters — most specific
// wins. `air ambulance` / `hems` is the rarest and most unambiguous;
// the rest are common enough that the user wants a dedicated chip.
if (/\b(air\s+ambulance|hems|helicopter\s+ems|medevac|medivac)\b/.test(fullLc)) return "air_ambulance";
if (/\b(aerial\s+survey|aerial\s+mapping|photogrammetry|lidar\s+pilot)\b/.test(fullLc)) return "aerial_survey";
if (/\b(pipeline\s+patrol|powerline\s+patrol|pipeline\s+pilot)\b/.test(fullLc)) return "pipeline_patrol";
if (/\b(skydive|skydiving|jump\s+pilot|parachute\s+operations?)\b/.test(fullLc)) return "skydiving";
if (/\b(banner\s+tow|banner-tow|banner\s+pilot)\b/.test(fullLc)) return "banner_tow";
if (/\b(traffic\s+watch|traffic-watch|news\s+helicopter|eng\s+pilot|electronic\s+news\s+gathering)\b/.test(fullLc)) return "traffic_watch";
```

- [ ] **Step 3: Add the new categories to the UI's label/order maps**

Edit `src/web/App.tsx`. Replace lines 141-161 with:

```ts
const CATEGORY_LABELS: Record<JobCategory, string> = {
  cfi: "CFI",
  cfii: "CFII",
  mei: "MEI",
  part135: "Part 135",
  part91: "Part 91 / Time-build",
  airline: "Airline",
  corporate: "Corporate",
  other: "Other",
  aerial_survey: "Aerial Survey",
  pipeline_patrol: "Pipeline Patrol",
  skydiving: "Skydiving",
  banner_tow: "Banner Tow",
  traffic_watch: "Traffic Watch",
  air_ambulance: "Air Ambulance",
};

const CATEGORY_ORDER: JobCategory[] = [
  "cfi",
  "cfii",
  "mei",
  "part135",
  "part91",
  "corporate",
  "airline",
  "aerial_survey",
  "pipeline_patrol",
  "skydiving",
  "banner_tow",
  "traffic_watch",
  "air_ambulance",
  "other",
];
```

(The full chip-group UI redesign lands in Task 9 — this step only adds the labels so the existing chip rendering doesn't crash on the new values.)

- [ ] **Step 4: Verify the classifier with an ad-hoc script**

Run:

```bash
bun -e "
import { classifyCategory } from './src/scrapers/enrich.ts';
const cases = [
  ['Aerial Survey Pilot', null, null, 'aerial_survey'],
  ['Pipeline Patrol Pilot — Cessna 172', 'powerline patrol', null, 'pipeline_patrol'],
  ['Jump Pilot — Skydive Center', 'looking for jump pilot', null, 'skydiving'],
  ['Banner Tow Pilot — Florida', null, null, 'banner_tow'],
  ['Air Ambulance Captain', 'HEMS operation', null, 'air_ambulance'],
  ['Traffic Watch Pilot — News 4', 'ENG helicopter operations', null, 'traffic_watch'],
  ['Flight Instructor', 'CFI needed at our school', null, 'cfi'],
  ['First Officer', 'A320 type rating', 'JetBlue', 'airline'],
];
let pass = 0, fail = 0;
for (const [title, desc, emp, want] of cases) {
  const got = classifyCategory(title, desc, emp);
  const ok = got === want;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + title.padEnd(40) + ' want=' + want + ' got=' + got);
  ok ? pass++ : fail++;
}
console.log(\`\${pass} pass / \${fail} fail\`);
process.exit(fail > 0 ? 1 : 0);
"
```

Expected: all 8 cases pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/scrapers/enrich.ts src/web/App.tsx
git commit -m "feat(taxonomy): split non-CFI part91 bucket into per-operation categories

Adds aerial_survey, pipeline_patrol, skydiving, banner_tow,
traffic_watch, air_ambulance. The lumped regex in classifyCategory
splits into per-category branches. UI label/order maps extend so the
existing chip rendering stays correct; the full chip-group UI lands
in a later commit."
```

---

### Task 2: Add `categoryHint` to `RawListing` and respect it in `enrichListing`

**Files:**
- Modify: `src/scrapers/types.ts:3-15` (RawListing)
- Modify: `src/scrapers/enrich.ts:193-201` (enrichListing)

- [ ] **Step 1: Add the field to `RawListing`**

Edit `src/scrapers/types.ts`. Replace the existing `RawListing` type with:

```ts
export type RawListing = {
  externalId: string;
  title: string;
  url: string;
  description?: string | null;
  employer?: string | null;
  location?: string | null;
  postedAt: number;
  /** Set to false when the adapter had no real posting date and fell back
   *  to Date.now(). Default (undefined / true) means postedAt came from
   *  the source. Drives the UI's "Indexed" vs "Posted" copy. */
  postedAtAccurate?: boolean;
  /** Adapter-provided category hint. When set, `enrichListing` uses it
   *  as the job category instead of running the title/description
   *  classifier. Use for adapters whose source already tags each posting
   *  (e.g. lowtimepilot.com's company map exposes per-company category).
   *  Leave undefined to let the classifier decide. */
  categoryHint?: import("../shared/types.ts").JobCategory | null;
};
```

- [ ] **Step 2: Use the hint in `enrichListing`**

Edit `src/scrapers/enrich.ts`. Replace the existing `enrichListing` function:

```ts
export function enrichListing(raw: RawListing): EnrichedListing {
  return {
    ...raw,
    state: extractState(raw.location),
    jobCategory: classifyCategory(raw.title, raw.description, raw.employer),
    hoursRequired: extractHoursRequired(`${raw.title}\n${raw.description ?? ""}`),
    ratingsRequired: extractRatings(`${raw.title}\n${raw.description ?? ""}`),
  };
}
```

with:

```ts
export function enrichListing(raw: RawListing): EnrichedListing {
  // categoryHint short-circuits the classifier — adapters whose source
  // already tags each posting (lowtimepilot) carry the category through
  // directly so we don't risk misclassifying based on title text alone
  // (e.g. a "Pilot Wanted — XYZ Skydiving" posting would otherwise
  // fall back to "other" if the body doesn't contain "skydive").
  const category = raw.categoryHint ?? classifyCategory(raw.title, raw.description, raw.employer);
  return {
    ...raw,
    state: extractState(raw.location),
    jobCategory: category,
    hoursRequired: extractHoursRequired(`${raw.title}\n${raw.description ?? ""}`),
    ratingsRequired: extractRatings(`${raw.title}\n${raw.description ?? ""}`),
  };
}
```

- [ ] **Step 3: Verify with an ad-hoc script**

Run:

```bash
bun -e "
import { enrichListing } from './src/scrapers/enrich.ts';
const base = { externalId: 'x', title: 'Pilot Wanted', url: 'https://x', postedAt: 0 };
// Without hint: classifier returns 'other' (no recognized tokens).
const a = enrichListing({ ...base, description: 'Generic pilot job.' });
console.log('without hint:', a.jobCategory);
// With hint: categoryHint wins.
const b = enrichListing({ ...base, description: 'Generic pilot job.', categoryHint: 'skydiving' });
console.log('with skydiving hint:', b.jobCategory);
if (a.jobCategory !== 'other' || b.jobCategory !== 'skydiving') {
  console.error('FAIL'); process.exit(1);
}
console.log('OK');
"
```

Expected output:
```
without hint: other
with skydiving hint: skydiving
OK
```

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/types.ts src/scrapers/enrich.ts
git commit -m "feat(enrich): add categoryHint to RawListing

Lets adapters whose source already tags categories (lowtimepilot)
bypass the title/description classifier and carry the per-company
category through to the DB."
```

---

### Task 3: Extract shared career-page probe into `_probe-careers.ts`

**Files:**
- Create: `src/scrapers/adapters/_probe-careers.ts`
- Modify: `src/scrapers/adapters/flight-schools.ts` (use the new module)

This is a pure refactor — `flight-schools` behavior should be byte-identical before and after.

- [ ] **Step 1: Create the shared module**

Create `src/scrapers/adapters/_probe-careers.ts` with the following content. It collects every helper that's shared between flight-schools and the upcoming lowtimepilot adapter. Per-adapter concerns (seed loading, batching/rotation, adapter wiring) stay in each adapter file.

```ts
import type { RawListing } from "../types.ts";
import type { JobCategory } from "../../shared/types.ts";

export type Company = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
};

export type ProbeOptions = {
  /** Source-id prefix for the emitted RawListing.externalId. Final form
   *  is `<sourceId>-<company.id>`. */
  sourceId: string;
  /** Builds the listing title from the matched company. */
  titleTemplate: (c: Company) => string;
  /** Optional category to carry through as RawListing.categoryHint. */
  categoryHint?: JobCategory;
};

const REQUEST_TIMEOUT_MS = 12_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const CAREERS_PATHS = [
  "/careers",
  "/careers/",
  "/jobs",
  "/jobs/",
  "/employment",
  "/employment/",
  "/cfi-jobs",
  "/cfi-jobs/",
  "/flight-instructor-jobs",
  "/work-with-us",
  "/join-our-team",
  "/about/careers",
  "/about/employment",
];

export const INSTRUCTOR_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|ground\s+instructor)\b/i;

// Apostrophe variants ['’] are required (not optional) for "we're"
// patterns — without them, "we were looking for" on Squarespace soft-404
// pages was matching as a false hiring signal.
export const HIRING_RE =
  /\b(now\s+hiring|we['’]re\s+hiring|we\s+are\s+hiring|currently\s+hiring|hiring\s+(?:cfis?|flight\s+instructors?|instructor|pilots?)|we['’]re\s+looking\s+for|we\s+are\s+looking\s+for|looking\s+to\s+hire|join\s+our\s+team|apply\s+(?:now|today|here)|open\s+position|career\s+opportunit|employment\s+opportunit)\b/i;

// Soft-404 detector — many Squarespace / Wix / Wordpress themes return
// HTTP 200 with a "page not found" body.
export const SOFT_404_RE =
  /\b(?:page\s+(?:not\s+found|you\s+(?:were|are)\s+looking\s+for)|404\s*(?:[-—:]|error|not\s+found)|this\s+page\s+(?:doesn['’]?t|does\s+not)\s+exist|sorry,?\s+(?:we\s+can['’]?t|the\s+page\s+you))/i;

const COOCCURRENCE_WINDOW = 400;

export function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function isCareersUrl(url: string): boolean {
  return /\/(careers?|jobs?|employment|hiring|cfi-jobs?|flight-instructor-jobs?|work-with-us|join)\b/i.test(url);
}

function hasCooccurringMatch(text: string, instructorRe: RegExp, hiringRe: RegExp): boolean {
  const instr = text.match(instructorRe);
  if (!instr || instr.index === undefined) return false;
  const start = Math.max(0, instr.index - COOCCURRENCE_WINDOW);
  const end = Math.min(text.length, instr.index + instr[0].length + COOCCURRENCE_WINDOW);
  return hiringRe.test(text.slice(start, end));
}

export function isMatch(
  url: string,
  text: string,
  instructorRe: RegExp = INSTRUCTOR_RE,
  hiringRe: RegExp = HIRING_RE,
): boolean {
  if (SOFT_404_RE.test(text)) return false;
  if (!instructorRe.test(text) || !hiringRe.test(text)) return false;
  if (isCareersUrl(url)) return true;
  return hasCooccurringMatch(text, instructorRe, hiringRe);
}

export function normalizeBase(website: string): string | null {
  try {
    const u = new URL(website);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function normalizeHostKey(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function fetchText(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ac.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/html|text/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function findCareersLinks(homepageHtml: string, base: string): string[] {
  const out = new Set<string>();
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(homepageHtml)) !== null) {
    const href = m[1];
    const text = stripTags(m[2]);
    if (!/\b(career|careers|jobs?|employment|hiring|join\s+(?:our|the)\s+team|work\s+with\s+us)\b/i.test(text + " " + href)) {
      continue;
    }
    let abs: string | null = null;
    try {
      abs = new URL(href, base + "/").toString();
    } catch {
      continue;
    }
    try {
      const u = new URL(abs);
      const bu = new URL(base);
      if (u.host !== bu.host) continue;
    } catch {
      continue;
    }
    out.add(abs);
    if (out.size >= 3) break;
  }
  return Array.from(out);
}

function snippet(text: string, instructorRe: RegExp, hiringRe: RegExp): string {
  const lower = text.toLowerCase();
  const idx = (() => {
    const k = lower.search(instructorRe);
    if (k >= 0) return k;
    return lower.search(hiringRe);
  })();
  if (idx < 0) return text.slice(0, 240);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 200);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

export async function probeCareerPage(
  company: Company,
  opts: ProbeOptions & {
    /** Override the default CFI-flavored instructor regex (e.g. for
     *  skydiving operators we want "jump pilot" to count as the
     *  domain-specific keyword). Defaults to INSTRUCTOR_RE. */
    instructorRe?: RegExp;
    /** Override the default hiring-signal regex. Defaults to HIRING_RE. */
    hiringRe?: RegExp;
  },
): Promise<RawListing | null> {
  if (!company.website) return null;
  const base = normalizeBase(company.website);
  if (!base) return null;

  const instructorRe = opts.instructorRe ?? INSTRUCTOR_RE;
  const hiringRe = opts.hiringRe ?? HIRING_RE;

  const tried = new Set<string>();
  const queue: string[] = [company.website, ...CAREERS_PATHS.map((p) => base + p)];

  let homepageHtml: string | null = null;
  let bestMatch: { url: string; text: string } | null = null;

  for (const candidate of queue) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const html = await fetchText(candidate);
    if (!html) continue;
    if (candidate === company.website) homepageHtml = html;
    const text = stripTags(html);
    if (isMatch(candidate, text, instructorRe, hiringRe)) {
      bestMatch = { url: candidate, text };
      break;
    }
  }

  if (!bestMatch && homepageHtml) {
    const links = findCareersLinks(homepageHtml, base);
    for (const link of links) {
      if (tried.has(link)) continue;
      tried.add(link);
      const html = await fetchText(link);
      if (!html) continue;
      const text = stripTags(html);
      if (isMatch(link, text, instructorRe, hiringRe)) {
        bestMatch = { url: link, text };
        break;
      }
    }
  }

  if (!bestMatch) return null;

  return {
    externalId: `${opts.sourceId}-${company.id}`,
    title: opts.titleTemplate(company),
    url: bestMatch.url,
    description: snippet(bestMatch.text, instructorRe, hiringRe),
    employer: company.name,
    location: `${company.city.replace(/,\s*[A-Z]{2}$/, "")}, ${company.state}`.trim(),
    postedAt: Date.now(),
    postedAtAccurate: false,
    categoryHint: opts.categoryHint ?? null,
  };
}
```

- [ ] **Step 2: Refactor `flight-schools.ts` to use the shared module**

Replace the entire contents of `src/scrapers/adapters/flight-schools.ts` with:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawListing, SourceAdapter } from "../types.ts";
import { probeCareerPage, type Company } from "./_probe-careers.ts";

/**
 * Flight Schools (faaflightschools.com seed) — walks small US flight-school
 * websites looking for CFI / flight-instructor postings that don't show up
 * on any aggregator. Most small Part 61/141 schools advertise their CFI
 * openings only on their own /careers page (or in a banner on the homepage)
 * and never list on JSfirm / AOPA JDN / Adzuna. That's the gap this fills.
 *
 * Seed: data/flight-schools.json (committed; refreshed by
 * `bun src/scrapers/bootstrap-schools.ts`). ~500 US schools with website URLs.
 *
 * Per-run budget: rotate through BATCH_SIZE schools each tick (based on the
 * scheduled run interval). At the configured cron of every 4 hours, the full
 * list cycles every ~3 days.
 *
 * The actual careers-page probe lives in _probe-careers.ts and is shared
 * with the lowtimepilot adapter.
 */

const SEED_PATH = "data/flight-schools.json";

const BATCH_SIZE = 30;
const CONCURRENCY = 5;
const REQUEST_DELAY_MS = 250;
const ROTATION_BUCKET_MS = 4 * 3600_000;

function loadSeed(): Company[] {
  const path = join(process.cwd(), SEED_PATH);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const all = JSON.parse(raw) as Company[];
    return all.filter((s) => !!s.website);
  } catch {
    return [];
  }
}

function pickBatch(companies: Company[], now: number): Company[] {
  if (companies.length === 0) return [];
  const tick = Math.floor(now / ROTATION_BUCKET_MS);
  const start = (tick * BATCH_SIZE) % companies.length;
  const out: Company[] = [];
  for (let i = 0; i < BATCH_SIZE && i < companies.length; i++) {
    out.push(companies[(start + i) % companies.length]);
  }
  return out;
}

export const flightSchoolsAdapter: SourceAdapter = {
  id: "flight-schools",
  name: "Flight Schools (CFI hiring)",
  async fetch(): Promise<RawListing[]> {
    const all = loadSeed();
    if (all.length === 0) {
      console.log("[flight-schools] no seed data — run bootstrap-schools.ts");
      return [];
    }
    const fullScan = process.env.FLIGHT_SCHOOLS_FULL === "1";
    const batch = fullScan ? all : pickBatch(all, Date.now());
    console.log(
      `[flight-schools] probing ${batch.length}/${all.length} schools${fullScan ? " (full scan)" : ""}…`,
    );

    const out: RawListing[] = [];
    let i = 0;

    async function worker() {
      while (i < batch.length) {
        const idx = i++;
        const company = batch[idx];
        try {
          const listing = await probeCareerPage(company, {
            sourceId: "flight-schools",
            titleTemplate: (c) => `Flight Instructor — ${c.name}`,
          });
          if (listing) out.push(listing);
        } catch {
          // Swallow per-school errors — one broken site shouldn't kill the run.
        }
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    console.log(`[flight-schools] matched ${out.length} schools with active hiring signal`);
    return out;
  },
};
```

Notes on the diff:
- `School` type removed — superseded by `Company` from `_probe-careers.ts`.
- All inline probe helpers removed.
- The body of `probeSchool` is now `probeCareerPage(...)` with options.
- `REQUEST_TIMEOUT_MS` is no longer set per-adapter — the shared module owns it. If we need per-adapter override later, plumb through `opts`.
- `BATCH_SIZE` / `CONCURRENCY` / `ROTATION_BUCKET_MS` stay adapter-local because they're tuning knobs, not shared invariants.

- [ ] **Step 3: Type-check**

Run:

```bash
bunx tsc --noEmit
```

Expected: no errors. If there are errors elsewhere in the codebase (pre-existing), they're not our concern — only fix errors introduced by this task's edits.

- [ ] **Step 4: Verify the refactor is behavior-preserving with a one-school probe**

Run (pick a school from the seed that's known to have a careers page — Cessna Pilot Centers or similar):

```bash
bun -e "
import { probeCareerPage } from './src/scrapers/adapters/_probe-careers.ts';
const result = await probeCareerPage(
  { id: '99999', name: 'ATP Flight School', city: 'Jacksonville', state: 'FL', website: 'https://atpflightschool.com' },
  { sourceId: 'flight-schools', titleTemplate: c => 'Flight Instructor — ' + c.name }
);
console.log(JSON.stringify(result, null, 2));
"
```

Expected: either a `RawListing` with `externalId: 'flight-schools-99999'`, `title: 'Flight Instructor — ATP Flight School'`, and a valid careers URL — OR `null` (some schools don't have a matchable careers page right now). Either result is fine; what matters is that the shape matches `RawListing` and no exception is thrown.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/adapters/_probe-careers.ts src/scrapers/adapters/flight-schools.ts
git commit -m "refactor(scrapers): extract probe-careers helper for reuse

Pulls the careers-page probe logic (fetch → try careers paths →
match hiring signal → emit RawListing) out of flight-schools.ts and
into _probe-careers.ts so the upcoming lowtimepilot adapter can use
the same pipeline. Behavior of the flight-schools adapter is
unchanged."
```

---

### Task 4: Scaffold the lowtimepilot bootstrap with a discovery probe

Lowtimepilot's company map is JS-rendered. Before we can write the parser we need to know whether the data ships as a single JSON XHR (preferred — fast and stable) or only via the rendered DOM (fall back to selectors). This task instruments the bootstrap to print what's there, so Task 5 can write the actual parser.

**Files:**
- Create: `src/scrapers/bootstrap-lowtimepilot.ts`

- [ ] **Step 1: Write the discovery probe**

Create `src/scrapers/bootstrap-lowtimepilot.ts`:

```ts
/**
 * One-time bootstrap: scrape lowtimepilot.com/company-map to produce
 * data/lowtimepilot-companies.json — a seed list of aviation employers
 * (aerial survey, skydiving, banner tow, pipeline patrol, etc.) with
 * their websites and operation categories.
 *
 * Used by the `lowtimepilot` adapter (src/scrapers/adapters/lowtimepilot.ts)
 * to probe each company's careers page for active hiring signals — same
 * pattern as the flight-schools adapter, but with a broader, category-tagged
 * source.
 *
 * Run manually when refreshing the seed:
 *   bun src/scrapers/bootstrap-lowtimepilot.ts          # full harvest
 *   bun src/scrapers/bootstrap-lowtimepilot.ts --probe  # discovery mode:
 *                                                       # dumps the rendered
 *                                                       # network calls + DOM
 *                                                       # shape so we can
 *                                                       # write the parser
 *
 * On Windows local dev, set PLAYWRIGHT_BROWSER=firefox if chromium hangs
 * (same convention as runner.ts).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JobCategory } from "../shared/types.ts";

const SOURCE_URL = "https://www.lowtimepilot.com/company-map";
const OUTPUT = "data/lowtimepilot-companies.json";

/** `"time_building"` is a seed-only category — it's NOT in the public
 *  JobCategory union because time-building programs are pay-to-play, not
 *  job postings, and we don't want them showing up in the listings UI.
 *  The adapter filters these out before probing. Keeping the label in
 *  the seed lets us preserve the data without polluting the listings DB. */
export type LowtimepilotCompany = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
  category: JobCategory | "time_building";
};

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI","GU",
]);

// Maps lowtimepilot's user-facing category labels to our JobCategory union.
// Confirm and extend this table during the discovery probe — any
// unmapped label is logged.
const CATEGORY_MAP: Record<string, JobCategory | "time_building"> = {
  "aerial survey": "aerial_survey",
  "pipeline patrol": "pipeline_patrol",
  "powerline patrol": "pipeline_patrol",
  "air ambulance": "air_ambulance",
  "hems": "air_ambulance",
  "medevac": "air_ambulance",
  "skydiving": "skydiving",
  "skydive": "skydiving",
  "jump pilot": "skydiving",
  "banner tow": "banner_tow",
  "banner towing": "banner_tow",
  "traffic watch": "traffic_watch",
  "eng": "traffic_watch",
  "charter": "part135",
  "part 135": "part135",
  "airline": "airline",
  // Seed-only — adapter filters these out before probing. Pay-to-play
  // programs aren't real job postings; we keep the data but never
  // emit listings.
  "time building": "time_building",
  "time-building": "time_building",
};

function mapCategory(label: string): JobCategory | "time_building" {
  const k = label.toLowerCase().trim();
  if (CATEGORY_MAP[k]) return CATEGORY_MAP[k];
  console.log(`[lowtimepilot] unmapped category: "${label}" — defaulting to part91`);
  return "part91";
}

async function main() {
  const probeMode = process.argv.includes("--probe");
  const playwright = await import("playwright");
  const engine = (process.env.PLAYWRIGHT_BROWSER ?? "chromium") as
    | "chromium"
    | "firefox"
    | "webkit";
  const browser = await playwright[engine].launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
  });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();

    if (probeMode) {
      console.log("[probe] capturing network responses…");
      const captured: Array<{ url: string; status: number; type: string; bytes: number; sample: string }> = [];
      page.on("response", async (res) => {
        try {
          const url = res.url();
          const ct = res.headers()["content-type"] ?? "";
          // Focus on JSON, scripts that might inline data, and same-origin requests.
          if (!/json|javascript|application\/x|text\/plain/i.test(ct)) return;
          const buf = await res.body().catch(() => null);
          if (!buf) return;
          const body = buf.toString("utf8");
          captured.push({
            url,
            status: res.status(),
            type: ct,
            bytes: buf.length,
            sample: body.slice(0, 400),
          });
        } catch {
          /* ignore — some responses can't be re-read */
        }
      });

      await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 45_000 });
      // Give late XHRs a moment to settle.
      await page.waitForTimeout(2_000);

      console.log(`[probe] captured ${captured.length} JSON/JS responses`);
      for (const c of captured) {
        console.log(`\n--- ${c.status} ${c.url} (${c.type}, ${c.bytes} bytes) ---`);
        console.log(c.sample);
      }

      const domDump = await page.evaluate(() => {
        // Heuristics: look for elements with map-marker-like attributes,
        // any data-* attributes that reference companies, and the structured
        // text content of the largest list element on the page.
        const candidates = Array.from(
          document.querySelectorAll("[data-company], [data-id], .company, .marker, [class*='company']"),
        ).slice(0, 10);
        return candidates.map((el) => ({
          tag: el.tagName,
          cls: el.className,
          attrs: Array.from(el.attributes).map((a) => `${a.name}="${a.value.slice(0, 80)}"`),
          text: (el.textContent || "").slice(0, 200),
        }));
      });

      console.log("\n--- DOM candidates ---");
      console.log(JSON.stringify(domDump, null, 2));
      return;
    }

    // Full harvest path — implemented in Task 5 once we know the shape.
    console.error("[lowtimepilot] full harvest not yet implemented. Run with --probe first.");
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the discovery probe**

```bash
bun src/scrapers/bootstrap-lowtimepilot.ts --probe 2>&1 | tee /tmp/lowtimepilot-probe.log
```

(On Windows: `bun src/scrapers/bootstrap-lowtimepilot.ts --probe > probe.log 2>&1`. If chromium hangs, prepend `PLAYWRIGHT_BROWSER=firefox` and ensure `bunx playwright install firefox` has been run.)

Expected output includes either:
- **(a) one or more JSON responses** whose body looks like an array of companies — note the URL and key shape (`name`, `address`, `type`, `website`, etc.).
- **(b) DOM dump** with `[data-company]` or similar markers carrying per-company data attributes.

Read the output carefully. The next task is informed by what you find.

- [ ] **Step 3: Commit the discovery scaffold**

```bash
git add src/scrapers/bootstrap-lowtimepilot.ts
git commit -m "feat(scrapers): scaffold lowtimepilot bootstrap with discovery probe

--probe mode dumps captured JSON responses and DOM candidates from
lowtimepilot.com/company-map so the harvest parser can be written
against the actual data shape. Full harvest path lands next."
```

---

### Task 5: Implement the lowtimepilot harvest parser

Now that Task 4 has revealed the data shape, replace the placeholder harvest path with the actual parser. **The exact selectors / endpoint URL below are templates — substitute the values from the probe output.**

**Files:**
- Modify: `src/scrapers/bootstrap-lowtimepilot.ts` (the post-`probeMode` branch)
- Create: `data/lowtimepilot-companies.json` (output, committed)

- [ ] **Step 1: Replace the placeholder harvest with the actual parser**

In `src/scrapers/bootstrap-lowtimepilot.ts`, replace the block:

```ts
    // Full harvest path — implemented in Task 5 once we know the shape.
    console.error("[lowtimepilot] full harvest not yet implemented. Run with --probe first.");
    process.exit(1);
```

with one of the two variants below, depending on what Task 4 found.

**Variant A — JSON endpoint exists (preferred):**

```ts
    console.log("[lowtimepilot] navigating and capturing JSON…");
    let captured: unknown = null;
    page.on("response", async (res) => {
      // Replace the URL filter with the actual data-endpoint discovered
      // in Task 4 (e.g. /api/companies, /_next/data/.../map.json, etc.).
      if (!/REPLACE_ME_WITH_DATA_URL_PATTERN/.test(res.url())) return;
      try {
        const ct = res.headers()["content-type"] ?? "";
        if (!/json/i.test(ct)) return;
        captured = await res.json();
      } catch {
        /* ignore */
      }
    });

    await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(2_000);

    if (!captured) {
      console.error("[lowtimepilot] no data response captured — re-run with --probe");
      process.exit(1);
    }

    // Shape the captured payload into LowtimepilotCompany[]. Replace
    // the field names below with whatever the real payload uses.
    const raw = captured as Array<{
      id: string | number;
      name: string;
      city?: string;
      state?: string;
      website?: string | null;
      category?: string;
      type?: string;
    }>;

    const results: LowtimepilotCompany[] = [];
    for (const r of raw) {
      const state = (r.state ?? "").trim().toUpperCase().slice(0, 2);
      if (!US_STATES.has(state)) continue;
      const label = r.category ?? r.type ?? "";
      results.push({
        id: String(r.id),
        name: String(r.name).trim(),
        city: (r.city ?? "").trim(),
        state,
        website: r.website ? String(r.website).trim() : null,
        category: mapCategory(label),
      });
    }
```

**Variant B — DOM-only (fallback):**

```ts
    console.log("[lowtimepilot] navigating and scraping DOM…");
    await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 45_000 });
    // Replace REPLACE_ME_WITH_LIST_SELECTOR with the actual selector
    // discovered in Task 4 (the wrapper that holds the per-company entries).
    await page.waitForSelector("REPLACE_ME_WITH_LIST_SELECTOR", { timeout: 20_000 });

    const raw = await page.$$eval(
      "REPLACE_ME_WITH_LIST_SELECTOR",
      (nodes) =>
        nodes.map((n) => ({
          // Replace these selectors / attributes with whatever Task 4 found.
          id: n.getAttribute("data-id") ?? n.id ?? "",
          name: n.querySelector("REPLACE_ME_NAME_SELECTOR")?.textContent?.trim() ?? "",
          city: n.querySelector("REPLACE_ME_CITY_SELECTOR")?.textContent?.trim() ?? "",
          state: n.querySelector("REPLACE_ME_STATE_SELECTOR")?.textContent?.trim() ?? "",
          website: (n.querySelector("REPLACE_ME_WEBSITE_SELECTOR") as HTMLAnchorElement | null)?.href ?? null,
          category: n.getAttribute("data-category") ?? n.querySelector("REPLACE_ME_CATEGORY_SELECTOR")?.textContent?.trim() ?? "",
        })),
    );

    const results: LowtimepilotCompany[] = [];
    for (const r of raw) {
      const state = r.state.toUpperCase().slice(0, 2);
      if (!US_STATES.has(state)) continue;
      if (!r.name || !r.id) continue;
      results.push({
        id: r.id,
        name: r.name,
        city: r.city,
        state,
        website: r.website || null,
        category: mapCategory(r.category),
      });
    }
```

Then in both variants, append:

```ts
    results.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
    const withSite = results.filter((s) => s.website).length;
    console.log(`[lowtimepilot] harvested ${results.length} companies (${withSite} with websites)`);
    const byCategory: Record<string, number> = {};
    for (const r of results) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    console.log("[lowtimepilot] category breakdown:", byCategory);

    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(results, null, 2));
    console.log(`[lowtimepilot] wrote ${OUTPUT}`);
```

- [ ] **Step 2: Run the harvest**

```bash
bun src/scrapers/bootstrap-lowtimepilot.ts
```

Expected:
- Exit code 0.
- `data/lowtimepilot-companies.json` is created and non-empty.
- The category-breakdown log shows non-zero counts in at least 3 of the new categories (aerial_survey, pipeline_patrol, skydiving, etc.).

- [ ] **Step 3: Spot-check the seed**

```bash
bun -e "
import seed from './data/lowtimepilot-companies.json' assert { type: 'json' };
console.log('total:', seed.length);
console.log('with website:', seed.filter(s => s.website).length);
console.log('US-only:', seed.every(s => s.state.length === 2));
console.log('sample:', seed.slice(0, 5));
"
```

Expected: `with website` is non-zero (we need URLs to probe), `US-only` is true, sample entries look real.

If `with website` is 0, the bootstrap is harvesting the wrong field — re-run `--probe`, inspect, fix the parser. Do not proceed until at least 30% of harvested companies have websites.

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/bootstrap-lowtimepilot.ts data/lowtimepilot-companies.json
git commit -m "feat(scrapers): bootstrap lowtimepilot seed

Harvests lowtimepilot.com/company-map into data/lowtimepilot-companies.json
(committed seed). Each entry carries the operator's name, location,
website, and category (aerial_survey / pipeline_patrol / etc.) which
the new lowtimepilot adapter uses as a hint when probing careers
pages — bypassing title-based classification for non-CFI roles whose
postings rarely contain explicit category keywords."
```

---

### Task 6: Write the lowtimepilot adapter

**Files:**
- Create: `src/scrapers/adapters/lowtimepilot.ts`

- [ ] **Step 1: Write the adapter**

Create `src/scrapers/adapters/lowtimepilot.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobCategory } from "../../shared/types.ts";
import type { RawListing, SourceAdapter } from "../types.ts";
import { normalizeHostKey, probeCareerPage, type Company } from "./_probe-careers.ts";
import type { LowtimepilotCompany } from "../bootstrap-lowtimepilot.ts";

/**
 * Lowtimepilot (lowtimepilot.com/company-map) — broader aviation-operator
 * source than the flight-schools seed. Covers aerial survey, pipeline patrol,
 * skydiving, banner tow, traffic watch, air ambulance, and charter operators.
 * Each company carries an explicit category (set during bootstrap), which
 * bypasses title-based classification — necessary because many non-CFI
 * job postings don't contain keywords the classifier would recognize.
 *
 * Seed: data/lowtimepilot-companies.json (committed; refreshed by
 * `bun src/scrapers/bootstrap-lowtimepilot.ts`).
 *
 * Per-run budget: same rotation pattern as flight-schools — at the configured
 * cron of every 4 hours, the full list cycles every ~3 days. Override with
 * LOWTIMEPILOT_FULL=1 for an immediate full scan (used for initial DB seed).
 *
 * Cross-seed dedup: companies whose website host appears in
 * data/flight-schools.json are skipped — flight-schools owns CFI flavoring
 * for those, and double-listing the same employer is noise.
 *
 * Excluded from probing: companies whose seed category is "time_building"
 * (a seed-only value, not part of the public JobCategory union). Time-
 * building programs are pay-to-play, not real job postings — we keep
 * them in the seed for completeness but never emit listings.
 */

const SEED_PATH = "data/lowtimepilot-companies.json";
const FLIGHT_SCHOOLS_SEED_PATH = "data/flight-schools.json";

const BATCH_SIZE = 30;
const CONCURRENCY = 5;
const REQUEST_DELAY_MS = 250;
const ROTATION_BUCKET_MS = 4 * 3600_000;

function loadSeed(): LowtimepilotCompany[] {
  const path = join(process.cwd(), SEED_PATH);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    return (JSON.parse(raw) as LowtimepilotCompany[]).filter((s) => !!s.website);
  } catch {
    return [];
  }
}

function loadFlightSchoolsHostSet(): Set<string> {
  const path = join(process.cwd(), FLIGHT_SCHOOLS_SEED_PATH);
  if (!existsSync(path)) return new Set();
  try {
    const raw = readFileSync(path, "utf8");
    const schools = JSON.parse(raw) as Array<{ website: string | null }>;
    const out = new Set<string>();
    for (const s of schools) {
      const k = normalizeHostKey(s.website);
      if (k) out.add(k);
    }
    return out;
  } catch {
    return new Set();
  }
}

/** Probeable companies — the type narrows after `time_building` is filtered
 *  out, so `category` here is always a public JobCategory. Keep this type
 *  local to the adapter; the seed file's looser type stays in
 *  bootstrap-lowtimepilot.ts. */
type ProbeableCompany = Omit<LowtimepilotCompany, "category"> & { category: JobCategory };

function pickBatch(companies: ProbeableCompany[], now: number): ProbeableCompany[] {
  if (companies.length === 0) return [];
  const tick = Math.floor(now / ROTATION_BUCKET_MS);
  const start = (tick * BATCH_SIZE) % companies.length;
  const out: ProbeableCompany[] = [];
  for (let i = 0; i < BATCH_SIZE && i < companies.length; i++) {
    out.push(companies[(start + i) % companies.length]);
  }
  return out;
}

function titleFor(c: ProbeableCompany): string {
  const label: Record<JobCategory, string> = {
    cfi: "Flight Instructor",
    cfii: "Instrument Flight Instructor",
    mei: "Multi-Engine Instructor",
    part135: "Charter Pilot",
    part91: "Pilot",
    airline: "Pilot",
    corporate: "Corporate Pilot",
    other: "Pilot",
    aerial_survey: "Aerial Survey Pilot",
    pipeline_patrol: "Pipeline Patrol Pilot",
    skydiving: "Jump Pilot",
    banner_tow: "Banner Tow Pilot",
    traffic_watch: "Traffic Watch Pilot",
    air_ambulance: "Air Ambulance Pilot",
  };
  return `${label[c.category]} — ${c.name}`;
}

export const lowtimepilotAdapter: SourceAdapter = {
  id: "lowtimepilot",
  name: "Lowtimepilot company map",
  async fetch(): Promise<RawListing[]> {
    const all = loadSeed();
    if (all.length === 0) {
      console.log("[lowtimepilot] no seed data — run bootstrap-lowtimepilot.ts");
      return [];
    }

    // Filter 1: drop time-building programs (pay-to-play, not jobs).
    // After this filter, `category` is narrowed to JobCategory.
    const probeable: ProbeableCompany[] = all.filter(
      (c): c is ProbeableCompany => c.category !== "time_building",
    );
    const tbDropped = all.length - probeable.length;
    if (tbDropped > 0) console.log(`[lowtimepilot] skipped ${tbDropped} time-building entries`);

    // Filter 2: cross-seed dedup against flight-schools.
    const flightSchoolsHosts = loadFlightSchoolsHostSet();
    const deduped = probeable.filter((c) => {
      const k = normalizeHostKey(c.website);
      return k ? !flightSchoolsHosts.has(k) : true;
    });
    const dupDropped = probeable.length - deduped.length;
    if (dupDropped > 0) console.log(`[lowtimepilot] skipped ${dupDropped} companies already in flight-schools seed`);

    const fullScan = process.env.LOWTIMEPILOT_FULL === "1";
    const batch = fullScan ? deduped : pickBatch(deduped, Date.now());
    console.log(
      `[lowtimepilot] probing ${batch.length}/${deduped.length} companies${fullScan ? " (full scan)" : ""}…`,
    );

    const out: RawListing[] = [];
    let i = 0;

    async function worker() {
      while (i < batch.length) {
        const idx = i++;
        const company = batch[idx];
        try {
          const c: Company = {
            id: company.id,
            name: company.name,
            city: company.city,
            state: company.state,
            website: company.website,
          };
          const listing = await probeCareerPage(c, {
            sourceId: "lowtimepilot",
            titleTemplate: () => titleFor(company),
            categoryHint: company.category,
          });
          if (listing) out.push(listing);
        } catch {
          // Swallow per-company errors — one broken site shouldn't kill the run.
        }
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    console.log(`[lowtimepilot] matched ${out.length} companies with active hiring signal`);
    return out;
  },
};
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Smoke-test the adapter directly**

```bash
bun -e "
import { lowtimepilotAdapter } from './src/scrapers/adapters/lowtimepilot.ts';
process.env.LOWTIMEPILOT_FULL = '0';
const out = await lowtimepilotAdapter.fetch();
console.log('emitted:', out.length);
if (out.length > 0) {
  const sample = out[0];
  console.log('sample:', {
    externalId: sample.externalId,
    title: sample.title,
    employer: sample.employer,
    location: sample.location,
    categoryHint: (sample as any).categoryHint,
    url: sample.url,
  });
}
"
```

Expected: runs without throwing. Emits ≥0 listings (depending on which rotation batch comes up — if 0, set `LOWTIMEPILOT_FULL=1` and confirm at least a handful match). `externalId` starts with `lowtimepilot-`, `categoryHint` is set to one of the new categories.

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/adapters/lowtimepilot.ts
git commit -m "feat(scrapers): lowtimepilot adapter

Probes lowtimepilot.com/company-map companies' websites for hiring
signals using the shared _probe-careers helper. Carries each
company's pre-tagged category through to listings via categoryHint,
bypassing title-based classification (most non-CFI postings don't
contain keywords the classifier would recognize).

Deduplicates against the flight-schools seed by normalized website
host. Rotation cycles every ~3 days; LOWTIMEPILOT_FULL=1 probes
all companies in one pass (for initial DB seed)."
```

---

### Task 7: Register the lowtimepilot adapter in the browser-runner

The new adapter does plain HTTP fetches (no Playwright at runtime — Playwright was only used by the bootstrap). It could go in either `registry.ts` (the standard adapter list) or `browser/run.ts`. We put it in the standard runner because it doesn't need Playwright at scrape time — only the one-shot bootstrap did.

**Files:**
- Modify: `src/scrapers/registry.ts`

- [ ] **Step 1: Add the import and entry**

Edit `src/scrapers/registry.ts`. Replace the existing imports + adapter list with:

```ts
import type { SourceAdapter } from "./types.ts";
import { jsfirmAdapter } from "./adapters/jsfirm.ts";
import { atsAdapter } from "./adapters/ats.ts";
import { workdayAdapter } from "./adapters/workday.ts";
import { atpCfiAdapter } from "./adapters/atp-cfi.ts";
import { skywestAdapter } from "./adapters/skywest.ts";
import { pccAdapter } from "./adapters/pcc.ts";
import { findAPilotAdapter } from "./adapters/findapilot.ts";
import { aopaJdnAdapter } from "./adapters/aopa-jdn.ts";
import { usaJobsAdapter } from "./adapters/usajobs.ts";
import { adzunaAdapter } from "./adapters/adzuna.ts";
import { millionairAdapter } from "./adapters/millionair.ts";
import { avJobsAdapter } from "./adapters/avjobs.ts";
import { icimsAdapter } from "./adapters/icims.ts";
import { nbaaAdapter } from "./adapters/nbaa.ts";
import { flightSchoolsAdapter } from "./adapters/flight-schools.ts";
import { lowtimepilotAdapter } from "./adapters/lowtimepilot.ts";

export const adapters: SourceAdapter[] = [
  jsfirmAdapter,
  atsAdapter,
  workdayAdapter,
  atpCfiAdapter,
  skywestAdapter,
  pccAdapter,
  findAPilotAdapter,
  aopaJdnAdapter,
  usaJobsAdapter,
  adzunaAdapter,
  millionairAdapter,
  avJobsAdapter,
  icimsAdapter,
  nbaaAdapter,
  flightSchoolsAdapter,
  lowtimepilotAdapter,
];
```

(`REMOVED_SOURCE_IDS` block stays as-is.)

- [ ] **Step 2: Verify the adapter is picked up by the runner**

```bash
bun -e "
import { adapters } from './src/scrapers/registry.ts';
console.log('registered:', adapters.map(a => a.id).join(', '));
const found = adapters.find(a => a.id === 'lowtimepilot');
console.log('lowtimepilot present:', !!found);
process.exit(found ? 0 : 1);
"
```

Expected: prints the comma-separated list of registered source IDs including `lowtimepilot`, exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/scrapers/registry.ts
git commit -m "feat(scrapers): register lowtimepilot adapter"
```

---

### Task 8: Extend `ListingFilter.category` and the API to accept arrays

So the UI can offer a "Non-CFI" composite chip (union of 6 categories) without doing N parallel API calls.

**Files:**
- Modify: `src/shared/types.ts` (`ListingFilter`)
- Modify: `src/server/routes/listings.ts` (`/` handler)

- [ ] **Step 1: Widen `ListingFilter.category`**

Edit `src/shared/types.ts`. Replace `ListingFilter`:

```ts
export type ListingFilter = {
  q?: string;
  category?: JobCategory;
  state?: string;
  postedSinceDays?: number;
  maxHoursRequired?: number;
  source?: string;
  limit?: number;
  offset?: number;
};
```

with:

```ts
export type ListingFilter = {
  q?: string;
  /** Single category OR array of categories. The API accepts repeated
   *  `category=` query params; the UI's grouped chips (e.g. "Non-CFI" =
   *  aerial_survey | pipeline_patrol | ...) submit multiple values. */
  category?: JobCategory | JobCategory[];
  state?: string;
  postedSinceDays?: number;
  maxHoursRequired?: number;
  source?: string;
  limit?: number;
  offset?: number;
};
```

- [ ] **Step 2: Update the API handler**

Edit `src/server/routes/listings.ts`. At the top, extend the drizzle import:

```ts
import { and, desc, eq, gte, inArray, lte, like, or, sql } from "drizzle-orm";
```

In the GET `/` handler, replace:

```ts
  const category = c.req.query("category")?.trim();
  // ...
  if (category) conditions.push(eq(listings.jobCategory, category));
```

with:

```ts
  // Accept either a single category or repeated `category=` params for
  // the grouped chips in the UI (e.g. "Non-CFI" → 6 categories).
  const categories = c.req.queries("category")?.map((s) => s.trim()).filter(Boolean) ?? [];
  // ...
  if (categories.length === 1) {
    conditions.push(eq(listings.jobCategory, categories[0]));
  } else if (categories.length > 1) {
    conditions.push(inArray(listings.jobCategory, categories));
  }
```

(`c.req.queries(name)` returns `string[]` for repeated params; `c.req.query(name)` would only give the first. See [Hono docs](https://hono.dev/api/request#queries).)

- [ ] **Step 3: Verify the API handles both shapes**

Start the API server in the background:

```bash
bun run dev:api &
sleep 2
```

Hit it with each shape:

```bash
# Single category — existing shape.
curl -s 'http://localhost:3000/api/listings?category=cfi&limit=1' | bun -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('single category total:', j.total);});"

# Multiple categories — new shape. Should return >= union of individual queries.
curl -s 'http://localhost:3000/api/listings?category=cfi&category=cfii&limit=1' | bun -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('multi category total:', j.total);});"

# No category — should return all.
curl -s 'http://localhost:3000/api/listings?limit=1' | bun -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('no category total:', j.total);});"
```

Kill the dev server:

```bash
kill %1 2>/dev/null || true
```

Expected:
- `single category total` returns a finite number (matches what we had before).
- `multi category total` ≥ `single category total` (it's a union).
- `no category total` is the largest of the three.

If your local API port isn't 3000, substitute the actual port (check `src/server/index.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/server/routes/listings.ts
git commit -m "feat(api): listings category filter accepts repeated params

Lets the UI submit grouped category filters in a single request
(e.g. 'Non-CFI' = aerial_survey | pipeline_patrol | skydiving |
banner_tow | traffic_watch | air_ambulance) instead of N parallel
calls."
```

---

### Task 9: UI category chip groups (incl. "Non-CFI" composite)

**Files:**
- Modify: `src/web/App.tsx` (filter chips around line 1326, URL parse/write around lines 102-138, active-filter chips around line 380)

This is the most intricate UI task. Read the surrounding code in App.tsx before editing — the chip rendering interacts with URL sync, localStorage, and the active-filter pill bar.

- [ ] **Step 1: Define category groups**

Add this constant near the existing `CATEGORY_ORDER`:

```ts
/**
 * Grouped chips for the filter row. Each chip selects one or more
 * categories — the "Non-CFI" chip is a composite that unions the six
 * operator categories (aerial_survey, pipeline_patrol, etc.) so the
 * sibling can browse them as a single tab. Individual categories are
 * still selectable separately further down the row.
 */
const CATEGORY_GROUPS: Array<{ id: string; label: string; categories: JobCategory[] }> = [
  { id: "cfi-all", label: "All CFI", categories: ["cfi", "cfii", "mei"] },
  { id: "non-cfi", label: "Non-CFI", categories: [
    "aerial_survey", "pipeline_patrol", "skydiving",
    "banner_tow", "traffic_watch", "air_ambulance",
  ]},
  { id: "charter", label: "Charter / 135", categories: ["part135"] },
  { id: "airline", label: "Airline", categories: ["airline"] },
  { id: "corporate", label: "Corporate", categories: ["corporate"] },
];
```

- [ ] **Step 2: Update URL parser/writer for array categories**

In `parseFilter` (around line 102-118), replace the line:

```ts
    category: (usp.get("category") as JobCategory) ?? undefined,
```

with:

```ts
    category: (() => {
      const all = usp.getAll("category") as JobCategory[];
      if (all.length === 0) return undefined;
      if (all.length === 1) return all[0];
      return all;
    })(),
```

In `writeFilterToUrl` (around line 121-139), replace the inner loop:

```ts
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    if ((k === "postedSinceDays" && v === 30) || (k === "limit" && v === 50) || (k === "offset" && v === 0)) continue;
    usp.set(k, String(v));
  }
```

with:

```ts
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    if ((k === "postedSinceDays" && v === 30) || (k === "limit" && v === 50) || (k === "offset" && v === 0)) continue;
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.set(k, String(v));
    }
  }
```

- [ ] **Step 3: Update the API client to send multiple `category` params**

Open `src/web/api.ts`. Find where the listings fetcher builds the URL/query string. The change pattern is:

Replace:
```ts
if (filter.category) params.set("category", filter.category);
```
(or its equivalent) with:
```ts
if (Array.isArray(filter.category)) {
  for (const c of filter.category) params.append("category", c);
} else if (filter.category) {
  params.set("category", filter.category);
}
```

If the existing code already iterates `Object.entries(filter)` with `params.set`, change the inner branch to call `append` for arrays — same pattern as Step 2.

- [ ] **Step 4: Render the chip groups**

In App.tsx around line 1326 (the existing chip-rendering block), the current code maps `CATEGORY_ORDER` to chips that toggle a single category. Refactor it to render `CATEGORY_GROUPS` first (above the individual category chips), where clicking a group chip sets `filter.category` to the group's `categories` array:

```tsx
{CATEGORY_GROUPS.map((g) => {
  const groupCats = new Set(g.categories);
  const currentSet = new Set(
    Array.isArray(filter.category) ? filter.category :
    filter.category ? [filter.category] : []
  );
  const selected = g.categories.every((c) => currentSet.has(c)) &&
                   g.categories.length === currentSet.size;
  return (
    <button
      key={g.id}
      onClick={() => set("category", selected ? undefined : g.categories)}
      className={/* same classes the existing single-category chip uses */}
    >
      {g.label}
    </button>
  );
})}
```

(Use the exact className string from the existing chip — copy it verbatim. The skill plan can't second-guess your Tailwind classes here.)

Below the group chips, keep the existing `CATEGORY_ORDER` chip row but adjust the selected-check to handle arrays:

```tsx
const selected = Array.isArray(filter.category)
  ? filter.category.includes(cat)
  : filter.category === cat;
```

And the onClick:

```tsx
onClick={() => set("category", selected ? undefined : cat)}
```

(unchanged for the single-cat row, since clicking an individual chip overrides any group selection to that single category — simpler mental model than maintaining a multi-select.)

- [ ] **Step 5: Update the active-filter pill bar**

Around line 380:

```ts
if (filter.category) chips.push({ key: "category", label: CATEGORY_LABELS[filter.category] });
```

Replace with:

```ts
if (filter.category) {
  if (Array.isArray(filter.category)) {
    // Try to match a group label first; fall back to "N categories".
    const matched = CATEGORY_GROUPS.find((g) =>
      g.categories.length === filter.category!.length &&
      g.categories.every((c) => (filter.category as JobCategory[]).includes(c))
    );
    const label = matched ? matched.label : `${filter.category.length} categories`;
    chips.push({ key: "category", label });
  } else {
    chips.push({ key: "category", label: CATEGORY_LABELS[filter.category] });
  }
}
```

- [ ] **Step 6: Manual UI check**

Start both servers:

```bash
bun run dev
```

In a browser, open the URL the dev server prints (usually `http://localhost:5173`). Verify:

1. Default landing filter shows CFI listings (no regression).
2. The new group chip row renders above the individual categories with chips: "All CFI", "Non-CFI", "Charter / 135", "Airline", "Corporate".
3. Click "Non-CFI". The listings table updates. Results include any combination of the 6 non-CFI categories. The URL hash now contains six `category=…` params. Active-filter pill shows "Non-CFI".
4. Refresh the page. Filter state restores from URL — chip selection survives.
5. Click the individual "CFI" chip in the lower row. Filter switches to single-CFI; URL has one `category=cfi`. Active-filter pill shows "CFI".
6. Clear the filter (X on the pill or click chip again). Listings show everything.

If any of (1-6) doesn't work, fix and re-verify before committing.

- [ ] **Step 7: Type-check + lint (if configured)**

```bash
bunx tsc --noEmit
```

Expected: no new errors. (`tsc --noEmit` covers the React side because Vite uses TS but tsc verifies types separately.)

- [ ] **Step 8: Commit**

```bash
git add src/web/App.tsx src/web/api.ts
git commit -m "feat(web): grouped category chips incl. 'Non-CFI' composite

Adds a row of grouped chips above the per-category chips. The
'Non-CFI' chip selects the 6 new operator categories at once
(aerial_survey, pipeline_patrol, skydiving, banner_tow,
traffic_watch, air_ambulance) so the sibling can browse them as a
single tab — what Ahmad asked for. URL sync handles repeated
category= params; active-filter pill labels grouped selections by
their group name."
```

---

### Task 10: Full pipeline run + reclassify backfill sanity check

End-to-end verification that the new adapter writes to the DB, the reclassify backfill picks up the new branches, and the UI surfaces both correctly.

**Files:** (read-only verification)

- [ ] **Step 1: Run a full scrape including the new adapter**

```bash
bun run db:migrate
LOWTIMEPILOT_FULL=1 bun run scrape
```

Expected output includes:
- A `[lowtimepilot]` line showing companies probed and matches found.
- `[flight-schools]` continues to work (no regression).
- No exceptions raised.

- [ ] **Step 2: Confirm new categories in the DB**

```bash
bun -e "
import { sqlite } from './src/db/client.ts';
const rows = sqlite.query(\`
  SELECT job_category, COUNT(*) as n
  FROM listings
  WHERE is_closed = 0
  GROUP BY job_category
  ORDER BY n DESC
\`).all();
for (const r of rows) console.log(r.job_category?.padEnd(20) ?? '(null)'.padEnd(20), r.n);
"
```

Expected: at least 3 of the new categories (`aerial_survey | pipeline_patrol | skydiving | banner_tow | traffic_watch | air_ambulance`) show non-zero counts. `part91` count may shift (some rows reclassified into new buckets).

- [ ] **Step 3: Verify reclassify backfill moved existing rows**

If the project has a backfill script (commit `b928356` added one — check for `src/scrapers/reclassify.ts` or similar; if it exists, run it):

```bash
# Adjust the script path/name based on what exists in the repo.
bun src/scrapers/reclassify.ts 2>&1 | head -30
```

After backfill, re-run Step 2's query and confirm `part91` count dropped while the new buckets grew. If no standalone backfill script exists in the repo, this step is skipped — the next normal scrape will reclassify naturally as listings get re-upserted.

- [ ] **Step 4: Manual UI end-to-end**

```bash
bun run dev
```

In the browser:
1. Click the "Non-CFI" group chip. Listings table populates with entries from the new categories.
2. Open the JSON for one such listing (or hover over its details). Confirm `jobCategory` is one of the new buckets.
3. Click into a listing — the URL link goes to the real careers page.

- [ ] **Step 5: Commit (if any cleanup needed)**

If steps 1-4 surfaced fixes, group them into a small commit. Otherwise no commit needed — this task is verification-only.

If verifying revealed substantive issues (a category that never matches, a UI chip that's broken), reopen the relevant earlier task rather than papering over here.

---

## Out of scope (don't do these in this plan)

- Hours-by-class extraction (SE/ME/Turbine/Tailwheel/Float) → sub-project B.
- FAA reference library ingest → sub-project C.
- Lesson plans → sub-project D (blocked on bro's materials).
- Diagrams → sub-project E.
- Per-category hiring-signal regex tuning (e.g. "we need jump pilots" for skydiving operators). First pass uses the generic regex. Tune later if data warrants.
- Cross-source enrichment beyond website-host dedup.

## Risk notes

- **Playwright on Windows** can hang on chromium for some users. The bootstrap inherits `PLAYWRIGHT_BROWSER=firefox` as a fallback — install firefox first via `bunx playwright install firefox`. CI runs on Linux where chromium works.
- **Lowtimepilot's page structure may change** between when this spec was written and when it's implemented. The Task 4 discovery probe protects against this — never skip it.
- **Cross-source dedup is permissive** (drops dup from lowtimepilot if same host appears in flight-schools). If a school appears in both and is more interesting on the lowtimepilot side (e.g. they primarily do skydiving but ATP listed them as a flight school), we lose that. Acceptable for v1.
