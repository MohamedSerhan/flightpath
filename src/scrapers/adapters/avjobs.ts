import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * AvJobs.com — long-running aviation job board (since 1988). The pilot
 * category page (`/jobs/positions.asp?cat=Pilot`) is server-rendered with
 * predictable .positions-list-item markup; each link's href encodes the
 * employer, job title, and city/state directly as query parameters, so
 * we don't need a per-job fetch to populate the listing card.
 *
 * Listings rotate frequently — Flex Air, Boeing, regional carriers, EMS
 * operators, ag pilots — and the dataset overlaps modestly with PCC and
 * JSfirm, but it picks up a long tail (Flex Air CFI roles in particular)
 * the other adapters don't always carry.
 */

const INDEX_URL = "https://www.avjobs.com/jobs/positions.asp?cat=Pilot";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certificated\s+flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

// <a data-tn-element="jobTitle" href="...?Company=<co>&g=<guid>&t=<title>&l=<city+st>" title="...">
const LINK_RE =
  /<a\s+data-tn-element="jobTitle"\s+href="([^"]+)"\s+title="([^"]+)">/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseQuery(url: string): URLSearchParams | null {
  try {
    const u = new URL(decodeEntities(url));
    return u.searchParams;
  } catch {
    return null;
  }
}

/** Decode AvJobs' "City+ST" location format into "City, ST". */
function parseLocation(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  const m = trimmed.match(/^(.+?)\s+([A-Z]{2})$/);
  if (m) return `${m[1].trim()}, ${m[2]}`;
  return trimmed || null;
}

function decodeT(t: string | null): string | null {
  if (!t) return null;
  return decodeURIComponent(t.replace(/\+/g, " ")).trim();
}

export const avJobsAdapter: SourceAdapter = {
  id: "avjobs",
  name: "AvJobs.com",
  async fetch(): Promise<RawListing[]> {
    const res = await fetch(INDEX_URL, {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const seen = new Set<string>();
    const out: RawListing[] = [];
    LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LINK_RE.exec(html)) !== null) {
      const [, rawHref, rawTitle] = match;
      const params = parseQuery(rawHref);
      const company = decodeT(params?.get("Company") ?? null);
      const title = decodeT(params?.get("t") ?? null) ?? decodeEntities(rawTitle);
      const location = parseLocation(params?.get("l") ?? null);
      const guid = params?.get("g") ?? null;
      if (!title || !guid) continue;
      if (!PILOT_TITLE_RE.test(title)) continue;
      if (seen.has(guid)) continue;
      seen.add(guid);

      out.push({
        externalId: `avjobs-${guid}`,
        title,
        url: decodeEntities(rawHref),
        description: null,
        employer: company,
        location,
        postedAt: Date.now(), // AvJobs doesn't expose post date on the index — corrected by detail-enrichment if available.
      });
    }
    return out;
  },
};
