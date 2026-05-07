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

import type { Listing } from "../shared/types.ts";
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
 *  defaults; downstream UI can tweak via the profile if needed. */
const PREFERRED_CATEGORIES = new Set(["cfi", "cfii", "mei", "part91"]);
const STRETCH_CATEGORIES = new Set(["part135", "corporate"]);
const OUT_OF_REACH = new Set(["airline"]);

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

  // Clamp.
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Default reason if none bubbled up.
  const reason =
    reasons[0] ?? (score >= 75 ? "good fit" : score >= 50 ? "decent fit" : "stretch role");
  return { score, tier: tierOf(score), reason };
}
