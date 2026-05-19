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
