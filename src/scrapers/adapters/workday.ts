import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Workday CXS adapter.
 *
 * The CXS (Candidate Experience) API is the public JSON endpoint behind
 * every Workday-hosted careers site. Pattern:
 *
 *   POST https://<tenant>.<region>.myworkdayjobs.com/wday/cxs/<tenant>/<board>/jobs
 *   { "appliedFacets": {}, "limit": 50, "offset": 0, "searchText": "<term>" }
 *
 * Returns { total, jobPostings[{ title, externalPath, locationsText, postedOn }] }.
 *
 * Tenant + board names aren't guessable — they're tenant-specific Workday
 * configuration. Each entry below was verified live on 2026-05-07; see
 * research/04-ats-map.md for the discovery method.
 *
 * Adding a new tenant: visit their careers page (something like
 * <name>.wd1.myworkdayjobs.com/<board>) and copy the path segment after
 * the tenant subdomain. Try the POST with a couple of search terms; if
 * it returns 200 + jobPostings, you're done.
 */

export type WorkdaySource = {
  tenant: string;
  region: string; // wd1, wd3, wd5, wd103, etc.
  board: string;
  name: string;
  /**
   * Server-side searchText filters. Empty string = "all jobs". We pass each
   * term in turn and dedupe by externalPath. Helps catch postings that
   * mention "instructor" but not "flight instructor", and vice versa.
   */
  searchTerms?: string[];
};

const WORKDAY_SOURCES: WorkdaySource[] = [
  {
    tenant: "embryriddle",
    region: "wd1",
    board: "External",
    name: "Embry-Riddle Aeronautical University",
    searchTerms: ["flight instructor", "aeronautical", "pilot"],
  },
  {
    tenant: "cae",
    region: "wd3",
    board: "career",
    name: "CAE",
    searchTerms: ["flight instructor", "simulator instructor", "pilot", "instructor pilot"],
  },
  {
    tenant: "bristow",
    region: "wd1",
    board: "Careers",
    name: "Bristow Group",
    searchTerms: ["instructor", "pilot", "first officer", "captain"],
  },
  {
    tenant: "boeing",
    region: "wd1",
    board: "External_Careers",
    name: "Boeing",
    searchTerms: ["flight instructor", "test pilot", "instructor pilot"],
  },
];

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|check\s+airman|line\s+check|instructor\s+pilot|test\s+pilot|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b|aeronautical\s+science\b|aviation\s+(faculty|instructor))\b/i;

const UA = "Mozilla/5.0 (Flightpath/0.1)";

type WorkdayJob = {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
};

type WorkdayResp = {
  total: number;
  jobPostings: WorkdayJob[];
};

function parsePostedOn(s: string | undefined): number {
  if (!s) return Date.now();
  const lower = s.toLowerCase().trim();
  if (lower === "posted today") return Date.now();
  if (lower === "posted yesterday") return Date.now() - 86400_000;
  const match = lower.match(/posted\s+(\d+)\+?\s+(day|week|month)s?\s+ago/);
  if (match) {
    const [, n, unit] = match;
    const num = Number(n);
    const ms =
      unit === "day"
        ? 86400_000
        : unit === "week"
          ? 7 * 86400_000
          : 30 * 86400_000;
    return Date.now() - num * ms;
  }
  return Date.now();
}

// Workday CXS rejects limit > 20 on most tenants (HTTP 400). Paginate.
const PAGE_SIZE = 20;
const MAX_PAGES_PER_TERM = 5;

async function fetchPage(
  src: WorkdaySource,
  term: string,
  offset: number,
): Promise<WorkdayResp> {
  const apiUrl = `https://${src.tenant}.${src.region}.myworkdayjobs.com/wday/cxs/${src.tenant}/${src.board}/jobs`;
  const boardUrl = `https://${src.tenant}.${src.region}.myworkdayjobs.com/${src.board}`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      Referer: boardUrl,
    },
    body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: term }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as WorkdayResp;
}

async function fetchSearch(src: WorkdaySource, term: string): Promise<RawListing[]> {
  const boardUrl = `https://${src.tenant}.${src.region}.myworkdayjobs.com/${src.board}`;
  const out: RawListing[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
    const data = await fetchPage(src, term, offset);
    const posts = data.jobPostings ?? [];
    for (const j of posts) {
      if (!j.title || !j.externalPath) continue;
      if (!PILOT_TITLE_RE.test(j.title)) continue;
      const id = j.bulletFields?.[0] ?? j.externalPath.split("/").pop() ?? j.title;
      out.push({
        externalId: `workday-${src.tenant}-${id}`,
        title: j.title.trim(),
        url: `${boardUrl}${j.externalPath}`,
        description: null,
        employer: src.name,
        location: j.locationsText?.trim() || null,
        postedAt: parsePostedOn(j.postedOn),
      });
    }
    if (posts.length < PAGE_SIZE) break;
    if (offset + PAGE_SIZE >= (data.total ?? 0)) break;
    offset += PAGE_SIZE;
  }
  return out;
}

export const workdayAdapter: SourceAdapter = {
  id: "workday",
  name: "Workday CXS (Embry-Riddle, CAE, Bristow, Boeing)",
  async fetch(): Promise<RawListing[]> {
    const out: RawListing[] = [];
    const seen = new Set<string>();
    let ok = 0;
    let fail = 0;

    for (const src of WORKDAY_SOURCES) {
      const terms = src.searchTerms?.length ? src.searchTerms : [""];
      let added = 0;
      for (const term of terms) {
        try {
          const items = await fetchSearch(src, term);
          for (const item of items) {
            if (seen.has(item.externalId)) continue;
            seen.add(item.externalId);
            out.push(item);
            added++;
          }
          ok++;
        } catch (err) {
          fail++;
          console.warn(
            `[workday:${src.tenant}/${src.board}] "${term}" failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (added > 0) {
        console.log(`[workday:${src.tenant}] +${added} pilot/CFI roles`);
      }
    }
    console.log(`[workday] ok=${ok} fail=${fail} total_listings=${out.length}`);
    return out;
  },
};
