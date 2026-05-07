import type { JobCategory } from "../shared/types.ts";
import type { EnrichedListing, RawListing } from "./types.ts";

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};
const STATE_NAMES_TO_ABBR = Object.fromEntries(
  Object.entries(US_STATES).map(([k, v]) => [v.toLowerCase(), k]),
);

export function extractState(location: string | null | undefined): string | null {
  if (!location) return null;
  const trimmed = location.trim();

  const abbrMatch = trimmed.match(/\b([A-Z]{2})\b(?!\w)/);
  if (abbrMatch && US_STATES[abbrMatch[1]]) return abbrMatch[1];

  const lower = trimmed.toLowerCase();
  for (const [name, abbr] of Object.entries(STATE_NAMES_TO_ABBR)) {
    if (lower.includes(name)) return abbr;
  }
  return null;
}

export function classifyCategory(title: string, description?: string | null): JobCategory | null {
  const t = `${title} ${description ?? ""}`.toLowerCase();

  if (/\b(cfii|certified flight instructor instrument|instrument instructor)\b/.test(t)) return "cfii";
  if (/\bmei\b|multi[-\s]?engine instructor/.test(t)) return "mei";
  if (/\b(cfi|flight instructor|certified flight instructor|flight\s*teacher)\b/.test(t)) return "cfi";
  if (/\bpart\s*135\b|charter pilot|on[-\s]demand/.test(t)) return "part135";
  if (/\bpart\s*91\b|corporate pilot|business jet/.test(t)) return "corporate";
  if (/\b(first officer|fo\b|captain|airline)\b/.test(t)) return "airline";
  if (/\b(banner tow|pipeline patrol|skydive|aerial survey|traffic watch)\b/.test(t)) return "part91";
  return "other";
}

const HOUR_PATTERNS = [
  /(\d{3,5})\s*\+?\s*(?:hours?|hrs?|tt|total\s*time)/gi,
  /(?:minimum|min\.?|at\s*least|requires?|required:?)\s*(\d{3,5})\s*(?:hours?|hrs?|tt)/gi,
];

export function extractHoursRequired(description: string | null | undefined): number | null {
  if (!description) return null;
  const found: number[] = [];
  for (const re of HOUR_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(description)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 100 && n <= 25000) found.push(n);
    }
  }
  if (found.length === 0) return null;
  return Math.min(...found);
}

const RATING_TOKENS: Array<[RegExp, string]> = [
  [/\bATP\b/i, "ATP"],
  [/\bCFII\b|instrument instructor/i, "CFII"],
  [/\bMEI\b|multi[-\s]?engine instructor/i, "MEI"],
  [/\bCFI\b|flight instructor/i, "CFI"],
  [/\bcommercial\b|\bCMEL\b|\bCSEL\b/i, "Commercial"],
  [/\bIFR\b|\binstrument rating\b/i, "Instrument"],
  [/\bmulti[-\s]?engine\b|\bAMEL\b|\bME\b/i, "Multi-Engine"],
  [/\btail\s*wheel\b/i, "Tailwheel"],
  [/\bcomplex\b/i, "Complex"],
  [/\bhigh[-\s]?performance\b/i, "High Performance"],
];

export function extractRatings(text: string | null | undefined): string[] | null {
  if (!text) return null;
  const found = new Set<string>();
  for (const [re, label] of RATING_TOKENS) {
    if (re.test(text)) found.add(label);
  }
  return found.size > 0 ? Array.from(found) : null;
}

export function enrichListing(raw: RawListing): EnrichedListing {
  return {
    ...raw,
    state: extractState(raw.location),
    jobCategory: classifyCategory(raw.title, raw.description),
    hoursRequired: extractHoursRequired(`${raw.title}\n${raw.description ?? ""}`),
    ratingsRequired: extractRatings(`${raw.title}\n${raw.description ?? ""}`),
  };
}
