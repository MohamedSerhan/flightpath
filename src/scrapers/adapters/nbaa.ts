import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * NBAA Jobs (jobs.nbaa.org) — National Business Aviation Association's
 * jobs board. Server-rendered HTML with stable hidden-input fields per
 * tile (`job_id`, `job_Position`, `job_company`, `job_Location`).
 *
 * Originally a Playwright adapter — but plain HTTP gets the full markup
 * just fine (no Cloudflare challenge as of 2026-05). Switching to HTTP
 * saves ~30s per scrape and removes one of the browser-pass dependencies.
 *
 * Most listings are corporate / part-91 captain / SIC roles. Useful
 * volume — typically ~25 active postings.
 */

const URL_BASE = "https://jobs.nbaa.org/jobs/";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

const STATE_ABBR: Record<string, string> = {
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

// Long Chrome UA trips Cloudflare's bot fingerprint (returns a 5K
// challenge interstitial). Short generic UA passes — same trick as the
// iCIMS Endeavor adapter. NBAA's CF rules apparently flag the
// `Win64; x64) AppleWebKit/...` pattern as automation.
const UA = "Mozilla/5.0 Chrome/120";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

// "Dallas, Texas, United States" → "Dallas, TX". Returns null for non-US.
function parseUSLocation(raw: string | null): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const country = parts[parts.length - 1]?.toLowerCase() ?? "";
  if (country !== "united states" && country !== "usa" && country !== "us") return null;
  const rest = parts.slice(0, -1);
  if (rest.length === 0) return "United States";
  if (rest.length === 1) return STATE_ABBR[rest[0].toLowerCase()] ?? rest[0];
  const [city, stateRaw] = rest;
  return `${city}, ${STATE_ABBR[stateRaw.toLowerCase()] ?? stateRaw}`;
}

async function fetchViaCurl(url: string): Promise<string> {
  const proc = Bun.spawn([
    "curl",
    "-sL",
    "--max-time",
    "20",
    "-A",
    UA,
    url,
  ]);
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`curl exit ${code}`);
  return text;
}

/** Pull a hidden-input value scoped to a tile-block substring. */
function inputValue(block: string, name: string): string | null {
  const re = new RegExp(
    `<input[^>]*\\bname="${name}"[^>]*\\bvalue="([^"]*)"`,
    "i",
  );
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

export const nbaaAdapter: SourceAdapter = {
  id: "nbaa",
  name: "NBAA Jobs (Business Aviation)",
  async fetch(): Promise<RawListing[]> {
    // Cloudflare on jobs.nbaa.org fingerprints TLS — Bun's native fetch
    // 403's, but plain `curl` (Chrome-like signature) passes. We shell
    // out to curl as a workaround. `curl` is preinstalled on the Ubuntu
    // CI runner and on macOS; on modern Windows 10+ it's also bundled.
    const html = await fetchViaCurl(URL_BASE);
    if (!html) throw new Error("curl returned empty body");
    // Cloudflare's challenge interstitial is ~5K of HTML with no
    // job-tile markers. Detect that case and return [] gracefully — we
    // can pick the listings up on the next scheduled run when CF
    // rate-limit windows reset.
    if (html.length < 20_000 || !/\bjob-tile\b/.test(html)) {
      console.log("[nbaa] cloudflare challenge detected — skipping");
      return [];
    }

    // Each tile is a <div class="...job-tile..."> that contains the
    // hidden inputs we care about. We can't reliably split by closing div
    // (nested tags), so split by the opening tile marker and trim each
    // block at the next `data-jobid=` or end of string.
    const tileBlocks = html.split(/<div[^>]*class="[^"]*\bjob-tile\b/i).slice(1);

    const seen = new Set<string>();
    const out: RawListing[] = [];

    for (const block of tileBlocks) {
      const jobId = inputValue(block, "job_id");
      if (!jobId || !/^\d+$/.test(jobId) || seen.has(jobId)) continue;

      const position = inputValue(block, "job_Position");
      const company = inputValue(block, "job_company");
      const rawLoc = inputValue(block, "job_Location");

      // Title link — the anchor lives inside `<div class="job-title">`.
      // The href is relative (`/job/...`); we resolve to the absolute URL.
      const linkMatch = block.match(/<a[^>]+href="(\/job\/[^"]+)"/i);
      const url = linkMatch
        ? `https://jobs.nbaa.org${decodeEntities(linkMatch[1])}`
        : null;

      const title = position?.trim();
      if (!title || !PILOT_TITLE_RE.test(title)) continue;
      if (!url) continue;

      const location = parseUSLocation(rawLoc);
      if (!location) continue;

      seen.add(jobId);
      out.push({
        externalId: `nbaa-${jobId}`,
        title,
        url,
        description: null,
        employer: company,
        location,
        // NBAA's tile doesn't expose a parseable post date in markup —
        // detail-enrichment fills `datePosted` from JSON-LD on each page.
        postedAt: Date.now(),
      });
    }
    return out;
  },
};
