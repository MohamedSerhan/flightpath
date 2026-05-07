import type { RawListing, SourceAdapter } from "../types.ts";

const SEARCH_TERMS = ["flight instructor", "pilot instructor", "aviation instructor"];
const BASE = "https://data.usajobs.gov/api/Search";

const UA = "Flightpath/0.1 (https://github.com/flightpath; aggregator of public CFI listings)";

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

async function fetchTerm(term: string): Promise<RawListing[]> {
  const url = `${BASE}?Keyword=${encodeURIComponent(term)}&ResultsPerPage=50`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Host": "data.usajobs.gov",
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
      const usOnly = (d.PositionLocation ?? []).some((l) => (l.CountryCode ?? "").toUpperCase() === "US");
      if (d.PositionLocation && d.PositionLocation.length > 0 && !usOnly) return null;
      const location =
        d.PositionLocationDisplay?.trim() ||
        d.PositionLocation?.[0]?.LocationName?.trim() ||
        null;
      const postedAt = d.PublicationStartDate ? Date.parse(d.PublicationStartDate) : Date.now();
      return {
        externalId: `usajobs-${it.MatchedObjectId}`,
        title,
        url,
        description: d.UserArea?.Details?.JobSummary?.trim() || null,
        employer: d.OrganizationName?.trim() || d.DepartmentName?.trim() || null,
        location,
        postedAt: Number.isFinite(postedAt) ? postedAt : Date.now(),
      };
    })
    .filter((x): x is RawListing => x !== null);
}

export const usaJobsAdapter: SourceAdapter = {
  id: "usajobs",
  name: "USAJobs (Federal)",
  async fetch(): Promise<RawListing[]> {
    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (const term of SEARCH_TERMS) {
      try {
        const items = await fetchTerm(term);
        for (const item of items) {
          if (seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          out.push(item);
        }
      } catch (err) {
        console.warn(`[usajobs] term "${term}" failed:`, err instanceof Error ? err.message : err);
      }
    }
    return out;
  },
};
