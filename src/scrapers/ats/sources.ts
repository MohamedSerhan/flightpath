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
];

export const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|sim\s+instructor|simulator\s+instructor|ground\s+instructor|chief\s+instructor|check\s+airman|line\s+check|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

export function passesPilotFilter(title: string, pilotOnly: boolean | undefined): boolean {
  if (!pilotOnly) return true;
  return PILOT_TITLE_RE.test(title);
}
