import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * FindAPilot.com — pilot-job board with clean microdata markup
 * (schema.org JobPosting). Each index page lists 25 jobs with title,
 * employer, post date, aircraft type, and individual /job/<id>-<slug>
 * URLs. We paginate up to MAX_PAGES.
 *
 * Verified live 2026-05-07: 25 listings on page 1 with at least 6+
 * pages visible. Many are corporate/captain roles, so pilotOnly is
 * applied at title level to keep the output relevant.
 */

const BASE = "https://www.findapilot.com";
const PAGE_URL = (n: number) => `${BASE}/jobs?page=${n}`;
const MAX_PAGES = 12;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

// Each card in the index looks like:
//   <h2><a itemprop="url" href="https://www.findapilot.com/job/175925-..."><span itemprop="title">B787 Captains</span></a></h2>
//   <h3>... <span itemprop="employmentType">...</span> Job - <employer> </h3>
//   <span class="posted" itemprop="datePosted">Posted 2 days ago</span>
//   ...
//   <div class="req" itemprop="experienceRequirements"><span class="key">Aircraft:</span> Boeing 787</div>

const CARD_RE =
  /<a\s+itemprop="url"\s+href="(https:\/\/www\.findapilot\.com\/job\/(\d+)-[^"]+)"[\s\S]*?<span\s+itemprop="title">([^<]+)<\/span>[\s\S]*?<span\s+itemprop="employmentType">([^<]*)<\/span>[\s\S]{0,200}?Job\s*-\s*([^<]+?)\s*<\/h3>[\s\S]{0,500}?(?:datePosted">([^<]+)<\/span>)?/g;

function decode(s: string): string {
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

function parsePosted(s: string | undefined): number {
  if (!s) return Date.now();
  const lower = s.toLowerCase().replace(/^posted\s+/i, "").trim();
  if (lower.includes("today")) return Date.now();
  if (lower.includes("yesterday")) return Date.now() - 86400_000;
  const m = lower.match(/(\d+)\s+(day|week|month|hour|minute)s?\s+ago/);
  if (m) {
    const [, n, unit] = m;
    const num = Number(n);
    const ms =
      unit === "minute"
        ? 60_000
        : unit === "hour"
          ? 3600_000
          : unit === "day"
            ? 86400_000
            : unit === "week"
              ? 7 * 86400_000
              : 30 * 86400_000;
    return Date.now() - num * ms;
  }
  return Date.now();
}

async function fetchPage(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseCards(html: string): RawListing[] {
  CARD_RE.lastIndex = 0;
  const out: RawListing[] = [];
  let m: RegExpExecArray | null;
  while ((m = CARD_RE.exec(html)) !== null) {
    const [, url, jobId, rawTitle, employmentType, employerRaw, posted] = m;
    const title = decode(rawTitle);
    if (!PILOT_TITLE_RE.test(title)) continue;
    const employer = decode(employerRaw);
    out.push({
      externalId: `findapilot-${jobId}`,
      title,
      url,
      description: employmentType ? `Type: ${decode(employmentType)}` : null,
      employer: employer || null,
      location: null,
      postedAt: parsePosted(posted),
    });
  }
  return out;
}

export const findAPilotAdapter: SourceAdapter = {
  id: "findapilot",
  name: "FindAPilot",
  async fetch(): Promise<RawListing[]> {
    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchPage(PAGE_URL(page));
      if (!html) break;
      const items = parseCards(html);
      if (items.length === 0) break;
      let added = 0;
      for (const it of items) {
        if (seen.has(it.externalId)) continue;
        seen.add(it.externalId);
        out.push(it);
        added++;
      }
      // If no new items from this page (loop wrap-around / end of results), stop.
      if (added === 0) break;
    }
    return out;
  },
};
