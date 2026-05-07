/**
 * Curated list of flight-school / aviation-employer ATS slugs.
 *
 * Add new schools here — the rest of the system picks them up automatically.
 * If a slug 404s in production, the adapter logs the failure under
 * `sources` table and moves on to the next.
 *
 * pilotOnly: when true, the title must match a pilot/CFI/instructor regex
 * before the listing is kept. When false, every job comes through and
 * downstream classification handles category routing.
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
  // Breezy
  { kind: "breezy", slug: "atp-flight-school", name: "ATP Flight School", pilotOnly: true },

  // Greenhouse — seeded with airlines / regional carriers known to host pilot pipeline jobs
  { kind: "greenhouse", slug: "republicairways", name: "Republic Airways", pilotOnly: true },
  { kind: "greenhouse", slug: "skywestairlines", name: "SkyWest Airlines", pilotOnly: true },
  { kind: "greenhouse", slug: "endeavorair", name: "Endeavor Air", pilotOnly: true },
  { kind: "greenhouse", slug: "envoyair", name: "Envoy Air", pilotOnly: true },
  { kind: "greenhouse", slug: "piedmontairlines", name: "Piedmont Airlines", pilotOnly: true },
  { kind: "greenhouse", slug: "psaairlines", name: "PSA Airlines", pilotOnly: true },
  { kind: "greenhouse", slug: "horizonair", name: "Horizon Air", pilotOnly: true },
  { kind: "greenhouse", slug: "mesaairlines", name: "Mesa Airlines", pilotOnly: true },
  { kind: "greenhouse", slug: "capeair", name: "Cape Air", pilotOnly: true },
  { kind: "greenhouse", slug: "alaskaair", name: "Alaska Airlines", pilotOnly: true },
  { kind: "greenhouse", slug: "jetblue", name: "JetBlue", pilotOnly: true },
  { kind: "greenhouse", slug: "spirit", name: "Spirit Airlines", pilotOnly: true },
  { kind: "greenhouse", slug: "hillsboroaero", name: "Hillsboro Aero Academy", pilotOnly: true },
  { kind: "greenhouse", slug: "aeroguard", name: "AeroGuard Flight Training Center", pilotOnly: true },
  { kind: "greenhouse", slug: "epicflightacademy", name: "Epic Flight Academy", pilotOnly: true },
  { kind: "greenhouse", slug: "spartancollege", name: "Spartan College of Aeronautics", pilotOnly: true },
  { kind: "greenhouse", slug: "flightsafetyinternational", name: "FlightSafety International", pilotOnly: true },
  { kind: "greenhouse", slug: "flightsafety", name: "FlightSafety International", pilotOnly: true },

  // Lever
  { kind: "lever", slug: "embry-riddle", name: "Embry-Riddle Aeronautical University", pilotOnly: true },
  { kind: "lever", slug: "republicairways", name: "Republic Airways (Lever)", pilotOnly: true },
  { kind: "lever", slug: "skyborne", name: "Skyborne Airline Academy", pilotOnly: true },

  // Workable
  { kind: "workable", slug: "atp-flight-school", name: "ATP Flight School (Workable)", pilotOnly: true },
  { kind: "workable", slug: "epic-flight-academy", name: "Epic Flight Academy (Workable)", pilotOnly: true },
  { kind: "workable", slug: "coast-flight-training", name: "Coast Flight Training", pilotOnly: true },
  { kind: "workable", slug: "aeroguard", name: "AeroGuard (Workable)", pilotOnly: true },

  // Ashby
  { kind: "ashby", slug: "lift-academy", name: "Republic LIFT Academy", pilotOnly: true },

  // Recruitee + SmartRecruiters seeds (commonly used by aviation cos)
  { kind: "smartrecruiters", slug: "PiedmontAirlines", name: "Piedmont (SmartRecruiters)", pilotOnly: true },
  { kind: "smartrecruiters", slug: "Skywest", name: "SkyWest (SmartRecruiters)", pilotOnly: true },
];

export const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|sim\s+instructor|simulator\s+instructor|ground\s+instructor|chief\s+instructor|check\s+airman|line\s+check|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

export function passesPilotFilter(title: string, pilotOnly: boolean | undefined): boolean {
  if (!pilotOnly) return true;
  return PILOT_TITLE_RE.test(title);
}
