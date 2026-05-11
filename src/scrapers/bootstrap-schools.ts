/**
 * One-time bootstrap: scrape faaflightschools.com to produce
 * data/flight-schools.json — a seed list of US flight schools with their
 * websites, used by the `flight-schools` adapter to look for CFI/instructor
 * job postings on each school's careers page.
 *
 * Source: https://www.faaflightschools.com/airplane-schools/ (all 601 listings
 * render on a single static HTML page; each school links to a detail page at
 * /school_detail.php?id_fls=ID where the school's external website URL lives).
 *
 * Run manually when refreshing the seed:
 *   bun src/scrapers/bootstrap-schools.ts
 *
 * Filters to US states (2-letter codes); international "- International Only -"
 * entries are skipped. Output is committed to git so the adapter has data on
 * first run without needing to re-scrape.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const LISTING_URL = "https://www.faaflightschools.com/airplane-schools/";
const DETAIL_URL = (id: string) => `https://www.faaflightschools.com/school_detail.php?id_fls=${id}`;
const OUTPUT = "data/flight-schools.json";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const REQUEST_DELAY_MS = 200;

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI","GU",
]);

type SchoolStub = { id: string; name: string; city: string; state: string };
export type School = SchoolStub & { website: string | null };

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Each card on the listing page repeats this pattern:
//   <h3 class="text-lg font-bold ...">SCHOOL NAME</h3>
//   ...
//   <p class="text-sm text-on-surface-variant">CITY, STATE_NAME (STATE_CODE)</p>
//   ...
//   <a ... href="/school_detail.php?id_fls=ID">View profile</a>
const CARD_RE =
  /<h3\s+class="text-lg font-bold[^"]*"[^>]*>([^<]+)<\/h3>[\s\S]{0,400}?<p\s+class="text-sm text-on-surface-variant"[^>]*>\s*([^<(]+)\(([^)]+)\)\s*<\/p>[\s\S]*?id_fls=(\d+)/g;

function parseListing(html: string): SchoolStub[] {
  CARD_RE.lastIndex = 0;
  const out: SchoolStub[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = CARD_RE.exec(html)) !== null) {
    const [, rawName, rawCityState, rawCode, id] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = decode(rawName);
    const code = decode(rawCode);
    const cityState = decode(rawCityState);
    const lastComma = cityState.lastIndexOf(",");
    const city = lastComma >= 0 ? cityState.slice(0, lastComma).trim() : cityState;
    out.push({ id, name, city, state: code });
  }
  return out;
}

const WEBSITE_RE = /href="(https?:\/\/[^"]+)"[^>]*>\s*Visit website\s*</i;

function parseWebsite(html: string): string | null {
  const m = html.match(WEBSITE_RE);
  if (!m) return null;
  const url = m[1].trim();
  if (/faaflightschools\.com/i.test(url)) return null;
  return url;
}

async function main() {
  console.log("[bootstrap] fetching directory listing…");
  const listingHtml = await fetchText(LISTING_URL);
  if (!listingHtml) {
    console.error("[bootstrap] listing fetch failed");
    process.exit(1);
  }
  const all = parseListing(listingHtml);
  console.log(`[bootstrap] parsed ${all.length} schools (all regions)`);

  const usOnly = all.filter((s) => US_STATES.has(s.state.toUpperCase()));
  console.log(`[bootstrap] ${usOnly.length} US schools after filtering`);

  console.log(`[bootstrap] fetching ${usOnly.length} detail pages (concurrency ${CONCURRENCY})…`);
  const results: School[] = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < usOnly.length) {
      const idx = cursor++;
      const stub = usOnly[idx];
      const html = await fetchText(DETAIL_URL(stub.id));
      let website: string | null = null;
      if (html) website = parseWebsite(html);
      results.push({ ...stub, website });
      done++;
      if (done % 25 === 0) console.log(`[bootstrap] ${done}/${usOnly.length}`);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  results.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  const withSite = results.filter((s) => s.website).length;
  console.log(`[bootstrap] ${withSite}/${results.length} schools have websites`);

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(results, null, 2));
  console.log(`[bootstrap] wrote ${OUTPUT}`);
}

main();
