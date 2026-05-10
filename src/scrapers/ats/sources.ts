/**
 * Curated list of flight-school / aviation-employer ATS slugs.
 *
 * Every entry below was verified live on 2026-05-07 — see
 * research/04-ats-map.md for the audit trail. The CFI hiring market is
 * dominated by Workday / iCIMS / AirlineApps / proprietary forms, so
 * the verified-public-JSON list is short.
 *
 * pilotOnly: when true, the title must match a pilot/CFI/instructor
 * regex before the listing is kept. Set false for employers where
 * we want all roles (e.g. maintenance instructors as adjacent persona).
 */

export type AtsKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "breezy"
  | "recruitee"
  | "smartrecruiters";

export type AtsSource = {
  kind: AtsKind;
  slug: string;
  /** Display name for this employer. */
  name: string;
  /** When true, only flight-instruction / pilot titles are kept. */
  pilotOnly?: boolean;
  /** Optional override URL if the public-API host is non-standard. */
  apiOverride?: string;
};

export const ATS_SOURCES: AtsSource[] = [
  // ATP Flight School — largest US CFI employer. Public JSON returns ~18 jobs
  // (mostly maintenance / training-support); CFI postings are filtered out
  // and need a separate HTML scrape (see adapters/atp.ts).
  { kind: "breezy", slug: "atp-flight-school", name: "ATP Flight School", pilotOnly: true },

  // Breeze Airways — A220 Flight Instructor + Embark Pilot Program (CFI feeder).
  { kind: "greenhouse", slug: "breezeairways", name: "Breeze Airways", pilotOnly: true },

  // WSU Tech (Wichita State Tech) — has historically posted "Adjunct Faculty,
  // Certified Flight Instructor". Currently inactive, but the slug is verified
  // and will repopulate.
  { kind: "workable", slug: "wsutech", name: "WSU Tech", pilotOnly: true },

  // Florida Flyers Flight Academy — Breezy account verified, currently empty.
  // Worth polling because flight-instructor postings rotate.
  { kind: "breezy", slug: "florida-flyers-flight-academy-inc", name: "Florida Flyers Flight Academy", pilotOnly: true },

  { kind: "greenhouse", slug: "atlasair", name: "Atlas Air", pilotOnly: true },

  // Verified live 2026-05-09 — aerospace startups + defense primes that
  // expose public Greenhouse / Lever boards. Volume per board is highly
  // variable (BETA: ~160 with a real CFI posting; Anduril: ~1900 with
  // Sr. Test Pilot roles; Shield AI: 290 with Standardization Pilot).
  // Even when zero pilot roles match today, the slug stays here so a
  // posting next week gets caught automatically.

  // BETA Technologies — eVTOL maker. Has a "Part Time Fixed Wing CFI"
  // posting; their flight ops team hires CFIs to support certification.
  { kind: "greenhouse", slug: "betatechnologiesinc", name: "BETA Technologies", pilotOnly: true },

  // Anduril — defense autonomy. Test pilots for autonomous platforms.
  { kind: "greenhouse", slug: "andurilindustries", name: "Anduril Industries", pilotOnly: true },

  // Stratolaunch — hypersonic test platform. Test pilot roles.
  { kind: "greenhouse", slug: "stratolaunch", name: "Stratolaunch", pilotOnly: true },

  // SpaceX, Rocket Lab, Planet Labs — large boards with no current
  // pilot listings, but rotates. Cheap to keep polling.
  { kind: "greenhouse", slug: "spacex", name: "SpaceX", pilotOnly: true },
  { kind: "greenhouse", slug: "rocketlab", name: "Rocket Lab", pilotOnly: true },
  { kind: "greenhouse", slug: "planetlabs", name: "Planet Labs", pilotOnly: true },

  // Shield AI — autonomy company; "Standardization Pilot" roles.
  { kind: "lever", slug: "shieldai", name: "Shield AI", pilotOnly: true },

  // Merlin Labs — autonomy retrofit; "Experimental Test Pilot" roles.
  { kind: "lever", slug: "merlinlabs", name: "Merlin Labs", pilotOnly: true },

  // Pivotal Aero — eVTOL. Flight test + flight training manager roles.
  { kind: "lever", slug: "pivotal", name: "Pivotal Aero", pilotOnly: true },

  // Allegiant Air — ULCC carrier. Public Lever board (verified 2026-05-09).
  // Most postings are corporate but pilot roles do post here periodically.
  { kind: "lever", slug: "allegiantair", name: "Allegiant Air", pilotOnly: true },
];

export const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|sim\s+instructor|simulator\s+instructor|ground\s+instructor|chief\s+instructor|check\s+airman|line\s+check|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

export function passesPilotFilter(title: string, pilotOnly: boolean | undefined): boolean {
  if (!pilotOnly) return true;
  return PILOT_TITLE_RE.test(title);
}
