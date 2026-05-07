import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Pilot Career Centre (pilotcareercenter.com).
 *
 * The XCC bundle ships a $.ajax call to:
 *   POST /Jobs/JobSearch
 *   { regions, categories, positions, types, offset, userRegion }
 *   → { m_Item1: <total>, m_Item2: [{ JobId, Company, Position,
 *       AircraftType, Region, JobUrl, ... }] }
 *
 * AircraftType doubles as the location — the typical value is
 * "Challenger 605/650 - Bedford MA" with the city/state at the end.
 * JobUrl points to the *employer's* canonical careers page, so the
 * sibling lands directly on the original posting (no PCC paywall).
 *
 * PCC's database aggregates from icims, jobvite, Breeze, custom
 * employer sites — meaningful overlap with our other adapters is
 * expected and handled by the source/external_id dedup at insert time.
 *
 * Verified live 2026-05-07: 779 USA pilot listings.
 */

const API_URL = "https://pilotcareercenter.com/Jobs/JobSearch";
const MAX_PAGES = 60; // ~18 jobs/page × 60 = 1080 capacity, ample headroom
const USER_REGIONS: Array<{ id: number; label: string }> = [{ id: 1, label: "USA" }];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

type PccJob = {
  JobId: number;
  Position?: string | null;
  AircraftType?: string | null;
  Company?: string | null;
  Region?: string | null;
  JobUrl?: string | null;
  PremiumListing?: boolean;
};

type PccResp = {
  m_Item1?: number;
  m_Item2?: PccJob[];
};

const STATE_ABBR_RE = /\b([A-Z]{2})\b\s*$/;

function extractLocation(aircraftType: string | null | undefined): string | null {
  if (!aircraftType) return null;
  // Format: "Citation XLS+ Gen2 - Minneapolis MN"
  const segments = aircraftType.split(" - ").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;
  const last = segments[segments.length - 1];
  return STATE_ABBR_RE.test(last) ? last : null;
}

function buildTitle(j: PccJob): string {
  const position = j.Position?.trim() || "Pilot";
  // Strip the "<aircraft> - <city ST>" suffix and use just the aircraft type.
  const aircraft = (j.AircraftType ?? "").split(" - ")[0]?.trim();
  if (aircraft) return `${position} — ${aircraft}`;
  return position;
}

const PAGE_TIMEOUT_MS = 25_000;

async function fetchPage(offset: number, userRegion: number): Promise<PccResp> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        "User-Agent": UA,
        Referer: "https://pilotcareercenter.com/USA",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        regions: [],
        categories: [],
        positions: [],
        types: [],
        offset,
        userRegion,
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PccResp;
  } finally {
    clearTimeout(timer);
  }
}

export const pccAdapter: SourceAdapter = {
  id: "pcc",
  name: "Pilot Career Centre",
  async fetch(): Promise<RawListing[]> {
    const out: RawListing[] = [];
    const seen = new Set<number>();

    // Pagination resilience: if a single page errors (timeout, 5xx) we keep
    // the listings we already got and stop pagination cleanly. Without this,
    // one bad request mid-run loses the whole scrape.
    for (const region of USER_REGIONS) {
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        let resp: PccResp;
        try {
          resp = await fetchPage(offset, region.id);
        } catch (err) {
          console.warn(
            `[pcc] page offset=${offset} failed (${err instanceof Error ? err.message : err}); keeping ${out.length} listings collected so far`,
          );
          break;
        }
        const items = resp.m_Item2 ?? [];
        if (items.length === 0) break;
        for (const j of items) {
          if (!j.JobId || !j.JobUrl) continue;
          if (seen.has(j.JobId)) continue;
          seen.add(j.JobId);
          const title = buildTitle(j);
          if (!PILOT_TITLE_RE.test(title) && !PILOT_TITLE_RE.test(j.Position ?? "")) continue;
          out.push({
            externalId: `pcc-${j.JobId}`,
            title,
            url: j.JobUrl,
            description: null,
            employer: j.Company?.trim() || null,
            location: extractLocation(j.AircraftType),
            postedAt: Date.now(),
          });
        }
        const total = resp.m_Item1 ?? 0;
        offset += items.length;
        if (offset >= total) break;
      }
    }
    return out;
  },
};
