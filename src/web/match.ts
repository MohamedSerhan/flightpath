/**
 * Match score — how well a listing fits the applicant's profile.
 *
 * 0–100 integer. The point is to surface "the 5–10 listings worth your
 * attention this week" out of a 500-listing scroll. Color-coded ring on
 * the listing card and a default "sort by match" makes the daily check-
 * in fast.
 *
 * The scoring is intentionally simple and explainable. Five factors,
 * each contributing at most ~25 points to the score, mostly additive
 * around a baseline of 50. We can tune weights later; the important
 * design constraint is that a listing the user can't qualify for
 * (1500-hour ATP role when they're at 250 TT) should fall well below
 * 50 and a listing that's a clear fit (CFI seat in their state with no
 * stated minimums) should land north of 80.
 */

import type { HoursBreakdown, Listing } from "../shared/types.ts";
import type { ApplicantProfile } from "./outreach.ts";

export type MatchTier = "high" | "mid" | "low";

export type MatchResult = {
  score: number;
  tier: MatchTier;
  /** One-line human explanation, top reason. */
  reason: string;
};

export function tierOf(score: number): MatchTier {
  if (score >= 75) return "high";
  if (score >= 50) return "mid";
  return "low";
}

/** Roughly which categories the applicant should focus on. CFI cohort
 *  defaults; downstream UI can tweak via the profile if needed.
 *
 *  Non-CFI part-91-adjacent operations (skydiving, banner_tow, aerial_survey,
 *  pipeline_patrol, traffic_watch) are included as preferred because they're
 *  the time-build paths a low-time CFI is likely to consider — the same
 *  reason the old lumped `part91` bucket sat here. air_ambulance stays out
 *  because it typically requires higher minimums (commercial + 1000+ hours
 *  + instrument current). */
const PREFERRED_CATEGORIES = new Set([
  "cfi",
  "cfii",
  "mei",
  "part91",
  "skydiving",
  "banner_tow",
  "aerial_survey",
  "pipeline_patrol",
  "traffic_watch",
]);
const STRETCH_CATEGORIES = new Set(["part135", "corporate", "air_ambulance"]);
const OUT_OF_REACH = new Set(["airline"]);

/** Mapping of per-class hour fields between the listing's parsed
 *  breakdown and the applicant profile, plus a short human label used
 *  in the "Short N ME hours of M required" reason string. */
const PER_CLASS_LABELS: Array<[keyof HoursBreakdown, keyof ApplicantProfile, string]> = [
  ["multiEngine", "multiEngineHours", "ME"],
  ["turbine", "turbineHours", "turbine"],
  ["tailwheel", "tailwheelHours", "tailwheel"],
  ["complex", "complexHours", "complex"],
  ["instrument", "instrumentHours", "instrument"],
  ["pic", "picHours", "PIC"],
  ["crossCountry", "crossCountryHours", "XC"],
];

/** Per-class deficit penalty.
 *
 *  When a listing names a per-class minimum and the applicant has the
 *  corresponding hours, deduct up to 10 points proportional to the
 *  deficit per class. Capped at -25 across all classes. Skipped when
 *  the applicant hasn't entered the field (don't penalize for missing
 *  profile data). Surfaces the dominant deficit so callers can use it
 *  in the `reason` string. */
function perClassDeficit(
  breakdown: HoursBreakdown | null,
  profile: ApplicantProfile,
): { penalty: number; topDeficit: { label: string; have: number; need: number } | null } {
  if (!breakdown) return { penalty: 0, topDeficit: null };
  let total = 0;
  let top: { label: string; have: number; need: number; ratio: number } | null = null;
  for (const [breakKey, profKey, label] of PER_CLASS_LABELS) {
    const required = breakdown[breakKey];
    const have = profile[profKey] as number | undefined;
    if (required == null || have == null) continue;
    const deficit = Math.max(0, required - have);
    if (deficit === 0) continue;
    const ratio = required > 0 ? Math.min(1, deficit / required) : 0;
    const penalty = Math.round(ratio * 10);
    total += penalty;
    if (!top || ratio > top.ratio) {
      top = { label, have, need: required, ratio };
    }
  }
  total = Math.min(total, 25);
  return {
    penalty: -total,
    topDeficit: top ? { label: top.label, have: top.have, need: top.need } : null,
  };
}

function ratingsHeld(p: ApplicantProfile): Set<string> {
  // CFI is implicit (the app's audience) so we always have it.
  const set = new Set<string>(["CFI"]);
  if (p.hasInstrument) set.add("Instrument");
  if (p.hasMultiEngine) {
    set.add("Multi-Engine");
    set.add("Multi");
  }
  if (p.hasCfii) {
    set.add("CFII");
    set.add("Instrument");
  }
  if (p.hasMei) {
    set.add("MEI");
    set.add("Multi-Engine");
  }
  return set;
}

/** Pull the 2-letter state code out of "Cleveland, OH" → "OH". */
function stateOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/,\s*([A-Z]{2})\b/);
  return m ? m[1] : null;
}

export function matchScore(listing: Listing, p: ApplicantProfile): MatchResult {
  let score = 50;
  const reasons: string[] = [];

  // 1. Hours required — biggest single factor for the low-time CFI cohort.
  //    If the listing has no parsed minimum, lean positive (assume reachable).
  if (typeof p.totalTime === "number" && p.totalTime >= 0) {
    if (listing.hoursRequired == null) {
      score += 5;
    } else {
      const need = listing.hoursRequired;
      const have = p.totalTime;
      if (have >= need) {
        score += 25;
        reasons.push(`you have the ${need.toLocaleString()}h minimum`);
      } else if (have >= need * 0.8) {
        score += 5;
        reasons.push(`needs ${need.toLocaleString()}h, you're close`);
      } else if (have >= need * 0.5) {
        score -= 15;
        reasons.push(`needs ${need.toLocaleString()}h (you're at ${have})`);
      } else {
        score -= 30;
        reasons.push(`needs ${need.toLocaleString()}h (you're at ${have})`);
      }
    }
  } else if (listing.hoursRequired && listing.hoursRequired >= 1500) {
    // No TT in profile → still penalize ATP-tier roles for the typical
    // sub-1500 audience, just less harshly.
    score -= 15;
    reasons.push(`needs ${listing.hoursRequired.toLocaleString()}h`);
  }

  // 2. Category — CFI cohort wants CFI/Part 91 time-build first.
  const cat = listing.jobCategory;
  if (cat && PREFERRED_CATEGORIES.has(cat)) {
    score += 15;
    if (reasons.length === 0) reasons.push("CFI / time-build category");
  } else if (cat && STRETCH_CATEGORIES.has(cat)) {
    score += 0; // neutral — stretch goals
  } else if (cat && OUT_OF_REACH.has(cat)) {
    score -= 10;
    reasons.push("airline-tier role");
  }

  // 3. Ratings — gentle reward for matches; no penalty for missing
  //    bonus ratings (CFII/MEI), since the listing might just list them
  //    as "preferred."
  if (Array.isArray(listing.ratingsRequired) && listing.ratingsRequired.length > 0) {
    const have = ratingsHeld(p);
    let matched = 0;
    let missing = 0;
    for (const r of listing.ratingsRequired) {
      if (have.has(r)) matched++;
      else missing++;
    }
    score += Math.min(10, matched * 3);
    score -= Math.min(10, missing * 3);
    if (missing > 0 && reasons.length === 0)
      reasons.push(`missing ${missing} listed rating${missing === 1 ? "" : "s"}`);
  }

  // 4. Location — bonus when the role is in the applicant's state.
  //    If they've said "willing to relocate," don't penalize out-of-state.
  const baseState = stateOf(p.baseLocation);
  if (baseState && listing.state) {
    if (listing.state === baseState) {
      score += 10;
      if (reasons.length === 0) reasons.push(`in your state (${baseState})`);
    } else if (!p.willingToRelocate) {
      score -= 15;
      if (reasons.length === 0)
        reasons.push(`out-of-state (${listing.state}) and you're not relocating`);
    } else {
      // Different state but they're flexible — neutral.
      score += 0;
    }
  }

  // 5. Freshness — listings posted in the last week get a small boost.
  const ageDays = (Date.now() - listing.postedAt) / 86400_000;
  if (ageDays <= 7) {
    score += 5;
  }

  // 6. Per-class deficit — when the listing names per-class minimums
  //    (e.g. 50 ME, 25 turbine) and the applicant has logged those
  //    classes, deduct up to 10 per class proportional to the gap,
  //    capped at -25 total. Skipped per-class when the applicant
  //    hasn't filled in that field.
  const { penalty, topDeficit } = perClassDeficit(listing.hoursBreakdown, p);
  score += penalty;

  // Clamp.
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Default reason if none bubbled up.
  let reason =
    reasons[0] ?? (score >= 75 ? "good fit" : score >= 50 ? "decent fit" : "stretch role");

  // Per-class deficit override: when the deficit is significant
  // (penalty ≤ -5), it dominates the picture — surface it as the
  // reason regardless of which other factor bubbled up first.
  if (topDeficit && penalty <= -5) {
    reason = `Short ${topDeficit.need - topDeficit.have} ${topDeficit.label} hours of ${topDeficit.need} required`;
  }

  return { score, tier: tierOf(score), reason };
}
