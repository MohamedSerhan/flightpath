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

/** Common non-US country / city markers that sneak through aggregators
 *  like CAE, Bristow, and Air Canada. We test against location text and
 *  drop the listing if any match — the sibling is US-based and not
 *  pursuing international postings. */
const NON_US_RE =
  /\b(canada|ontario|quebec|british\s*columbia|alberta|toronto|montreal|vancouver|yyz|yul|yvr|france|germany|spain|italy|uk\b|united\s*kingdom|england|scotland|wales|ireland|london|paris|madrid|berlin|frankfurt|amsterdam|netherlands|belgium|switzerland|sweden|norway|denmark|poland|portugal|china|japan|tokyo|korea|seoul|singapore|hong\s*kong|india|mumbai|delhi|bangalore|dubai|uae|saudi|qatar|israel|egypt|brazil|mexico|argentina|chile|colombia|australia|sydney|melbourne|new\s*zealand|africa|nigeria|south\s*africa|montpellier|falkland|republic\s*of\s*korea)\b/i;

/** Returns true if the location string clearly references somewhere outside
 *  the US. Returns false on null/empty (we keep listings with unknown
 *  location — many real US-only sources don't expose location reliably). */
export function isNonUS(location: string | null | undefined): boolean {
  if (!location) return false;
  // "London, KY" is Kentucky — guard against false matches when a US state
  // abbrev is also present.
  if (extractState(location)) return false;
  return NON_US_RE.test(location);
}

// Aircraft type designators that indicate type-rating / sim training, NOT
// primary CFI work. A "Flight Instructor A320" is teaching airline pilots
// in a Level-D sim, not signing off student solos. Sibling wants the
// latter — route these to "airline" instead.
const AIRLINE_TYPE_RE =
  /\b(a3[1-8]\d|a220|b7[3-8]\d|md[-\s]?(80|88|90|11)|crj[-\s]?\d{3}|erj[-\s]?\d{3}|e[-\s]?(1[79]0|145|170|175|190|195)|emb[-\s]?\d{3}|atr[-\s]?\d{2}|dh[c]?[-\s]?\d|bd[-\s]?(700|100)|gulfstream|global\s*\d{4}|falcon\s*\d{1,4}|citation|hawker|king\s*air|learjet|legacy|saab\s*\d{2,3}|pc[-\s]?12|tbm\s*\d{3})\b/i;

// Title-level airline cues. When a posting's TITLE contains these tokens,
// the role is airline pilot work — even if the title also says "CFI" or
// "flight instructor", which in that context means CFI is a *requirement*
// of the airline role, not the role itself. Previously such titles fell
// through to the broad CFI regex and polluted the CFI filter ("Captain —
// CFI required", "First Officer (CFI preferred)" etc.).
const TITLE_AIRLINE_RE =
  /\b(first\s+officer|f\/o|fo\b|captain|airline\s+pilot|regional\s+pilot|line\s+pilot|121\s+pilot|right\s+seat|type[-\s]?rating|cadet\s+program|atp\s+ctp)\b/i;

// Sim/ground instructor roles. These don't fly with students — they teach
// systems/procedures in a classroom or full-motion simulator. Useful jobs,
// just not what we mean by "CFI" on this site.
const NON_FLYING_INSTRUCTOR_RE =
  /\b(simulator\s+instructor|sim\s+instructor|sfi\b|ground\s+instructor|cbt\s+instructor|systems\s+instructor|academic\s+instructor)\b/i;

// Description-level signals that the role is sim/ground only. FlightSafety
// posts "Flight Instructor" titles whose body reads "conduct pilot ground
// and simulator training for clients" — they aren't primary CFI roles.
const SIM_BODY_RE =
  /\b(simulator\s+training|simulator\s+session|ground\s+and\s+simulator|level[-\s]?d\s+sim|full[-\s]?motion\s+simulator|type\s+rating\s+(course|program|training)|recurrent\s+(training|simulator))\b/i;

// Known sim / type-rating training shops. Their "Flight Instructor"
// postings are nearly always Level-D sim work for biz-jet / airline
// pilots, not student-pilot CFI work. Demote to "other" so they don't
// pollute the CFI bucket.
const SIM_TRAINING_EMPLOYER_RE =
  /\b(flightsafety\s+international|cae\s*(inc|usa)?|pan\s*am\s+(international|flight\s*academy)|aerosim|simcom|alpha\s*aviation|pilot\s*center\s*aerospace|tru\s*simulation|l3harris\s+(commercial|airline\s+academy))\b/i;

export function classifyCategory(
  title: string,
  description?: string | null,
  employer?: string | null,
): JobCategory | null {
  const titleLc = title.toLowerCase();
  const fullLc = `${title} ${description ?? ""}`.toLowerCase();
  const employerLc = (employer ?? "").toLowerCase();

  // Hard-route airline aircraft type-rating instructors — even when the
  // title also says "Flight Instructor", the airframe wins. CAE / Breeze /
  // FlightSafety jet-type listings land here.
  if (AIRLINE_TYPE_RE.test(titleLc) && /instructor|pilot/.test(titleLc)) {
    return "airline";
  }

  // Sim / ground / SFI roles → "other". They aren't categorized as CFI
  // even when the listing technically requires a CFI cert.
  if (NON_FLYING_INSTRUCTOR_RE.test(titleLc)) {
    return "other";
  }

  // Canadian Transport Canada nomenclature ("Class 1/2/3/4 Flight
  // Instructor") — these are Canadian schools, not US-FAA CFI roles. The
  // location-based filter usually catches them, but some adapters strip
  // location, so guard at the title level too.
  if (/\bclass\s+[1-4]\s+flight\s+instructor\b/.test(titleLc)) {
    return "other";
  }

  // Sim training shops post bland "Flight Instructor" titles for what are
  // actually Level-D sim sessions on biz jets. Combine the employer
  // allow-list with the body-text check — either signal demotes to "other".
  const isSimEmployer = SIM_TRAINING_EMPLOYER_RE.test(employerLc);
  const isSimBody = SIM_BODY_RE.test(fullLc);
  if (/instructor/.test(titleLc) && (isSimEmployer || isSimBody)) {
    return "other";
  }

  // Per-operation non-CFI part-91 buckets. Order matters — most specific
  // wins. `air ambulance` / `hems` is the rarest and most unambiguous;
  // the rest are common enough that the user wants a dedicated chip.
  // These checks run before the airline-title check so that, e.g.,
  // "Air Ambulance Captain" routes to air_ambulance rather than airline.
  if (/\b(air\s+ambulance|hems|helicopter\s+ems|medevac|medivac)\b/.test(fullLc)) return "air_ambulance";
  if (/\b(aerial\s+survey|aerial\s+mapping|photogrammetry|lidar\s+pilot)\b/.test(fullLc)) return "aerial_survey";
  if (/\b(pipeline\s+patrol|powerline\s+patrol|pipeline\s+pilot)\b/.test(fullLc)) return "pipeline_patrol";
  if (/\b(skydive|skydiving|jump\s+pilot|parachute\s+operations?)\b/.test(fullLc)) return "skydiving";
  if (/\b(banner\s+tow|banner-tow|banner\s+pilot)\b/.test(fullLc)) return "banner_tow";
  if (/\b(traffic\s+watch|traffic-watch|news\s+helicopter|eng\s+pilot|electronic\s+news\s+gathering)\b/.test(fullLc)) return "traffic_watch";

  // Airline-cue titles outrank the CFI fallback. A title that says
  // "First Officer" or "Captain" alongside "CFI" is an airline role that
  // *requires* a CFI cert — not a CFI role. Route to airline before the
  // broad CFI title match below so it doesn't leak into the CFI filter.
  if (TITLE_AIRLINE_RE.test(titleLc)) {
    return "airline";
  }

  // Title-primary matching. Description is too noisy — listings often
  // mention "CFI preferred" or "must hold flight instructor cert" for
  // First Officer roles, which previously polluted the CFI bucket.
  // Note: schools use both "certified" (FAA-issued) and "certificated"
  // (older/formal) interchangeably — match both.
  if (/\b(cfii|certif(ied|icated)\s+flight\s+instructor\s+instrument|instrument\s+flight\s+instructor)\b/.test(titleLc)) return "cfii";
  if (/\bmei\b|multi[-\s]?engine\s+instructor/.test(titleLc)) return "mei";
  if (/\b(cfi|flight\s+instructor|certif(ied|icated)\s+flight\s+instructor)\b/.test(titleLc)) return "cfi";

  if (/\bpart\s*135\b|charter pilot|on[-\s]demand/.test(fullLc)) return "part135";
  if (/\bpart\s*91\b|corporate pilot|business jet/.test(fullLc)) return "corporate";
  if (/\b(first officer|fo\b|captain|airline)\b/.test(fullLc)) return "airline";
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
  // categoryHint short-circuits the classifier — adapters whose source
  // already tags each posting (lowtimepilot) carry the category through
  // directly so we don't risk misclassifying based on title text alone
  // (e.g. a "Pilot Wanted — XYZ Skydiving" posting would otherwise
  // fall back to "other" if the body doesn't contain "skydive").
  const category = raw.categoryHint ?? classifyCategory(raw.title, raw.description, raw.employer);
  return {
    ...raw,
    state: extractState(raw.location),
    jobCategory: category,
    hoursRequired: extractHoursRequired(`${raw.title}\n${raw.description ?? ""}`),
    ratingsRequired: extractRatings(`${raw.title}\n${raw.description ?? ""}`),
  };
}
