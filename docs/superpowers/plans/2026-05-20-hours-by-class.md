# Hours-by-class extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract per-class hour minimums (multi / turbine / tailwheel / complex / instrument / PIC / cross-country) from listing text, surface them as chips on the listing card, extend the applicant profile, and refine the match score for per-class deficits.

**Architecture:** New `extractHoursByClass()` enricher feeds a JSON `hours_breakdown` column on listings. A backfill script runs on every deploy (mirroring `reclassify-categories.ts`) so cached rows pick up the logic. The applicant profile and match score both grow per-class awareness; the UI renders a chip row beneath the existing total-time line on each listing card.

**Tech Stack:** Bun, TypeScript, Drizzle ORM + SQLite, Hono API, React 18 + Tailwind UI.

**Spec:** [docs/superpowers/specs/2026-05-20-hours-by-class-design.md](../specs/2026-05-20-hours-by-class-design.md)

**Verification regime:** Repo has no test suite. Each task uses ad-hoc `bun -e` scripts, typecheck, and (where applicable) a `bun run build:static` smoke check.

---

### Task 1: Schema, types, and the HoursBreakdown shape

**Goal:** Add the `hours_breakdown` column, `HoursBreakdown` type, and the corresponding `Listing.hoursBreakdown` / `EnrichedListing.hoursBreakdown` field so the rest of the plan has a stable contract to build against.

**Files:**
- Modify: `src/db/schema.ts` (add column)
- Modify: `src/shared/types.ts` (add HoursBreakdown + extend Listing)
- Modify: `src/scrapers/types.ts` (extend EnrichedListing)

**Acceptance Criteria:**
- [ ] `listings` table has a nullable `hours_breakdown` TEXT column
- [ ] `HoursBreakdown` type is exported with all 7 optional number fields
- [ ] `Listing` has `hoursBreakdown: HoursBreakdown | null`
- [ ] `EnrichedListing` has `hoursBreakdown: HoursBreakdown | null`
- [ ] `bunx tsc --noEmit` is clean

**Verify:** `bunx tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Add the column to the schema**

Edit `src/db/schema.ts`. Inside the `listings` table definition, add the new column right after `ratingsRequired`:

```ts
ratingsRequired: text("ratings_required"),
hoursBreakdown: text("hours_breakdown"),
enrichedAt: integer("enriched_at"),
```

- [ ] **Step 2: Add the type and extend Listing**

Edit `src/shared/types.ts`. Add the new type near the top (above `Listing`):

```ts
export type HoursBreakdown = {
  multiEngine?: number;
  turbine?: number;
  tailwheel?: number;
  complex?: number;
  instrument?: number;
  pic?: number;
  crossCountry?: number;
};
```

Extend the `Listing` type to include the new field. Add it after `ratingsRequired`:

```ts
ratingsRequired: string[] | null;
hoursBreakdown: HoursBreakdown | null;
rawTitle: string;
```

- [ ] **Step 3: Extend EnrichedListing**

Edit `src/scrapers/types.ts`. Add the field to `EnrichedListing`:

```ts
export type EnrichedListing = RawListing & {
  state: string | null;
  jobCategory: JobCategory | null;
  hoursRequired: number | null;
  ratingsRequired: string[] | null;
  hoursBreakdown: import("../shared/types.ts").HoursBreakdown | null;
};
```

(Inline import is OK here — the file already mixes inline imports with top-level imports.)

- [ ] **Step 4: Run migration to add the column to the local DB**

```bash
bun run db:migrate
```

Expected: prints migration output. If drizzle-kit auto-generates a migration, accept it. If you have to write one by hand (drizzle uses statement-tracking, not file-based migrations for sqlite — verify the actual flow by reading `src/db/migrate.ts`).

Actually — `migrate.ts` uses drizzle-kit `pushSchema` style; `bun run db:migrate` should diff and apply. Verify with:

```bash
bun -e "import { sqlite } from './src/db/client.ts'; console.log(sqlite.query(\"PRAGMA table_info(listings)\").all());"
```

Expected: output includes a row with `name: 'hours_breakdown', type: 'TEXT'`.

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean exit. There will be downstream type errors in `src/server/routes/listings.ts` (the row mapper doesn't yet read the new field) and possibly other places — that's fine, those will land in later tasks. If your repo has a strict TS config that breaks the build on these, accept the errors for now; later tasks will fix them. (If it's too noisy, you can fix the listings.ts row mapper preemptively — but the cleanest path is to leave it for Task 3.)

If tsc DOES error on these downstream sites: add a quick `hoursBreakdown: null` to the row mapper now (one line in `rowToListing`) so the type lines up. Note this in your commit message.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/shared/types.ts src/scrapers/types.ts src/server/routes/listings.ts
git commit -m "feat(types): add HoursBreakdown type and hours_breakdown column

New JSON-encoded column for per-class hour minimums (multi /
turbine / tailwheel / complex / instrument / PIC / cross-country).
Listing and EnrichedListing types grow the field; the API row
mapper returns null until the enricher populates the column."
```

```json:metadata
{"files":["src/db/schema.ts","src/shared/types.ts","src/scrapers/types.ts","src/server/routes/listings.ts"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["hours_breakdown column added","HoursBreakdown type exported","Listing.hoursBreakdown field present","EnrichedListing.hoursBreakdown field present","typecheck clean"]}
```

---

### Task 2: Implement extractHoursByClass and wire it into enrichListing

**Goal:** New extractor function + integration into the enrich pipeline so future scrapes populate `hoursBreakdown`.

**Files:**
- Modify: `src/scrapers/enrich.ts`

**Acceptance Criteria:**
- [ ] `extractHoursByClass(text)` exported, returns `HoursBreakdown | null`
- [ ] Handles all 7 classes per the spec's regex table
- [ ] Drops matches outside the 10..15000 range
- [ ] Returns minimum value when multiple matches exist for the same class
- [ ] `enrichListing` populates `hoursBreakdown`
- [ ] Ad-hoc verification script passes

**Verify:**

```bash
bun -e "
import { extractHoursByClass } from './src/scrapers/enrich.ts';
const cases = [
  ['50 hours multi-engine required',                    { multiEngine: 50 }],
  ['Must have 25 tailwheel and 10 complex',              { tailwheel: 25, complex: 10 }],
  ['100 hours PIC, 50 hours instrument',                 { pic: 100, instrument: 50 }],
  ['Looking for 300 hour pilot with 25 XC',              { crossCountry: 25 }],
  ['ATP — 1500 TT, 500 turbine',                         { turbine: 500 }],
  ['Generic pilot job',                                  null],
  ['5 hour intro flight package available',              null],
  ['50000 hours of experience',                          null],
];
let pass = 0, fail = 0;
for (const [text, want] of cases) {
  const got = extractHoursByClass(text);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + text.padEnd(50) + ' got=' + JSON.stringify(got));
  ok ? pass++ : fail++;
}
console.log(pass + ' pass / ' + fail + ' fail');
process.exit(fail > 0 ? 1 : 0);
"
```

Expected: 8 pass / 0 fail, exit 0.

**Steps:**

- [ ] **Step 1: Write the extractor**

Edit `src/scrapers/enrich.ts`. Add the new function. Place it near the existing `extractHoursRequired` so related logic stays co-located. Add the import at the top of the file:

```ts
import type { HoursBreakdown, JobCategory } from "../shared/types.ts";
```

(The file already imports `JobCategory`; merge the imports.)

Then add the function:

```ts
// Per-class hour patterns. Each entry's regex captures the number first,
// then matches the class noun within a short trailing window. The
// captures look for `\b\d{2,5}\b` so we don't fire on stray digits in
// e.g. "Cessna 172" or "Boeing 737". The 10..15000 range filter on the
// captured number suppresses obvious nonsense.
const HOURS_BY_CLASS_PATTERNS: Array<[keyof HoursBreakdown, RegExp]> = [
  ["multiEngine", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?(?:multi[-\s]?engine|\bME\b|\bAMEL\b)/gi],
  ["turbine", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?(?:turbine|turboprop|\bjet\b)/gi],
  ["tailwheel", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?tail[-\s]?wheel/gi],
  ["complex", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?complex/gi],
  ["instrument", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?(?:instrument|\bIFR\b|\bIMC\b|\bactual\b)/gi],
  ["pic", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?\bPIC\b/g],
  ["crossCountry", /\b(\d{2,5})\s+(?:hours?\s+(?:of\s+)?)?(?:cross[-\s]?country|\bx[-\s]?country\b|\bXC\b)/gi],
];

export function extractHoursByClass(text: string | null | undefined): HoursBreakdown | null {
  if (!text) return null;
  const out: HoursBreakdown = {};
  for (const [key, re] of HOURS_BY_CLASS_PATTERNS) {
    re.lastIndex = 0;
    const found: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 10 && n <= 15000) found.push(n);
    }
    if (found.length > 0) out[key] = Math.min(...found);
  }
  return Object.keys(out).length > 0 ? out : null;
}
```

- [ ] **Step 2: Wire into enrichListing**

In `src/scrapers/enrich.ts`, find the existing `enrichListing` function and extend its return:

```ts
export function enrichListing(raw: RawListing): EnrichedListing {
  const category = raw.categoryHint ?? classifyCategory(raw.title, raw.description, raw.employer);
  const fullText = `${raw.title}\n${raw.description ?? ""}`;
  return {
    ...raw,
    state: extractState(raw.location),
    jobCategory: category,
    hoursRequired: extractHoursRequired(fullText),
    ratingsRequired: extractRatings(fullText),
    hoursBreakdown: extractHoursByClass(fullText),
  };
}
```

(Note: the existing code computes hoursRequired/ratingsRequired off `${raw.title}\n${raw.description ?? ""}` inline; the refactor above hoists `fullText` so all three extractors share the same input. Keep that hoist.)

- [ ] **Step 3: Run the verification script**

(Use the bun -e block from the **Verify** section above.)

Expected: `8 pass / 0 fail`, exit 0.

If anything fails: the most likely culprit is the regex. Test individual patterns by simplifying the verification script to one case at a time. The PIC pattern is the trickiest (case-sensitive, no /i flag) — make sure it matches `100 PIC` and `100 hours PIC` but NOT `picnic` or `epic`.

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/enrich.ts
git commit -m "feat(enrich): extract per-class hour minimums

New extractHoursByClass() finds per-class hour requirements
(multi-engine, turbine, tailwheel, complex, instrument, PIC,
cross-country) in listing text. enrichListing now populates the
hoursBreakdown field on every emit; backfill in a later commit."
```

```json:metadata
{"files":["src/scrapers/enrich.ts"],"verifyCommand":"bun -e 'import { extractHoursByClass } from \"./src/scrapers/enrich.ts\"; const c=[[\"50 hours multi-engine required\",{multiEngine:50}],[\"Generic pilot job\",null]]; for (const [t,w] of c) { const g=extractHoursByClass(t); if (JSON.stringify(g)!==JSON.stringify(w)) { console.error(\"FAIL\",t,g); process.exit(1);}} console.log(\"OK\")'","acceptanceCriteria":["extractHoursByClass exported","7 classes recognized","Out-of-range numbers dropped","Min selected when multiple matches","enrichListing populates hoursBreakdown","Verification script 8/8 pass"]}
```

---

### Task 3: Wire JSON serialization in runners and API row mapper

**Goal:** Persist `hoursBreakdown` to the DB through both runners; deserialize on the API read path so the field flows end-to-end.

**Files:**
- Modify: `src/scrapers/run.ts` (insert + onConflictDoUpdate mappings)
- Modify: `src/scrapers/browser/runner.ts` (parity)
- Modify: `src/server/routes/listings.ts` (rowToListing)

**Acceptance Criteria:**
- [ ] `run.ts` writes the JSON-stringified breakdown on insert AND on conflict update
- [ ] `browser/runner.ts` has the same shape (even though no browser adapters are registered today)
- [ ] `rowToListing` parses the column back into `HoursBreakdown | null`
- [ ] `bunx tsc --noEmit` clean
- [ ] Round-trip test: an enriched listing inserted and read back retains the breakdown

**Verify:**

```bash
bun -e "
import { db, sqlite } from './src/db/client.ts';
import { listings } from './src/db/schema.ts';
import { enrichListing } from './src/scrapers/enrich.ts';
import { eq } from 'drizzle-orm';

const raw = {
  externalId: 'test-hours-breakdown',
  title: 'Pilot — 250 TT, 50 multi-engine, 25 turbine',
  url: 'https://example.com/test',
  description: 'See above',
  postedAt: Date.now(),
};
const enriched = enrichListing(raw);
console.log('extracted:', enriched.hoursBreakdown);

await db.insert(listings).values({
  sourceId: 'test',
  externalId: enriched.externalId,
  title: enriched.title,
  rawTitle: enriched.title,
  url: enriched.url,
  postedAt: enriched.postedAt,
  fetchedAt: Date.now(),
  jobCategory: enriched.jobCategory,
  hoursRequired: enriched.hoursRequired,
  ratingsRequired: enriched.ratingsRequired ? JSON.stringify(enriched.ratingsRequired) : null,
  hoursBreakdown: enriched.hoursBreakdown ? JSON.stringify(enriched.hoursBreakdown) : null,
}).onConflictDoUpdate({
  target: [listings.sourceId, listings.externalId],
  set: { fetchedAt: Date.now() },
});

import { Hono } from 'hono';
import { listingsRoute } from './src/server/routes/listings.ts';
const app = new Hono();
app.route('/api/listings', listingsRoute);
const res = await app.request('http://x/api/listings?source=test&limit=1');
const j = await res.json();
const item = j.items.find(x => x.externalId === 'test-hours-breakdown');
console.log('round-trip:', item?.hoursBreakdown);

// Cleanup
await db.delete(listings).where(eq(listings.externalId, 'test-hours-breakdown'));

if (!item || !item.hoursBreakdown || item.hoursBreakdown.multiEngine !== 50) {
  console.error('FAIL'); process.exit(1);
}
console.log('OK');
"
```

Expected: `extracted: { multiEngine: 50, turbine: 25 }` (or similar), `round-trip: { multiEngine: 50, turbine: 25 }`, `OK`, exit 0.

**Steps:**

- [ ] **Step 1: Add to `run.ts` insert path**

Edit `src/scrapers/run.ts`. Find the `db.insert(listings).values({ ... })` block. Add the new field alongside the existing JSON-stringified `ratingsRequired`:

```ts
ratingsRequired: enriched.ratingsRequired ? JSON.stringify(enriched.ratingsRequired) : null,
hoursBreakdown: enriched.hoursBreakdown ? JSON.stringify(enriched.hoursBreakdown) : null,
```

Add it to the `onConflictDoUpdate.set` block too:

```ts
ratingsRequired: enriched.ratingsRequired ? JSON.stringify(enriched.ratingsRequired) : null,
hoursBreakdown: enriched.hoursBreakdown ? JSON.stringify(enriched.hoursBreakdown) : null,
```

- [ ] **Step 2: Same for browser/runner.ts**

Edit `src/scrapers/browser/runner.ts`. Make the same two additions in the insert and onConflictDoUpdate blocks. The structure is parallel to `run.ts`.

- [ ] **Step 3: API row mapper**

Edit `src/server/routes/listings.ts`. The current `safeParseRatings(s)` helper deserializes the JSON-encoded `ratings_required`. Add a parallel `safeParseHoursBreakdown(s)`:

```ts
function safeParseHoursBreakdown(s: string): HoursBreakdown | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as HoursBreakdown) : null;
  } catch {
    return null;
  }
}
```

Add the import at the top:

```ts
import type { HoursBreakdown, Listing } from "../../shared/types.ts";
```

(Merge into the existing `Listing` type import.)

In `rowToListing`, add the new field:

```ts
ratingsRequired: r.ratingsRequired ? safeParseRatings(r.ratingsRequired) : null,
hoursBreakdown: r.hoursBreakdown ? safeParseHoursBreakdown(r.hoursBreakdown) : null,
```

- [ ] **Step 4: Run the round-trip verification**

(Use the bun -e block from the **Verify** section above.)

Expected: extracted and round-trip both show `{ multiEngine: 50, turbine: 25 }`, `OK`.

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/run.ts src/scrapers/browser/runner.ts src/server/routes/listings.ts
git commit -m "feat(persist): write hours_breakdown through runners and API

Both runners JSON-stringify enriched.hoursBreakdown on insert and
conflict update. The API row mapper parses it back via a new
safeParseHoursBreakdown helper. Full round-trip works."
```

```json:metadata
{"files":["src/scrapers/run.ts","src/scrapers/browser/runner.ts","src/server/routes/listings.ts"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["run.ts persists hoursBreakdown JSON","browser/runner.ts mirrors the same","API row mapper deserializes via safeParseHoursBreakdown","Round-trip test passes"]}
```

---

### Task 4: Backfill script + CI wiring

**Goal:** One-shot script to re-extract hours_breakdown over every row, plus integration into the deploy workflow so cached production rows get updated on next push.

**Files:**
- Create: `scripts/reextract-hours-breakdown.ts`
- Modify: `.github/workflows/scrape-and-deploy.yml`

**Acceptance Criteria:**
- [ ] Script walks all listings rows
- [ ] For each, computes `extractHoursByClass(title + description)` and writes when different
- [ ] Idempotent (second run reports 0 changes)
- [ ] CI workflow runs the script right after the existing reclassify step
- [ ] Local run reports a non-zero change count on first invocation (current rows have no breakdown)

**Verify:**

```bash
bun scripts/reextract-hours-breakdown.ts
# Run a second time to confirm idempotence
bun scripts/reextract-hours-breakdown.ts
```

Expected: first run reports N > 0 changed rows; second run reports 0.

**Steps:**

- [ ] **Step 1: Write the backfill script**

Create `scripts/reextract-hours-breakdown.ts`:

```ts
/**
 * One-time backfill: re-runs extractHoursByClass() against every row in the
 * listings DB. Run after changes to the per-class hour patterns so existing
 * rows pick up the new logic without waiting for sources to re-surface them.
 *
 *   bun scripts/reextract-hours-breakdown.ts          # apply
 *   bun scripts/reextract-hours-breakdown.ts --dry    # report only
 *
 * Safe to run repeatedly: rows whose breakdown already matches the current
 * logic are skipped.
 */
import { eq } from "drizzle-orm";
import { db, sqlite } from "../src/db/client.ts";
import { listings } from "../src/db/schema.ts";
import { extractHoursByClass } from "../src/scrapers/enrich.ts";

const dryRun = process.argv.includes("--dry");

function main() {
  const rows = sqlite
    .query(
      "SELECT id, title, description, hours_breakdown as hoursBreakdown FROM listings",
    )
    .all() as Array<{
    id: number;
    title: string;
    description: string | null;
    hoursBreakdown: string | null;
  }>;

  let changed = 0;
  for (const r of rows) {
    const fullText = `${r.title}\n${r.description ?? ""}`;
    const next = extractHoursByClass(fullText);
    const nextJson = next ? JSON.stringify(next) : null;
    if (nextJson === r.hoursBreakdown) continue;
    changed++;
    if (!dryRun) {
      db.update(listings).set({ hoursBreakdown: nextJson }).where(eq(listings.id, r.id)).run();
    }
  }

  console.log(`Scanned ${rows.length} rows, ${changed} updated${dryRun ? " (dry run)" : ""}.`);
}

main();
```

- [ ] **Step 2: Smoke test locally**

```bash
bun scripts/reextract-hours-breakdown.ts --dry
```

Expected: prints the row count and how many would change. Since the column was just added and is null everywhere, the first run should report a non-trivial number of rows that have at least one per-class match.

Then run for real:

```bash
bun scripts/reextract-hours-breakdown.ts
```

Then re-run to confirm idempotence:

```bash
bun scripts/reextract-hours-breakdown.ts
```

Expected: second run reports `0 updated`.

- [ ] **Step 3: Add to CI workflow**

Edit `.github/workflows/scrape-and-deploy.yml`. Find the existing "Reclassify categories on cached rows" step. Add a new step immediately after it:

```yaml
      - name: Re-extract hours-by-class on cached rows
        run: bun scripts/reextract-hours-breakdown.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/reextract-hours-breakdown.ts .github/workflows/scrape-and-deploy.yml
git commit -m "feat(backfill): re-extract hours_breakdown over cached rows

Mirrors the reclassify-categories backfill pattern. Runs on every
deploy (push + cron + manual) so per-class extractor changes take
effect on cached rows without waiting for sources to re-surface
each listing."
```

```json:metadata
{"files":["scripts/reextract-hours-breakdown.ts",".github/workflows/scrape-and-deploy.yml"],"verifyCommand":"bun scripts/reextract-hours-breakdown.ts && bun scripts/reextract-hours-breakdown.ts","acceptanceCriteria":["backfill script created","Idempotent","CI workflow runs it after reclassify step"]}
```

---

### Task 5: ApplicantProfile fields + profile modal section

**Goal:** Extend the applicant profile with the seven per-class hour fields and add UI for entering them in the existing profile modal.

**Files:**
- Modify: `src/web/outreach.ts` (ApplicantProfile type)
- Modify: `src/web/App.tsx` (ProfileModal — find by reading)

**Acceptance Criteria:**
- [ ] `ApplicantProfile` has 7 optional number fields: `multiEngineHours`, `turbineHours`, `tailwheelHours`, `complexHours`, `instrumentHours`, `picHours`, `crossCountryHours`
- [ ] Profile modal has a collapsible "Hours by class" section with seven number inputs
- [ ] Values save and restore via localStorage round-trip
- [ ] `bunx tsc --noEmit` clean

**Verify:** Manual UI check on `bun run dev` — open profile, fill in some per-class hours, refresh, confirm values persist.

**Steps:**

- [ ] **Step 1: Extend ApplicantProfile**

Edit `src/web/outreach.ts`. Find the `ApplicantProfile` type. Add the new optional number fields after `monthlyHours`:

```ts
export type ApplicantProfile = {
  name?: string;
  email?: string;
  phone?: string;
  baseLocation?: string;
  totalTime?: number;
  monthlyHours?: number;
  multiEngineHours?: number;
  turbineHours?: number;
  tailwheelHours?: number;
  complexHours?: number;
  instrumentHours?: number;
  picHours?: number;
  crossCountryHours?: number;
  hasInstrument?: boolean;
  // ... rest unchanged
};
```

- [ ] **Step 2: Find ProfileModal and extend with the section**

Read `src/web/App.tsx` to find the `ProfileModal` component (grep for `function ProfileModal\|<ProfileModal`). The component has a form with labeled inputs for the existing profile fields (totalTime, monthlyHours, etc.).

Add a new collapsible section labeled "Hours by class" with seven number inputs, one per new field. Use the same input styling as the existing `totalTime` field for consistency. The section can be a `<details><summary>` element (collapsed by default) so it doesn't bloat the modal for users who don't track per-class hours.

Sketch (adapt to the actual component's structure):

```tsx
<details className="rounded-lg border border-ink-200 dark:border-ink-700 px-3 py-2">
  <summary className="cursor-pointer text-sm font-medium text-ink-700 dark:text-ink-200">
    Hours by class (optional)
  </summary>
  <div className="mt-3 grid grid-cols-2 gap-3">
    {[
      ['multiEngineHours', 'Multi-Engine'],
      ['turbineHours', 'Turbine'],
      ['tailwheelHours', 'Tailwheel'],
      ['complexHours', 'Complex'],
      ['instrumentHours', 'Instrument'],
      ['picHours', 'PIC'],
      ['crossCountryHours', 'Cross-country'],
    ].map(([key, label]) => (
      <label key={key} className="block">
        <span className="text-xs text-ink-600 dark:text-ink-300">{label}</span>
        <input
          type="number"
          min="0"
          value={profile[key as keyof ApplicantProfile] as number | undefined ?? ""}
          onChange={(e) => update(key as keyof ApplicantProfile, e.target.value ? Number(e.target.value) : undefined)}
          className={/* match existing totalTime input className */}
        />
      </label>
    ))}
  </div>
</details>
```

Use the exact className string from the existing totalTime input — copy it verbatim.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Manual round-trip**

```bash
bun run dev
```

In the browser:
- Open profile modal
- Expand "Hours by class"
- Enter `multiEngine = 50`, `turbine = 25`
- Save and close
- Refresh the page
- Re-open profile, expand the section, confirm 50 / 25 are still there

If values persist → pass. If they don't → check the `update()` call passes the right key and the storage path saves the new fields (probably already works via the generic `writeApplicantProfile`).

- [ ] **Step 5: Commit**

```bash
git add src/web/outreach.ts src/web/App.tsx
git commit -m "feat(web): extend ApplicantProfile with per-class hours

Seven optional number fields (multiEngine / turbine / tailwheel /
complex / instrument / PIC / crossCountry) + a collapsible section
in ProfileModal. Lays the groundwork for per-class deficit penalty
in match scoring (next task)."
```

```json:metadata
{"files":["src/web/outreach.ts","src/web/App.tsx"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["ApplicantProfile has 7 new fields","ProfileModal has Hours by class section","Values persist across reload","Typecheck clean"]}
```

---

### Task 6: Match score per-class deficit penalty

**Goal:** When a listing has per-class minimums and the applicant has per-class hours, deduct up to 10 points per class (capped at -25 across all classes) for any deficit. Surface the dominant deficit in the reason string.

**Files:**
- Modify: `src/web/match.ts`

**Acceptance Criteria:**
- [ ] New helper function computes per-class penalty
- [ ] Applied to the score during `matchScore`
- [ ] Skipped when applicant hasn't filled in that class (undefined profile value)
- [ ] Cap of -25 across all classes
- [ ] Dominant deficit becomes the `reason` when it's the top factor
- [ ] Test cases pass

**Verify:**

```bash
bun -e "
import { matchScore } from './src/web/match.ts';
const listing = {
  id: 1, sourceId: 's', externalId: 'e', title: 'Pilot — 50 ME, 25 turbine',
  rawTitle: 'Pilot — 50 ME, 25 turbine',
  employer: 'Acme', location: 'TX', state: 'TX', url: 'x',
  description: '50 multi-engine and 25 turbine required',
  postedAt: Date.now(), postedAtAccurate: true, fetchedAt: Date.now(),
  jobCategory: 'cfi', hoursRequired: null, ratingsRequired: null,
  hoursBreakdown: { multiEngine: 50, turbine: 25 },
};
// Applicant with full hours — no deficit
const full = matchScore(listing, { totalTime: 500, multiEngineHours: 60, turbineHours: 30, hasInstrument: true });
// Applicant short on multi
const short = matchScore(listing, { totalTime: 500, multiEngineHours: 10, turbineHours: 30, hasInstrument: true });
// Applicant who hasn't tracked these
const untracked = matchScore(listing, { totalTime: 500, hasInstrument: true });

console.log('full:', full.score, 'reason:', full.reason);
console.log('short:', short.score, 'reason:', short.reason);
console.log('untracked:', untracked.score, 'reason:', untracked.reason);

if (short.score >= full.score) { console.error('FAIL: short should score lower than full'); process.exit(1); }
if (untracked.score < full.score) { console.error('FAIL: untracked should not be penalized'); process.exit(1); }
console.log('OK');
"
```

Expected: short < full, untracked ≈ full (no penalty), `OK`.

**Steps:**

- [ ] **Step 1: Read the existing `matchScore` implementation**

Read `src/web/match.ts` to understand the current scoring shape. The function returns `{ score, tier, reason }` and applies several rules sequentially.

- [ ] **Step 2: Add the per-class penalty helper**

Add this helper inside `match.ts`, near the existing scoring rules:

```ts
const PER_CLASS_LABELS: Array<[keyof HoursBreakdown, keyof ApplicantProfile, string]> = [
  ["multiEngine", "multiEngineHours", "ME"],
  ["turbine", "turbineHours", "turbine"],
  ["tailwheel", "tailwheelHours", "tailwheel"],
  ["complex", "complexHours", "complex"],
  ["instrument", "instrumentHours", "instrument"],
  ["pic", "picHours", "PIC"],
  ["crossCountry", "crossCountryHours", "XC"],
];

function perClassDeficit(
  breakdown: HoursBreakdown | null,
  profile: ApplicantProfile,
): { penalty: number; topDeficit: { label: string; have: number; need: number } | null } {
  if (!breakdown) return { penalty: 0, topDeficit: null };
  let total = 0;
  let top: { label: string; have: number; need: number; ratio: number } | null = null;
  for (const [breakKey, profKey, label] of PER_CLASS_LABELS) {
    const required = breakdown[breakKey];
    const have = profile[profKey] as number | undefined;
    if (required == null || have == null) continue;
    const deficit = Math.max(0, required - have);
    if (deficit === 0) continue;
    const ratio = required > 0 ? Math.min(1, deficit / required) : 0;
    const penalty = Math.round(ratio * 10);
    total += penalty;
    if (!top || ratio > top.ratio) {
      top = { label, have, need: required, ratio };
    }
  }
  total = Math.min(total, 25); // cap
  return {
    penalty: -total,
    topDeficit: top ? { label: top.label, have: top.have, need: top.need } : null,
  };
}
```

Add the imports if not already present:

```ts
import type { HoursBreakdown, Listing } from "../shared/types.ts";
import type { ApplicantProfile } from "./outreach.ts";
```

- [ ] **Step 3: Apply the penalty in `matchScore`**

Find the end of the existing scoring logic in `matchScore` (where `score` is accumulated). Add:

```ts
const { penalty, topDeficit } = perClassDeficit(listing.hoursBreakdown, profile);
score += penalty;
```

For the reason: if the existing logic picks a `reason` string from a list of candidates, add the per-class deficit as a candidate when present. Otherwise, override the reason when the per-class penalty is significant (e.g. >= -5 / a meaningful deficit):

```ts
let reason = /* existing reason logic */;
if (topDeficit && penalty <= -5) {
  reason = `Short ${topDeficit.need - topDeficit.have} ${topDeficit.label} hours of ${topDeficit.need} required`;
}
```

(Adapt to the actual `reason`-selection structure of the existing function. The intent: when there's a real deficit, that's the most actionable thing to surface.)

- [ ] **Step 4: Run the verification script**

(Use the bun -e block from the **Verify** section above.)

Expected: short < full, untracked == full (or within rounding), `OK`.

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/web/match.ts
git commit -m "feat(match): per-class deficit penalty in match score

When a listing names a per-class minimum and the applicant has the
corresponding hours, deduct up to 10 points proportional to the
deficit. Capped at -25 across all classes. Skipped when the
applicant hasn't entered the field (don't penalize for missing
data). Top deficit becomes the reason when it dominates."
```

```json:metadata
{"files":["src/web/match.ts"],"verifyCommand":"bun -e 'import { matchScore } from \"./src/web/match.ts\"; /* see plan Verify */'","acceptanceCriteria":["perClassDeficit helper added","Penalty applied in matchScore","Cap at -25","Skipped when profile undefined","Top deficit appears in reason"]}
```

---

### Task 7: Listing card chip row

**Goal:** Render a chip row below the existing hours line on each listing card, one chip per class present in `hoursBreakdown`.

**Files:**
- Modify: `src/web/App.tsx` (ListingCard component — locate by reading)

**Acceptance Criteria:**
- [ ] When `listing.hoursBreakdown` is non-null AND non-empty, the card shows chips for each class
- [ ] When null/empty, no chip row is rendered (no whitespace, no empty container)
- [ ] Chip styling matches the existing ratings-pill styling on the card
- [ ] Labels: ME / Turbine / Tailwheel / Complex / Inst. / PIC / XC (per spec)

**Verify:** Manual UI check on `bun run dev` — find a listing with per-class hours (after running the backfill), confirm the chip row renders. Find a listing without, confirm it doesn't.

**Steps:**

- [ ] **Step 1: Locate the ListingCard in App.tsx**

```bash
grep -n "function ListingCard\|<ListingCard\|hoursRequired" src/web/App.tsx | head -10
```

The card renders the title, employer, location, ratings, and hours-required line. The new chip row goes near the existing ratings pills or hours-required text.

- [ ] **Step 2: Add the chip row**

Find the spot in the JSX that renders the existing ratings (the pills showing CFI / Multi / etc.) or the `hoursRequired` line. Add this block adjacent to it (after the hours-required line is a reasonable spot):

```tsx
{listing.hoursBreakdown && Object.keys(listing.hoursBreakdown).length > 0 && (
  <div className="mt-1 flex flex-wrap gap-1.5">
    {([
      ['multiEngine', 'ME'],
      ['turbine', 'Turbine'],
      ['tailwheel', 'Tailwheel'],
      ['complex', 'Complex'],
      ['instrument', 'Inst.'],
      ['pic', 'PIC'],
      ['crossCountry', 'XC'],
    ] as const).map(([key, label]) => {
      const value = listing.hoursBreakdown![key];
      if (value == null) return null;
      return (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200"
        >
          <span className="font-semibold">{value}</span>
          <span>{label}</span>
        </span>
      );
    })}
  </div>
)}
```

Adapt the className to match the existing rating-pill styling on the card. Copy verbatim from a nearby pill in the same component.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Manual UI check**

```bash
bun run dev
```

In the browser:
- Find a listing with per-class hours (you may need to seed one for testing — use the round-trip script from Task 3 or wait for the backfill to populate)
- Confirm the chip row renders with the expected labels and values
- Find a listing without per-class hours — confirm no empty container is rendered

- [ ] **Step 5: Commit**

```bash
git add src/web/App.tsx
git commit -m "feat(web): hours-by-class chip row on listing card

Renders a wrapping chip row beneath the existing hours-required
line. One chip per class present in hoursBreakdown (ME / Turbine /
Tailwheel / Complex / Inst. / PIC / XC). Suppressed entirely when
the breakdown is null or empty."
```

```json:metadata
{"files":["src/web/App.tsx"],"verifyCommand":"bunx tsc --noEmit","acceptanceCriteria":["Chip row renders when hoursBreakdown present","Hidden when null or empty","Labels match spec","Styling matches existing pills"]}
```

---

### Task 8: End-to-end deploy verification

**Goal:** Build, push, and confirm the live site shows the new chip row and backfill counts.

**Files:** None (verification only)

**Acceptance Criteria:**
- [ ] `bun run build:static` succeeds
- [ ] Merged to master and pushed
- [ ] CI deploy succeeds
- [ ] Backfill step in CI reports a non-zero update count on first deploy

**Verify:** `gh run list --limit 1 --branch master` shows a successful run; spot-check the live site for the chip row.

**Steps:**

- [ ] **Step 1: Build locally**

```bash
bun run build:static 2>&1 | tail -10
```

Expected: clean build, "built in N.NNs", export and rss lines, exit 0.

- [ ] **Step 2: Merge to master and push**

From the main repo (NOT the worktree), fast-forward or no-ff merge the feature branch into master:

```bash
git --git-dir="C:/Users/xxsku/repos/flightpath/.git" --work-tree="C:/Users/xxsku/repos/flightpath" merge --no-ff claude/determined-wiles-e01ea7 -m "Merge hours-by-class onto master"
git --git-dir="C:/Users/xxsku/repos/flightpath/.git" --work-tree="C:/Users/xxsku/repos/flightpath" push origin master
```

- [ ] **Step 3: Watch the CI run**

```bash
sleep 30
gh run list --limit 1 --branch master
```

Expected: a successful run. If it fails, view the log:

```bash
gh run view --log-failed
```

- [ ] **Step 4: Visit the deployed site**

Open `https://mohamedserhan.github.io/flightpath/` (hard-refresh to bust cache). Find a listing that should have per-class data (any listing whose title/description mentions multi-engine, turbine, etc.). Confirm:
- The chip row renders below the hours line
- The values look right

Look at the CI workflow's "Re-extract hours-by-class on cached rows" step in the log — confirm it reported a non-zero update count.

- [ ] **Step 5: No commit needed**

If everything passed, the work is done. If you noticed any small fixes during the live check (e.g. label text needs tweaking), add a small follow-up commit and re-run the deploy.

```json:metadata
{"files":[],"verifyCommand":"gh run list --limit 1 --branch master","acceptanceCriteria":["Local build clean","Master push succeeds","CI deploy succeeds","Backfill step reports >0 updates","Live site shows chips"]}
```

---

## Self-review

- **Spec coverage:** Tasks 1-7 cover schema, types, enricher, runner wiring, API mapper, backfill + CI, applicant profile, match score, UI chips. Task 8 verifies end-to-end. All spec sections accounted for.
- **No placeholders:** Each step has concrete code, exact commands, expected output.
- **Type consistency:** `HoursBreakdown` defined in Task 1, used identically in Tasks 2, 3, 5, 6, 7. `extractHoursByClass` signature stable. ApplicantProfile fields match across Tasks 5 and 6.

## Out of scope (per spec)
- Per-class filter UI ("only show jobs whose ME minimum I meet")
- Recurrent currency (90-day landings, IPC, BFR)
- Type ratings as distinct from "turbine"
- Sim/FTD hours
