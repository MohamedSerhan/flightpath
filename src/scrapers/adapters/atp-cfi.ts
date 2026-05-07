import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * ATP Flight School — CFI-specific secondary scraper.
 *
 * ATP's public Breezy JSON feed (covered by the ATS adapter) is filtered
 * to maintenance + training-support roles; their actual CFI postings live
 * at /p/<id>-... URLs but are excluded from /json (likely posted as
 * private/share-link roles). They are, however, indexed by Google and
 * usually surface in the rendered sitemap.
 *
 * Strategy: pull the sitemap, filter to /p/ posting URLs, fetch each one
 * with a low concurrency cap, and parse the page metadata. Capped at
 * MAX_FETCHES per run to avoid hammering Breezy.
 *
 * Source for this approach: research/04-ats-map.md (item #1).
 */

const SITEMAP_URLS = [
  "https://atp-flight-school.breezy.hr/sitemap.xml",
  "https://atp-flight-school.breezy.hr/sitemap_index.xml",
];
const MAX_FETCHES = 25;
const CONCURRENCY = 4;
const REQUEST_DELAY_MS = 400;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CFI_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot)\b/i;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decode(s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xml" },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function discoverPostUrls(): Promise<string[]> {
  for (const sm of SITEMAP_URLS) {
    const xml = await fetchText(sm);
    if (!xml) continue;
    const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g))
      .map((m) => m[1])
      .filter((u) => /\/p\//.test(u));
    if (locs.length > 0) return locs;
  }

  // Fallback: scrape the careers landing for /p/ links.
  const html = await fetchText("https://atp-flight-school.breezy.hr/");
  if (!html) return [];
  const matches = Array.from(html.matchAll(/href=["'](\/p\/[a-z0-9\-]+)["']/gi));
  return matches
    .map((m) => `https://atp-flight-school.breezy.hr${m[1]}`)
    .filter((url, i, arr) => arr.indexOf(url) === i);
}

function extractPostingMeta(
  url: string,
  html: string,
): { id: string; title: string; description: string | null; location: string | null; postedAt: number } | null {
  const idMatch = url.match(/\/p\/([a-f0-9]+)/);
  const id = idMatch?.[1];
  if (!id) return null;
  const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1]).split("|")[0].trim() : null;
  if (!title) return null;
  const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  const description = descMatch ? decode(descMatch[1]).trim() : null;
  // Locations on Breezy posting pages render as text near "Location:" or in the
  // og:title (e.g. "FAA Certified Airplane Flight Instructor - JQF Airport").
  const locMatch = title.match(/-\s*([A-Z]{3,4})\s+Airport/i);
  const location = locMatch ? `${locMatch[1].toUpperCase()} Airport` : null;
  // Posted-at — Breezy rendered pages don't always expose the date; fall back
  // to "now" for newly-discovered postings. The detail-enrichment pass can
  // refine if it finds a date in the page body.
  const dateMatch = html.match(/"datePosted":"([^"]+)"/);
  const postedAt = dateMatch ? Date.parse(dateMatch[1]) : Date.now();
  return { id, title, description, location, postedAt: Number.isFinite(postedAt) ? postedAt : Date.now() };
}

export const atpCfiAdapter: SourceAdapter = {
  id: "atp-cfi",
  name: "ATP Flight School (CFI)",
  async fetch(): Promise<RawListing[]> {
    const urls = await discoverPostUrls();
    if (urls.length === 0) {
      console.log("[atp-cfi] no postings discovered");
      return [];
    }
    const queue = urls.slice(0, MAX_FETCHES);
    console.log(`[atp-cfi] fetching ${queue.length}/${urls.length} ATP posting pages…`);

    const out: RawListing[] = [];
    let i = 0;

    async function worker() {
      while (i < queue.length) {
        const idx = i++;
        const url = queue[idx];
        const html = await fetchText(url);
        if (!html) continue;
        const meta = extractPostingMeta(url, html);
        if (!meta) continue;
        if (!CFI_TITLE_RE.test(meta.title)) continue;
        out.push({
          externalId: `atp-cfi-${meta.id}`,
          title: meta.title,
          url,
          description: meta.description,
          employer: "ATP Flight School",
          location: meta.location,
          postedAt: meta.postedAt,
        });
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    console.log(`[atp-cfi] kept ${out.length} CFI roles`);
    return out;
  },
};
