import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Climbto350 — the most-trafficked aviation jobs board, behind a paywall
 * for full details but with public title + state on the index page.
 *
 * Detail pages require a paid login, so this adapter only carries the
 * title and state. The "full" URL points at the same login_popup that a
 * regular browser visit would hit — when the user clicks through they
 * get prompted to log in or sign up. That's intentional and fair use:
 * we surface the existence of a posting; Climbto350 monetizes the
 * details.
 *
 * The site is mostly captain/PIC roles for corporate operators —
 * occasional CFI postings show up and those are the ones we care about.
 * pilotOnly is enforced at the title level.
 */

const INDEX_URL = "https://ppb.climbto350.com/climbto350_aviation_jobs_board.cfm";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|sim\s+instructor|simulator\s+instructor|ground\s+instructor|chief\s+instructor|line\s+check|check\s+airman|first\s+officer|captain|pic|sic|pilot)\b/i;

// <a href="http://www.climbto350.com/login_popup.cfm?jobID=143731&page=job_search.cfm">Title - State</a>
const LISTING_RE =
  /<a\s+href="(http:\/\/www\.climbto350\.com\/login_popup\.cfm\?jobID=(\d+)[^"]*)">([^<]+)<\/a>/g;

const US_STATES = new Set([
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
  "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio",
  "Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
  "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
  "Wisconsin","Wyoming","District of Columbia",
]);

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseTitleAndState(raw: string): { title: string; state: string | null } {
  const text = decode(raw).replace(/\s+/g, " ").trim();
  // Pattern: "<title> - <state>"
  // The state is the last segment after a hyphen. Some titles contain hyphens
  // themselves so we walk from the right and accept the last segment whose
  // text matches a known US state name.
  const segments = text.split(/\s+-\s+/);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (US_STATES.has(segments[i].trim())) {
      return {
        title: segments.slice(0, i).join(" - ").trim() || text,
        state: segments[i].trim(),
      };
    }
  }
  return { title: text, state: null };
}

const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
  Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
  Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  "District of Columbia": "DC",
};

export const climbto350Adapter: SourceAdapter = {
  id: "climbto350",
  name: "Climbto350",
  async fetch(): Promise<RawListing[]> {
    const res = await fetch(INDEX_URL, {
      headers: { Accept: "text/html", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const seen = new Set<string>();
    const out: RawListing[] = [];
    let match: RegExpExecArray | null;
    LISTING_RE.lastIndex = 0;
    while ((match = LISTING_RE.exec(html)) !== null) {
      const [, url, jobId, rawText] = match;
      // Skip the duplicate "(Members Only)" anchors that share the same href.
      if (/\bmembers\s+only\b/i.test(rawText)) continue;
      if (seen.has(jobId)) continue;
      seen.add(jobId);

      const { title, state } = parseTitleAndState(rawText);
      if (!PILOT_TITLE_RE.test(title)) continue;
      const stateAbbr = state ? (STATE_ABBR[state] ?? null) : null;
      out.push({
        externalId: `climbto350-${jobId}`,
        title,
        url,
        description: state ? `Listed on Climbto350. State: ${state}. Full details require a Climbto350 membership.` : null,
        employer: null,
        location: stateAbbr ? `${state}, ${stateAbbr}` : state,
        postedAt: Date.now(), // C350 doesn't expose post date on the index
      });
    }
    return out;
  },
};
