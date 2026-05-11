import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Adzuna offers a free tier (1000 calls/month) returning aviation listings
 * via their search API. Sign up at https://developer.adzuna.com/admin/access_details
 * and set ADZUNA_APP_ID + ADZUNA_APP_KEY in the environment to enable. Without
 * those env vars, the adapter is a no-op so a fresh checkout still scrapes
 * successfully.
 */

const SEARCH_TERMS = ["flight instructor", "CFI", "pilot"];
const PAGES = [1, 2, 3];
const BASE = "https://api.adzuna.com/v1/api/jobs/us/search";

const PILOT_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

type AdzunaResult = {
  id: string | number;
  title?: string;
  location?: { display_name?: string; area?: string[] };
  company?: { display_name?: string };
  redirect_url?: string;
  description?: string;
  created?: string;
};

type AdzunaResponse = {
  count?: number;
  results?: AdzunaResult[];
};

async function fetchPage(
  term: string,
  page: number,
  appId: string,
  appKey: string,
): Promise<RawListing[]> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: term,
    max_days_old: "14",
    "content-type": "application/json",
  });
  const url = `${BASE}/${page}?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Adzuna ${term} p${page}: HTTP ${res.status}`);
  const json = (await res.json()) as AdzunaResponse;
  const results = json.results ?? [];
  return results
    .map((r): RawListing | null => {
      const title = r.title?.trim();
      const url = r.redirect_url?.trim();
      if (!title || !url) return null;
      if (!PILOT_RE.test(title)) return null;
      // Drop non-US results (Adzuna's US endpoint occasionally returns Canada).
      const area = r.location?.area ?? [];
      if (area.length > 0 && area[0] !== "US") return null;
      const parsed = r.created ? Date.parse(r.created) : NaN;
      const haveRealDate = Number.isFinite(parsed);
      return {
        externalId: `adzuna-${r.id}`,
        title,
        url,
        description: r.description?.trim() || null,
        employer: r.company?.display_name?.trim() || null,
        location: r.location?.display_name?.trim() || null,
        postedAt: haveRealDate ? parsed : Date.now(),
        postedAtAccurate: haveRealDate,
      };
    })
    .filter((x): x is RawListing => x !== null);
}

export const adzunaAdapter: SourceAdapter = {
  id: "adzuna",
  name: "Adzuna (Aggregator)",
  async fetch(): Promise<RawListing[]> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      console.log("[adzuna] skipped (set ADZUNA_APP_ID and ADZUNA_APP_KEY to enable)");
      return [];
    }
    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (const term of SEARCH_TERMS) {
      for (const page of PAGES) {
        try {
          const items = await fetchPage(term, page, appId, appKey);
          for (const item of items) {
            if (seen.has(item.externalId)) continue;
            seen.add(item.externalId);
            out.push(item);
          }
        } catch (err) {
          console.warn(
            `[adzuna] "${term}" p${page} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
    return out;
  },
};
