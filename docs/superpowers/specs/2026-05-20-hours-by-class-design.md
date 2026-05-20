# Hours-by-class extraction (sub-project B)

Date: 2026-05-20
Status: Approved, ready for implementation plan
Sub-project B of the "Ahmad feedback" batch (item 3 of 7)

## Context

The user's brother (Ahmad, the primary user) asked on 2026-05-12:

> Need to find a way to differentiate between hours (Single Engine, Multi Engine, Turbo, etc...)

Today the listings DB has a single `hours_required` integer column, populated by `extractHoursRequired()` in `src/scrapers/enrich.ts`. That extractor finds the smallest "N hours / N TT / N hrs" number anywhere in the listing text and assumes it's the total-time minimum. That works for headline cuts ("CFI, 250 hours required") but throws away all the per-class context that real listings include ("CFI, 250 hours, with 50 multi-engine and 10 turbine PIC preferred").

This sub-project pulls out the per-class minimums into a structured JSON column so the listing card can render them as chips and a future scoring change can use them.

Sub-project A (lowtimepilot + non-CFI categories) shipped at master `05b0f37`. This is independent of A; it touches the enricher, schema, applicant profile, match score, and listing card.

## Goals

1. Recognize per-class hour minimums in listing text: multi-engine, turbine, tailwheel, complex, instrument, PIC, cross-country.
2. Persist the structured breakdown alongside the existing total-time field.
3. Display the breakdown on the listing card so the user can immediately see what each posting needs.
4. Extend the applicant profile with the same fields so the data flows end-to-end (used in match scoring now; in future, in a deficit-aware filter).
5. Refine the match score so a listing requiring 50 ME doesn't look like an A-grade fit for a 5-ME applicant.

## Non-goals

- A per-class filter UI ("only show jobs whose ME minimum I meet"). The chip row IS the surface for v1; filtering adds clutter that the user hasn't asked for.
- Recurrent currency tracking (90-day landings, IPC, BFR). Not part of "hours by class."
- Type ratings as distinct from "turbine" generally. ATP, A320, B737 etc. would be a separate enrichment pass.
- Sim hours, simulator time, FTD credit. The applicant tracks logged airframe time; sim time is a confound.

## Architecture

### 1. Schema

Add one new nullable text column to `listings`:

```ts
hoursBreakdown: text("hours_breakdown"),  // JSON, nullable
```

Stores `HoursBreakdown` as a JSON string. Null when nothing matched. The existing `hours_required` integer column for total time stays unchanged — they answer different questions and shouldn't be unified.

Migration: add to `src/db/schema.ts` and let drizzle-kit pick it up on next `bun run db:migrate`. Sqlite's `ALTER TABLE ... ADD COLUMN` is non-destructive.

### 2. Type

In `src/shared/types.ts`:

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

All optional. Empty object and `null` both mean "nothing extracted." The adapter/enrich layer should write `null` (not `{}`) when there are no matches.

The `Listing` row type gains:

```ts
hoursBreakdown: HoursBreakdown | null;
```

### 3. Enrichment

New function in `src/scrapers/enrich.ts`:

```ts
export function extractHoursByClass(text: string | null | undefined): HoursBreakdown | null;
```

Patterns (case-insensitive, each captures `(\d{2,5})` and looks for the class noun within a short window after the number):

| Class | Regex token after the number |
|---|---|
| `multiEngine` | `(?:hours?\s+(?:of\s+)?)?(?:multi[-\s]?engine|\bME\b|\bAMEL\b)` |
| `turbine` | `(?:hours?\s+(?:of\s+)?)?(?:turbine|turboprop|\bjet\b)` |
| `tailwheel` | `(?:hours?\s+(?:of\s+)?)?tail[-\s]?wheel` |
| `complex` | `(?:hours?\s+(?:of\s+)?)?complex` |
| `instrument` | `(?:hours?\s+(?:of\s+)?)?(?:instrument|\bIFR\b|\bIMC\b|\bactual\b)` |
| `pic` | `(?:hours?\s+(?:of\s+)?)?\bPIC\b` |
| `crossCountry` | `(?:hours?\s+(?:of\s+)?)?(?:cross[-\s]?country|\bx[-\s]?country\b|\bXC\b)` |

For each class, find ALL matches in the text, drop any outside a sane range (10..15000), and keep the **minimum** as the recorded requirement (listings often say "minimum 50 multi" — 50 is what we want).

Return `null` if no class matched. Otherwise return an object containing only the keys that did match.

Wire into `enrichListing`:

```ts
const fullText = `${raw.title}\n${raw.description ?? ""}`;
return {
  ...raw,
  // ... existing fields
  hoursBreakdown: extractHoursByClass(fullText),
};
```

`EnrichedListing` in `src/scrapers/types.ts` gets the new field.

### 4. Adapter wiring

The standard runner at `src/scrapers/run.ts` inserts listings into the DB on the upsert path. Add the new field to its insert + onConflictDoUpdate mapping:

```ts
hoursBreakdown: enriched.hoursBreakdown ? JSON.stringify(enriched.hoursBreakdown) : null,
```

The browser runner at `src/scrapers/browser/runner.ts` has the same insert pattern (currently a stub with no registered adapters, but updated for parity so a future browser adapter automatically benefits).

The API row-to-Listing mapper in `src/server/routes/listings.ts` deserializes it back (mirror of the existing `ratingsRequired` JSON dance — same try/catch wrap, same `Array.isArray` style check adapted to "is object").

### 5. Backfill

New one-shot script `scripts/reextract-hours-breakdown.ts` modeled on `scripts/reclassify-categories.ts`. Walks every row in `listings`, runs `extractHoursByClass(title + description)`, and writes the JSON to `hours_breakdown` when the new value differs from what's stored. Safe to run repeatedly; idempotent.

Add this script to the CI deploy workflow (`.github/workflows/scrape-and-deploy.yml`) right after the existing "Reclassify categories on cached rows" step. Same rationale: when enrichment logic changes, every cached row gets the new logic on next deploy without waiting for the row to re-surface from its source.

### 6. Listing card UI

Below the existing "Posted N days ago" line, add a chip row when `hoursBreakdown` is non-null:

```
250 TT required  •  [50 ME]  [25 turbine]  [10 tailwheel]
```

Each per-class chip is a small inline pill: label = class name (short form), value = hours. Render only the classes with values. Suppress the row entirely if `hoursBreakdown` is null or empty.

Label map:
- `multiEngine` → `ME`
- `turbine` → `Turbine`
- `tailwheel` → `Tailwheel`
- `complex` → `Complex`
- `instrument` → `Inst.`
- `pic` → `PIC`
- `crossCountry` → `XC`

Styling: reuse the existing ratings-pill class strings in `App.tsx` (matches the visual language of the rating chips already on the card).

### 7. Applicant profile

Extend `ApplicantProfile` in `src/web/outreach.ts`:

```ts
multiEngineHours?: number;
turbineHours?: number;
tailwheelHours?: number;
complexHours?: number;
instrumentHours?: number;
picHours?: number;
crossCountryHours?: number;
```

In the profile modal (`ProfileModal` component in App.tsx), add a collapsed-by-default section labeled "Hours by class" with seven optional number inputs. Values persist via the existing `writeApplicantProfile` flow.

### 8. Match score

In `src/web/match.ts`, when a listing has a non-null `hoursBreakdown` and the applicant has the corresponding profile value, compare each class. For any class where applicant < listing minimum, deduct up to 10 points proportional to the deficit:

```ts
const deficit = Math.max(0, (required ?? 0) - (have ?? 0));
const ratio = required > 0 ? Math.min(1, deficit / required) : 0;
const penalty = Math.round(ratio * 10);
```

Cap total per-class penalty at -25 across all classes so the existing baseline doesn't collapse. If the applicant hasn't filled in their per-class hours (the profile values are undefined), skip the comparison — don't penalize for missing data the user hasn't entered.

Surface the top deficit in the match `reason` string when it's the dominant factor: "Short 30 ME hours of 50 required" beats the existing generic message.

### Out of scope (already listed in Non-goals)

- Filter UI for per-class
- Recurrent currency
- Type ratings
- Sim/FTD hours

## Data flow

```
Listing text (title + description)
  ↓ extractHoursByClass
  HoursBreakdown | null  ← stored in DB as JSON in hours_breakdown column
  ↓ API response
  Listing.hoursBreakdown (typed object)
  ↓ rendering
  ListingCard chip row

ApplicantProfile (localStorage)
  ↓ matchScore
  per-class deficit penalty up to -25
  ↓
  score, tier, reason
```

## Verification

- `bunx tsc --noEmit` clean.
- Ad-hoc `bun -e` test feeding ~10 known snippets through `extractHoursByClass` and asserting the expected shape:
  - "50 hours multi-engine required" → `{ multiEngine: 50 }`
  - "300 turbine PIC, 100 ME" → `{ turbine: 300, pic: 300, multiEngine: 100 }`
  - "Must have 25 tailwheel and 10 complex" → `{ tailwheel: 25, complex: 10 }`
  - "Generic pilot job" → `null`
  - Range check: "50,000 hours" or "5 hours" → ignored
- Backfill script runs idempotently — second invocation reports 0 changes.
- Listing card renders the chip row when data is present, doesn't render when absent.
- Match score for a low-ME applicant on a high-ME listing is lower than the same applicant on a no-ME-requirement listing.
- Build + deploy succeeds; eyeball the live site on a listing card known to have per-class minimums.

## Open questions resolved during implementation

- **What threshold should suppress the chip row?** If `hoursBreakdown` is `{}` (empty), suppress. If it has 1+ keys, show.
- **What if the same number is matched by multiple class regexes (e.g., "300 turbine PIC" matches both)?** That's correct behavior — the number really is the minimum for both turbine AND PIC in that listing. Keep both.
- **Should `pic` and `instrument` overlap with the existing total-time?** No — total time is in `hours_required`, this column is per-class. A listing that says "250 hours total time, 50 multi" gets `hours_required = 250, hoursBreakdown = { multiEngine: 50 }`.

## Risk notes

- Some FAA-flavored listings use Roman numerals or unusual abbreviations ("Class B turbine" referring to ATP requirements, not hours). The 10..15000 range filter helps but won't catch every false positive. Acceptable for v1; the chip row's truth-in-display lets the user reality-check.
- `\bPIC\b` matches inside "PIC qualification" or "PIC time required" phrasing. The "N before the token" anchor makes this rare in practice — most listings phrase it as "100 PIC" or "100 hours PIC."
- The backfill script writes JSON into a TEXT column; sqlite has no validation. Trust the type at write time and parse defensively at read time.
