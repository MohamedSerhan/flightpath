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

/** Probeable companies — the type narrows after `time_building` is filtered
 *  out, so `category` here is always a public JobCategory. Keep this type
 *  local to the adapter; the seed file's looser type stays in
 *  bootstrap-lowtimepilot.ts. */
type ProbeableCompany = Omit<LowtimepilotCompany, "category"> & { category: JobCategory };

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
