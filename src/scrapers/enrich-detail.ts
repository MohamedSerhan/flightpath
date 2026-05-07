/**
 * Detail-page enrichment.
 *
 * Adapter `fetch()` returns a thin RawListing — usually just title +
 * employer + location + post date, because the index page rarely has
 * structured fields. This module fetches the original posting URL and
 * re-runs hour / rating / pay extraction on the *full* description.
 *
 * Runs after the bulk insert, only for listings missing structured
 * fields. Capped at MAX_PER_RUN to avoid hammering source sites.
 */

import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listings } from "../db/schema.ts";
import { extractHoursRequired, extractRatings } from "./enrich.ts";

const MAX_PER_RUN = 25;
const REQUEST_DELAY_MS = 750;
const FRESHNESS_DAYS = 30;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

const PAY_RE = /(?:\$\s*\d{2,3}(?:,\d{3})?(?:\.\d+)?(?:k\b|\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annually|annual))?\s*(?:to|-|–|—)?\s*\$?\s*\d{2,3}(?:,\d{3})?(?:\.\d+)?(?:k\b|\s*(?:per|\/)?\s*(?:hour|hr|year|yr|annually|annual))?)/i;

function extractPay(description: string): string | null {
  const m = description.match(PAY_RE);
  return m ? m[0].trim() : null;
}

async function fetchDetail(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html")) return null;
    const html = await res.text();
    return stripTags(html).slice(0, 50_000);
  } catch {
    return null;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function enrichDetailPages(): Promise<void> {
  const cutoff = Date.now() - FRESHNESS_DAYS * 86400_000;

  const candidates = await db
    .select({ id: listings.id, url: listings.url, title: listings.title, description: listings.description })
    .from(listings)
    .where(
      and(
        gte(listings.postedAt, cutoff),
        or(
          isNull(listings.hoursRequired),
          isNull(listings.ratingsRequired),
          isNull(listings.description),
          eq(sql`length(coalesce(${listings.description}, ''))`, 0),
        )!,
      ),
    )
    .limit(MAX_PER_RUN);

  if (candidates.length === 0) {
    console.log("[detail] nothing to enrich");
    return;
  }

  console.log(`[detail] enriching ${candidates.length} listings…`);
  let updated = 0;

  for (const row of candidates) {
    const detailText = await fetchDetail(row.url);
    if (!detailText || detailText.length < 200) {
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    const fullText = `${row.title}\n${row.description ?? ""}\n${detailText}`;
    const hoursRequired = extractHoursRequired(fullText);
    const ratings = extractRatings(fullText);
    const pay = extractPay(detailText);

    const existingDesc = (row.description ?? "").trim();
    const newDesc =
      existingDesc.length > 200
        ? existingDesc
        : detailText.slice(0, 4000);
    const descWithPay = pay && !newDesc.includes(pay) ? `${pay}\n\n${newDesc}` : newDesc;

    await db
      .update(listings)
      .set({
        hoursRequired: hoursRequired ?? null,
        ratingsRequired: ratings ? JSON.stringify(ratings) : null,
        description: descWithPay,
      })
      .where(eq(listings.id, row.id));
    updated++;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[detail] updated ${updated} listings`);
}

if (import.meta.main) {
  enrichDetailPages().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
