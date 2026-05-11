import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * USAJobs requires registering for a free Authorization-Key at
 * https://developer.usajobs.gov/apirequest/. Set USAJOBS_AUTH_KEY and
 * USAJOBS_USER_AGENT (your email, per their docs) in the environment
 * to enable this source. Without those env vars, the adapter is a no-op
 * so a fresh checkout still scrapes successfully.
 */

const SEARCH_TERMS = ["flight instructor", "pilot instructor", "aviation instructor", "pilot"];
const BASE = "https://data.usajobs.gov/api/Search";

type UsaJobItem = {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionTitle: string;
    PositionURI: string;
    PositionLocationDisplay?: string;
    PositionLocation?: Array<{ LocationName?: string; CountryCode?: string }>;
    OrganizationName?: string;
    DepartmentName?: string;
    PublicationStartDate?: string;
    UserArea?: { Details?: { JobSummary?: string } };
  };
};

type UsaJobResponse = {
  SearchResult?: {
    SearchResultItems?: UsaJobItem[];
  };
};

async function fetchTerm(term: string, authKey: string, ua: string): Promise<RawListing[]> {
  const url = `${BASE}?Keyword=${encodeURIComponent(term)}&ResultsPerPage=50`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": ua,
      Host: "data.usajobs.gov",
      "Authorization-Key": authKey,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`USAJobs ${term}: HTTP ${res.status}`);
  const json = (await res.json()) as UsaJobResponse;
  const items = json.SearchResult?.SearchResultItems ?? [];
  return items
    .map((it): RawListing | null => {
      const d = it.MatchedObjectDescriptor;
      const title = d.PositionTitle?.trim();
      const url = d.PositionURI?.trim();
      if (!title || !url) return null;
      const usOnly = (d.PositionLocation ?? []).some(
        (l) => (l.CountryCode ?? "").toUpperCase() === "US",
      );
      if (d.PositionLocation && d.PositionLocation.length > 0 && !usOnly) return null;
      const location =
        d.PositionLocationDisplay?.trim() ||
        d.PositionLocation?.[0]?.LocationName?.trim() ||
        null;
      const parsed = d.PublicationStartDate ? Date.parse(d.PublicationStartDate) : NaN;
      const haveRealDate = Number.isFinite(parsed);
      return {
        externalId: `usajobs-${it.MatchedObjectId}`,
        title,
        url,
        description: d.UserArea?.Details?.JobSummary?.trim() || null,
        employer: d.OrganizationName?.trim() || d.DepartmentName?.trim() || null,
        location,
        postedAt: haveRealDate ? parsed : Date.now(),
        postedAtAccurate: haveRealDate,
      };
    })
    .filter((x): x is RawListing => x !== null);
}

export const usaJobsAdapter: SourceAdapter = {
  id: "usajobs",
  name: "USAJobs (Federal)",
  async fetch(): Promise<RawListing[]> {
    const authKey = process.env.USAJOBS_AUTH_KEY;
    const ua = process.env.USAJOBS_USER_AGENT;
    if (!authKey || !ua) {
      console.log("[usajobs] skipped (set USAJOBS_AUTH_KEY and USAJOBS_USER_AGENT to enable)");
      return [];
    }
    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (const term of SEARCH_TERMS) {
      try {
        const items = await fetchTerm(term, authKey, ua);
        for (const item of items) {
          if (seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          out.push(item);
        }
      } catch (err) {
        console.warn(`[usajobs] "${term}" failed:`, err instanceof Error ? err.message : err);
      }
    }
    return out;
  },
};
