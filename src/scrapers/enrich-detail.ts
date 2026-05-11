/**
 * Detail-page enrichment + freshness validation.
 *
 * The index-page scrape gives us a thin RawListing — usually just title,
 * employer, location, and (sometimes) a post date. Several sources
 * (PCC, Climbto350) don't expose the post date at all, so we default
 * to Date.now() and the listing looks artificially fresh forever.
 *
 * This pass fixes that by fetching the original posting URL and:
 *
 *   1. Detecting "this position has been closed" markers — if found,
 *      hard-delete the row. Stale listings shouldn't pollute the
 *      30-day window.
 *
 *   2. Parsing the real post date from JSON-LD JobPosting markup
 *      (`"datePosted":"YYYY-MM-DD"`), an OG meta tag, or a visible
 *      "Posted DD-MMM-YYYY" string. If we find one, update postedAt.
 *      This naturally evicts listings older than 30 days from the UI
 *      without us doing anything.
 *
 *   3. Hours / ratings / pay extraction from the full description
 *      (the original behavior).
 *
 * Selection: any listing within the 30-day window that hasn't been
 * enriched in the last 7 days. Capped at MAX_PER_RUN to bound the
 * runtime of each cron tick.
 */

import { and, eq, gte, lt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listings } from "../db/schema.ts";
import { extractHoursRequired, extractRatings } from "./enrich.ts";

// CI runner capacity is generous; the bottleneck is source-server politeness.
// 500 fetches × 250ms = ~2 min steady-state, plus actual response latency.
const MAX_PER_RUN = 500;
const REQUEST_DELAY_MS = 200;
const FRESHNESS_DAYS = 30;
const REENRICH_AFTER_DAYS = 7;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Markers that mean "stop showing this — the role is closed."
// Tested against ApplicantPro, iCIMS, Workday, Greenhouse, Lever, Workable,
// and a handful of custom careers pages.
const CLOSED_RE =
  /(this\s+position\s+(has\s+been\s+)?closed|no\s+longer\s+(?:accepting\s+(?:applications|new\s+applicants)|available|hiring|open|active)|this\s+job\s+(has\s+)?expired|position\s+(has\s+)?been\s+filled|posting\s+(has\s+)?(?:expired|closed)|this\s+opportunity\s+is\s+no\s+longer|application\s+window\s+(?:has\s+)?closed|hiring\s+for\s+this\s+role\s+(has\s+)?ended)/i;

// Aggregators (notably PCC) sometimes ship listings whose `JobUrl` is just
// the employer's generic careers landing page rather than a per-job link.
// Clicking through dumps the user on a "Careers — Apply Now" homepage with
// no specific role to evaluate. Detect by URL shape: a hostname plus a
// single path segment matching well-known landing slugs, with no further
// path. These are unactionable; mark them closed.
const GENERIC_LANDING_SLUG_RE =
  /^(career|careers|job|jobs|employment|hiring|opportunities|positions|join-us|join-our-team|work-with-us|work-for-us|apply|apply-now|recruitment|recruiting|hr|human-resources)$/i;

function isGenericLandingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return true; // bare hostname, e.g. https://example.com/
    if (segments.length === 1) return GENERIC_LANDING_SLUG_RE.test(segments[0]);
    return false;
  } catch {
    return false;
  }
}

function stripTags(s: string): string {
  // Decode entities FIRST so any encoded HTML (`&lt;div&gt;` from
  // Greenhouse / similar APIs) becomes real tags before the strip pass.
  // Otherwise the regex leaves encoded tags as literal text in the
  // output.
  const decoded = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&copy;/g, "(c)")
    .replace(/&trade;/g, "(tm)")
    .replace(/&reg;/g, "(R)")
    .replace(/&hellip;/g, "...")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    // Numeric character refs — handle both decimal (`&#039;`) and hex
    // (`&#x27;`). Greenhouse + WordPress sites sometimes emit these
    // even after the API has supposedly returned plain text. Includes
    // wide-char dashes like &#8211; (en-dash) and &#8217; (right single
    // quote) which are extremely common in copy-edited job descriptions.
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull the cleanest description we can find. Layered, in priority order:
 *
 *   1. JSON-LD JobPosting `description` — schema.org format used by ATP,
 *      Greenhouse, Workday, ApplicantPro, FlightSafety, and most modern
 *      ATSes. Already an HTML fragment scoped to the role; strip tags and
 *      we're done.
 *   2. og:description / meta description — used by older sites and some
 *      WordPress careers pages. Short but clean.
 *   3. Last resort: stripped page text, truncated at the first CSS marker.
 *      Some pages embed inline `<style>` content as raw text in the body
 *      (e.g. WordPress + normalize.css), so we cut on `/*!`, `@import`,
 *      `@media`, or a clearly-CSS run of selectors. */
function extractDescription(html: string, fallbackText: string): string | null {
  // 1. JSON-LD JobPosting (most reliable).
  const ldMatches = Array.from(
    html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  );
  for (const m of ldMatches) {
    try {
      const obj = JSON.parse(m[1]);
      const candidates = Array.isArray(obj) ? obj : [obj];
      for (const c of candidates) {
        if ((c["@type"] === "JobPosting" || (Array.isArray(c["@type"]) && c["@type"].includes("JobPosting"))) && typeof c.description === "string") {
          const cleaned = stripTags(c.description).trim();
          if (cleaned.length > 50) return cleaned.slice(0, 4000);
        }
      }
    } catch {
      /* malformed JSON-LD — skip */
    }
  }

  // 2. og:description / description meta. Run through stripTags to
  //    decode HTML entities (&amp;, &#39;, &quot;, etc.) embedded in
  //    attribute values; the regex doesn't decode those automatically.
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{60,})["']/i);
  if (og) return stripTags(og[1]).slice(0, 4000);
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{60,})["']/i);
  if (desc) return stripTags(desc[1]).slice(0, 4000);

  // 3. Stripped page text, cut at any CSS marker. The cut points stop the
  //    scraper from leaking normalize.css and similar inline stylesheets
  //    that some templates render outside <style> tags.
  const cssCutAt = (() => {
    const markers = [/\/\*!/, /@import\b/, /@media\b/, /\bhtml\s*\{[^}]+font/i];
    let earliest = fallbackText.length;
    for (const re of markers) {
      const m = fallbackText.search(re);
      if (m >= 0 && m < earliest) earliest = m;
    }
    return earliest;
  })();
  const trimmed = fallbackText.slice(0, cssCutAt).trim();
  return trimmed.length > 0 ? trimmed.slice(0, 4000) : null;
}

const PAY_RE =
  /(?:\$\s*\d{2,3}(?:,\d{3})?(?:\.\d+)?(?:k\b|\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annually|annual))?\s*(?:to|-|–|—)?\s*\$?\s*\d{2,3}(?:,\d{3})?(?:\.\d+)?(?:k\b|\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annually|annual))?)/i;

function extractPay(description: string): string | null {
  const m = description.match(PAY_RE);
  return m ? m[0].trim() : null;
}

// US state name → 2-letter abbreviation (lower-cased keys for lookup).
const STATE_NAMES: Record<string, string> = {
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

function abbrevState(s: string): string {
  return STATE_NAMES[s.toLowerCase().trim()] ?? s.trim();
}

/** Parse a city/state location from page HTML before tag-stripping.
 *  Walks several signals in order of reliability. */
function extractLocation(html: string): string | null {
  // 1. JSON-LD jobLocation. Two shapes — object or array of Places.
  //    Used by ATP/Breezy, Greenhouse, FlightSafety, Workday-modern.
  const ld = html.match(
    /"jobLocation"[\s\S]{0,800}?"addressLocality"\s*:\s*"([^"]+)"[\s\S]{0,400}?"addressRegion"\s*:\s*"([^"]+)"/i,
  );
  if (ld) return `${ld[1].trim()}, ${abbrevState(ld[2])}`;

  // 2. Page <title> patterns. Two delimiters in real-world data:
  //      "Job Title - City, ST - …"   (FindAPilot)
  //      "Job Title | City, ST | …"   (FlightSafety, some Workday)
  const titleEl = html.match(/<title>([^<]+)<\/title>/i);
  if (titleEl) {
    const t = titleEl[1].replace(/\s+/g, " ").trim();
    const dashCity = t.match(/[-|]\s*([A-Z][A-Za-z .']+,\s*[A-Z]{2})\s*[-|]/);
    if (dashCity) return dashCity[1];
    const atCity = t.match(/(?:in|at)\s+([A-Z][A-Za-z .']+,\s*[A-Z]{2})\b/);
    if (atCity) return atCity[1];
  }

  // 3. OG title fallback.
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) {
    const m = og[1].match(/[-|]\s*([A-Z][A-Za-z .']+,\s*[A-Z]{2})\b/);
    if (m) return m[1];
  }

  // 4. Last resort: a visible ">City, ST<" anywhere in the body.
  //    Risky on long pages (could match "see San Francisco, CA office") so
  //    we only use this if the match appears within the first 30K chars
  //    of the doc, where the job header usually lives.
  const head = html.slice(0, 30_000);
  const visible = head.match(/>\s*([A-Z][A-Za-z .']{2,30},\s*[A-Z]{2})\s*</);
  if (visible) return visible[1];

  return null;
}

/** Parse a real post date from page HTML before tag-stripping. */
function extractPostDate(html: string): number | null {
  // 1. JSON-LD JobPosting (most reliable, used by ATP/Breezy, Greenhouse, etc.)
  const ld = html.match(/"datePosted"\s*:\s*"([^"]+)"/i);
  if (ld) {
    const t = Date.parse(ld[1]);
    if (Number.isFinite(t)) return t;
  }
  // 2. OG meta
  const og = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i);
  if (og) {
    const t = Date.parse(og[1]);
    if (Number.isFinite(t)) return t;
  }
  // 3. Visible "Posted DD-MMM-YYYY" / "Posted YYYY-MM-DD" / "Posted MM/DD/YYYY" patterns
  const visible = html.match(
    /Posted\s+(\d{1,2}[-/]\w{3}[-/]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i,
  );
  if (visible) {
    const t = Date.parse(visible[1].replace(/-/g, " "));
    if (Number.isFinite(t)) return t;
  }
  return null;
}

type FetchResult = { html: string } | { gone: true } | { transient: true };

async function fetchDetail(url: string): Promise<FetchResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ac.signal,
    });
    // 404/410 = permanently gone. ApplicantPro and most ATSes return 404
    // when a posting is fully removed. Delete the row instead of retrying
    // forever.
    if (res.status === 404 || res.status === 410) return { gone: true };
    if (!res.ok) return { transient: true };
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html")) return { transient: true };
    return { html: (await res.text()).slice(0, 200_000) };
  } catch {
    return { transient: true };
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function enrichDetailPages(): Promise<void> {
  const cutoff = Date.now() - FRESHNESS_DAYS * 86400_000;
  const reenrichBefore = Date.now() - REENRICH_AFTER_DAYS * 86400_000;

  // 1-hour grace before re-attempting a missing-location row. The cron
  // runs every 4 hours, so each tick retries (3+ retries per day) — fast
  // enough that newly-deployed extraction logic flushes the backlog the
  // same day, slow enough that we're not hammering any one source.
  const retryMissingLocBefore = Date.now() - 3600_000;

  const candidates = await db
    .select({
      id: listings.id,
      url: listings.url,
      title: listings.title,
      description: listings.description,
      location: listings.location,
    })
    .from(listings)
    .where(
      and(
        eq(listings.isClosed, 0),
        gte(listings.postedAt, cutoff),
        or(
          isNull(listings.enrichedAt),
          lt(listings.enrichedAt, reenrichBefore),
          and(isNull(listings.location), lt(listings.enrichedAt, retryMissingLocBefore))!,
        )!,
      ),
    )
    .limit(MAX_PER_RUN);

  if (candidates.length === 0) {
    console.log("[detail] nothing to enrich");
    return;
  }

  console.log(`[detail] checking ${candidates.length} listings for closure / real post date…`);
  let closed = 0;
  let gone = 0;
  let landing = 0;
  let dated = 0;
  let located = 0;
  let updated = 0;

  for (const row of candidates) {
    // Cheap URL-shape pre-check: if the URL is a generic careers landing
    // page (no per-job segment), the listing is unactionable. Skip the
    // detail fetch entirely.
    if (isGenericLandingUrl(row.url)) {
      await db
        .update(listings)
        .set({ isClosed: 1, enrichedAt: Date.now() })
        .where(eq(listings.id, row.id));
      landing++;
      continue;
    }

    const result = await fetchDetail(row.url);
    if ("gone" in result) {
      await db
        .update(listings)
        .set({ isClosed: 1, enrichedAt: Date.now() })
        .where(eq(listings.id, row.id));
      gone++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    if ("transient" in result) {
      // 5xx, timeout, non-HTML — try again next run; don't update enriched_at.
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    const { html } = result;
    const text = stripTags(html);

    // 1. Closed-position check on the rendered text.
    if (CLOSED_RE.test(text)) {
      await db
        .update(listings)
        .set({ isClosed: 1, enrichedAt: Date.now() })
        .where(eq(listings.id, row.id));
      closed++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    // 2. Real post date and location if available.
    const realDate = extractPostDate(html);
    // Re-enrich location if missing OR if currently set to a non-state-abbreviated
    // form (Workday's "Las Vegas" without state, etc.). The detail page usually
    // has more precise data.
    const currentLocHasState = /,\s*[A-Z]{2}\b/.test(row.location ?? "");
    const realLocation = !currentLocHasState ? extractLocation(html) : null;

    // 3. Other enrichment.
    const fullText = `${row.title}\n${row.description ?? ""}\n${text}`;
    const hoursRequired = extractHoursRequired(fullText);
    const ratings = extractRatings(fullText);
    const pay = extractPay(text);
    const existingDesc = (row.description ?? "").trim();
    // Prefer a clean source-extracted description (JSON-LD / og / cut-at-CSS)
    // over the raw stripped page text. Falls back to existing description if
    // the new extraction comes up empty.
    const cleanNew = extractDescription(html, text);
    const newDesc =
      existingDesc.length > 200
        ? existingDesc
        : (cleanNew ?? text.slice(0, 4000));
    const descWithPay = pay && !newDesc.includes(pay) ? `${pay}\n\n${newDesc}` : newDesc;

    const setValues: Record<string, number | string | null> = {
      hoursRequired: hoursRequired ?? null,
      ratingsRequired: ratings ? JSON.stringify(ratings) : null,
      description: descWithPay,
      enrichedAt: Date.now(),
    };
    if (realDate !== null) {
      setValues.postedAt = realDate;
      // Detail enrichment found a real source date — flip the accuracy
      // flag so the UI stops showing "Indexed N days ago" for this row.
      setValues.postedAtAccurate = 1;
      dated++;
    }
    if (realLocation) {
      setValues.location = realLocation;
      located++;
      // Re-derive state from the new location so downstream filters work.
      const stateMatch = realLocation.match(/,\s*([A-Z]{2})\b/);
      if (stateMatch) setValues.state = stateMatch[1];
    }

    await db.update(listings).set(setValues).where(eq(listings.id, row.id));
    updated++;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[detail] checked ${candidates.length}: ${closed} closed + ${gone} gone + ${landing} landing-only, ${dated} dated, ${located} located, ${updated} updated`,
  );
}

if (import.meta.main) {
  enrichDetailPages().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
