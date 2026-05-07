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

const MAX_PER_RUN = 200;
const REQUEST_DELAY_MS = 250;
const FRESHNESS_DAYS = 30;
const REENRICH_AFTER_DAYS = 7;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Markers that mean "stop showing this — the role is closed."
// Tested against ApplicantPro, iCIMS, Workday, Greenhouse, Lever, Workable,
// and a handful of custom careers pages.
const CLOSED_RE =
  /(this\s+position\s+(has\s+been\s+)?closed|no\s+longer\s+(?:accepting\s+(?:applications|new\s+applicants)|available|hiring|open|active)|this\s+job\s+(has\s+)?expired|position\s+(has\s+)?been\s+filled|posting\s+(has\s+)?(?:expired|closed)|this\s+opportunity\s+is\s+no\s+longer|application\s+window\s+(?:has\s+)?closed|hiring\s+for\s+this\s+role\s+(has\s+)?ended)/i;

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const PAY_RE =
  /(?:\$\s*\d{2,3}(?:,\d{3})?(?:\.\d+)?(?:k\b|\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annually|annual))?\s*(?:to|-|–|—)?\s*\$?\s*\d{2,3}(?:,\d{3})?(?:\.\d+)?(?:k\b|\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annually|annual))?)/i;

function extractPay(description: string): string | null {
  const m = description.match(PAY_RE);
  return m ? m[0].trim() : null;
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

  const candidates = await db
    .select({ id: listings.id, url: listings.url, title: listings.title, description: listings.description })
    .from(listings)
    .where(
      and(
        eq(listings.isClosed, 0),
        gte(listings.postedAt, cutoff),
        or(isNull(listings.enrichedAt), lt(listings.enrichedAt, reenrichBefore))!,
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
  let dated = 0;
  let updated = 0;

  for (const row of candidates) {
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

    // 2. Real post date if available.
    const realDate = extractPostDate(html);

    // 3. Other enrichment.
    const fullText = `${row.title}\n${row.description ?? ""}\n${text}`;
    const hoursRequired = extractHoursRequired(fullText);
    const ratings = extractRatings(fullText);
    const pay = extractPay(text);
    const existingDesc = (row.description ?? "").trim();
    const newDesc =
      existingDesc.length > 200 ? existingDesc : text.slice(0, 4000);
    const descWithPay = pay && !newDesc.includes(pay) ? `${pay}\n\n${newDesc}` : newDesc;

    const setValues: Record<string, number | string | null> = {
      hoursRequired: hoursRequired ?? null,
      ratingsRequired: ratings ? JSON.stringify(ratings) : null,
      description: descWithPay,
      enrichedAt: Date.now(),
    };
    if (realDate !== null) {
      setValues.postedAt = realDate;
      dated++;
    }

    await db.update(listings).set(setValues).where(eq(listings.id, row.id));
    updated++;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[detail] checked ${candidates.length}: ${closed} closed + ${gone} gone (both deleted), ${dated} dated, ${updated} updated`,
  );
}

if (import.meta.main) {
  enrichDetailPages().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
