import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Million Air — national FBO chain (100+ locations) hiring through the
 * Talent Plus / ApplicantPro careers platform at
 * https://millionair.talentplushire.com/jobs/.
 *
 * The public listings page is a Vue SPA, but its `JobListings`
 * component fetches a clean JSON document from
 *   GET /core/jobs/<domainId>?getParams=<url-encoded-json>
 * which returns { data: { jobs: [...], jobCount: N } }.
 *
 * domainId 416 is Million Air's public career site (organizationId 330,
 * subdomain `millionair`). Most of the 50+ open roles are line-service
 * /customer-service /A&P, so we apply the standard pilot filter at the
 * title level — typically only a handful of PIC/SIC roles flow through
 * (e.g. American Jet International contract pilots based at Million Air
 * FBOs). Verified live 2026-05-07.
 */
const API_URL = "https://millionair.talentplushire.com/core/jobs/416";
const BASE = "https://millionair.talentplushire.com";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type MillionAirJob = {
  id: number;
  title?: string;
  jobUrl?: string;
  jobLocation?: string;
  city?: string;
  abbreviation?: string;
  stateName?: string;
  orgTitle?: string;
  parentTitle?: string | null;
  startDateRef?: string;
  employmentType?: string;
  classification?: string;
  payDetails?: string;
};

function decode(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLocation(j: MillionAirJob): string | null {
  if (j.jobLocation) return decode(j.jobLocation);
  const parts = [j.city, j.abbreviation].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function parseDate(s: string | undefined): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}

export const millionairAdapter: SourceAdapter = {
  id: "millionair",
  name: "Million Air (FBO)",
  async fetch(): Promise<RawListing[]> {
    // The endpoint requires a `getParams` query param (a JSON-encoded
    // filter object) — empty {} returns all jobs across all locations.
    const url = `${API_URL}?getParams=${encodeURIComponent("{}")}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { jobs?: MillionAirJob[] };
      };
      const jobs = json.data?.jobs ?? [];
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const j of jobs) {
        const title = decode(j.title);
        if (!title || !PILOT_TITLE_RE.test(title)) continue;
        const externalId = `millionair-${j.id}`;
        if (seen.has(externalId)) continue;
        seen.add(externalId);
        const employer =
          decode(j.orgTitle ?? "") || "Million Air";
        out.push({
          externalId,
          title,
          url: j.jobUrl || `${BASE}/jobs/${j.id}`,
          description: j.employmentType
            ? `Type: ${decode(j.employmentType)}`
            : null,
          employer,
          location: buildLocation(j),
          postedAt: parseDate(j.startDateRef),
        });
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  },
};
