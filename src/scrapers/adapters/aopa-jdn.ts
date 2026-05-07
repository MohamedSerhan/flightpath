import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * AOPA Job Network — served by JSfirm under their integration API.
 *
 * AOPA's careers page (aopa.org/about/hr/aviation-job-postings) embeds
 * the JSfirm integration feed. The endpoint is unauthenticated:
 *
 *   POST https://www.jsfirm.com/integration/api/feed/getfeedadvanced/AOPA-JDN-2018/
 *
 * Returns up to 20 of AOPA's "super-enhanced" listings — high-quality
 * pilot, maintenance, management, and instructor roles with full
 * descriptions and a real post date (`job_search_date`).
 *
 * Filtering happens client-side: we keep titles that match the pilot
 * regex, drop maintenance/avionics/dispatch (those have their own user
 * personas).
 */

const URL = "https://www.jsfirm.com/integration/api/feed/getfeedadvanced/AOPA-JDN-2018/";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

const PILOT_POSITION_RE = /\b(pilot|first\s*officer|captain|crew|instructor)\b/i;

type AopaJob = {
  JobID?: string;
  JobTitle?: string;
  JobType?: string;
  Position?: string;
  Country?: string;
  State?: string;
  NearestCity?: string;
  job_search_date?: string;
  Description?: string;
  job_url?: string;
  CoName?: string;
};

type AopaResp = { Listing?: AopaJob[] };

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

function buildLocation(j: AopaJob): string | null {
  const stateAbbr = j.State ? STATE_NAMES[j.State.toLowerCase().trim()] ?? j.State : null;
  if (j.NearestCity && stateAbbr) return `${j.NearestCity}, ${stateAbbr}`;
  if (j.NearestCity) return j.NearestCity;
  if (stateAbbr) return stateAbbr;
  return null;
}

function isUS(j: AopaJob): boolean {
  const c = (j.Country ?? "").toUpperCase();
  return c === "USA" || c === "US" || c === "UNITED STATES" || c === "";
}

function parseDate(s: string | undefined): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  // "5/5/2026 7:30:52 PM" style
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    const t2 = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`).getTime();
    return Number.isFinite(t2) ? t2 : Date.now();
  }
  return Date.now();
}

export const aopaJdnAdapter: SourceAdapter = {
  id: "aopa-jdn",
  name: "AOPA Job Network",
  async fetch(): Promise<RawListing[]> {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AopaResp;
    const items = data.Listing ?? [];
    return items
      .filter((j): j is AopaJob & { JobID: string; JobTitle: string; job_url: string } => {
        return !!j.JobID && !!j.JobTitle && !!j.job_url && isUS(j);
      })
      .filter(
        (j) =>
          PILOT_TITLE_RE.test(j.JobTitle) ||
          (j.Position ? PILOT_POSITION_RE.test(j.Position) : false),
      )
      .map((j): RawListing => ({
        externalId: `aopa-jdn-${j.JobID}`,
        title: j.JobTitle.trim(),
        url: j.job_url,
        description: j.Description?.trim() ?? null,
        employer: j.CoName?.trim() ?? null,
        location: buildLocation(j),
        postedAt: parseDate(j.job_search_date),
      }));
  },
};
