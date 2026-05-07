import type { BrowserContext } from "playwright";
import type { BrowserAdapter } from "../runner.ts";
import type { RawListing } from "../../types.ts";

/**
 * NBAA Jobs (jobs.nbaa.org) — National Business Aviation Association's
 * jobs board. The board itself is server-rendered with stable
 * `.job-tile-<id>` blocks containing hidden inputs for `job_id`,
 * `job_Position`, `job_company`, and `job_Location`.
 *
 * However, plain HTTP fetch is inconsistent: Cloudflare's bot manager
 * intermittently returns a 403 with a managed-challenge interstitial
 * even with realistic browser headers. Playwright with a real Chromium
 * passes the challenge transparently.
 *
 * Each listing yields title, employer, single-or-multi US location,
 * and "N days/hours ago" posted date. Many roles are corporate
 * captain / PIC / SIC — pilotOnly is enforced at the title level and
 * non-US listings are dropped.
 *
 * Verified live 2026-05-07: ~23 listings exposed on the anonymous
 * search page with no pagination.
 */

const URL = "https://jobs.nbaa.org/jobs/";

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

type ScrapedTile = {
  jobId: string;
  position: string | null;
  titleText: string;
  href: string;
  company: string | null;
  singleLocation: string | null;
  multiLocations: string[];
  posted: string | null;
};

function parsePosted(s: string | null): number {
  if (!s) return Date.now();
  const lower = s.toLowerCase().trim();
  if (lower.includes("today") || lower.includes("just")) return Date.now();
  if (lower.includes("yesterday")) return Date.now() - 86400_000;
  const m = lower.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return Date.now();
  const num = Number(m[1]);
  const unit = m[2];
  const ms =
    unit === "minute" ? 60_000
      : unit === "hour" ? 3600_000
      : unit === "day" ? 86400_000
      : unit === "week" ? 7 * 86400_000
      : unit === "month" ? 30 * 86400_000
      : 365 * 86400_000;
  return Date.now() - num * ms;
}

// "Dallas, Texas, United States" → "Dallas, TX"
// "Chicago, Illinois, United States" (from a multi-loc dropdown item)
// Anything not ending with United States/USA/US is dropped (US-only).
function parseUSLocation(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
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

function pickUSLocation(tile: ScrapedTile): string | null {
  for (const it of tile.multiLocations) {
    const parsed = parseUSLocation(it);
    if (parsed) return parsed;
  }
  if (tile.multiLocations.length > 0) return null; // multi-loc, none in US
  return tile.singleLocation ? parseUSLocation(tile.singleLocation) : null;
}

export const nbaaAdapter: BrowserAdapter = {
  id: "nbaa",
  name: "NBAA Jobs (Business Aviation)",
  async fetch(ctx: BrowserContext): Promise<RawListing[]> {
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // Wait for the listing grid to render past Cloudflare's challenge.
    await page
      .waitForSelector(".job-tile [name='job_id']", { timeout: 30_000 })
      .catch(() => {
        /* selector may not appear if the page degrades — fall through */
      });

    const tiles: ScrapedTile[] = await page.evaluate(() => {
      const out: ScrapedTile[] = [];
      const inputValue = (tile: Element, name: string) =>
        (tile.querySelector(`input[name='${name}']`) as HTMLInputElement | null)?.value?.trim() || null;

      document.querySelectorAll(".job-tile").forEach((tile) => {
        const jobId = inputValue(tile, "job_id");
        if (!jobId || !/^\d+$/.test(jobId)) return;

        const linkEl = tile.querySelector(".job-title a[href]") as HTMLAnchorElement | null;
        if (!linkEl) return;

        const multiLocations: string[] = [];
        tile.querySelectorAll(".dropdown-menu-locations .dropdown-item").forEach((d) => {
          const t = (d.textContent ?? "").trim();
          if (t) multiLocations.push(t);
        });

        const postedEl = tile.querySelector(".job-posted-date");
        out.push({
          jobId,
          position: inputValue(tile, "job_Position"),
          titleText: (linkEl.textContent ?? "").trim(),
          href: linkEl.href,
          company: inputValue(tile, "job_company"),
          singleLocation: multiLocations.length === 0 ? inputValue(tile, "job_Location") : null,
          multiLocations,
          posted: postedEl ? (postedEl.textContent ?? "").trim() || null : null,
        });
      });
      return out;
    });

    await page.close();

    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (const tile of tiles) {
      if (seen.has(tile.jobId)) continue;
      const title = tile.position || tile.titleText;
      if (!title || !PILOT_TITLE_RE.test(title)) continue;
      const location = pickUSLocation(tile);
      if (!location) continue;
      seen.add(tile.jobId);
      out.push({
        externalId: `nbaa-${tile.jobId}`,
        title,
        url: tile.href,
        description: null,
        employer: tile.company || null,
        location,
        postedAt: parsePosted(tile.posted),
      });
    }
    return out;
  },
};
