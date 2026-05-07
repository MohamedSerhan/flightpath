import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * SkyWest Airlines via the JIBE talent platform.
 *
 * The public JS bundle on jobs.skywest.com pulls listings from
 *   GET https://jobs.skywest.com/api/jobs
 * which returns { jobs: [{ data: { slug, title, description, city,
 * state, post_date, ... } }] }. Pagination by `from` is supported
 * but the API caps at the 10 most-recent jobs across the whole site
 * regardless of `q`/`from`/`size` — so we just take what's there
 * and filter to flight-instruction roles. Verified live 2026-05-07.
 */

const API_URL = "https://jobs.skywest.com/api/jobs";
const BASE = "https://jobs.skywest.com";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|training\s+coordinator)\b/i;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type SkyWestJob = {
  data?: {
    slug?: string;
    req_id?: string;
    title?: string;
    description?: string;
    city?: string;
    state?: string;
    location?: string;
    post_date?: string;
    posting_date?: string;
    job_url?: string;
  };
};

function stripHtml(s: string | undefined | null): string | null {
  if (!s) return null;
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function buildLocation(d: NonNullable<SkyWestJob["data"]>): string | null {
  if (d.location) return d.location.trim();
  const parts = [d.city, d.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function parseDate(s: string | undefined | null): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}

export const skywestAdapter: SourceAdapter = {
  id: "skywest",
  name: "SkyWest Airlines",
  async fetch(): Promise<RawListing[]> {
    const res = await fetch(API_URL, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { jobs?: SkyWestJob[] };
    const jobs = json.jobs ?? [];
    return jobs
      .map((j) => j.data)
      .filter((d): d is NonNullable<SkyWestJob["data"]> => !!d && !!d.title)
      .filter((d) => PILOT_TITLE_RE.test(d.title!))
      .map((d): RawListing => {
        const id = d.req_id ?? d.slug ?? d.title!;
        const url = d.job_url ?? `${BASE}/jobs/${d.slug ?? id}`;
        return {
          externalId: `skywest-${id}`,
          title: d.title!.trim(),
          url,
          description: stripHtml(d.description)?.slice(0, 4000) ?? null,
          employer: "SkyWest Airlines",
          location: buildLocation(d),
          postedAt: parseDate(d.post_date ?? d.posting_date),
        };
      });
  },
};
