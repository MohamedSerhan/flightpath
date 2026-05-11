import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Flight Schools (faaflightschools.com seed) — walks small US flight-school
 * websites looking for CFI / flight-instructor postings that don't show up
 * on any aggregator. Most small Part 61/141 schools advertise their CFI
 * openings only on their own /careers page (or in a banner on the homepage)
 * and never list on JSfirm / AOPA JDN / Adzuna. That's the gap this fills.
 *
 * Seed: data/flight-schools.json (committed; refreshed by
 * `bun src/scrapers/bootstrap-schools.ts`). ~500 US schools with website URLs.
 *
 * Per-run budget: rotate through BATCH_SIZE schools each tick (based on the
 * scheduled run interval). At the configured cron of every 4 hours, the full
 * list cycles every ~3 days.
 *
 * Confidence filter: a school is only emitted as a listing when its careers
 * page contains BOTH a flight-instructor keyword AND an active-hiring phrase
 * ("now hiring", "open position", "we're looking for", etc.). Without the
 * latter, schools that merely *describe* their CFI ranks (every school does)
 * would all become listings.
 */

type School = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
};

const SEED_PATH = "data/flight-schools.json";

const BATCH_SIZE = 30;
const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_DELAY_MS = 250;
const ROTATION_BUCKET_MS = 4 * 3600_000; // matches the scheduled scrape cadence

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CAREERS_PATHS = [
  "/careers",
  "/careers/",
  "/jobs",
  "/jobs/",
  "/employment",
  "/employment/",
  "/cfi-jobs",
  "/cfi-jobs/",
  "/flight-instructor-jobs",
  "/work-with-us",
  "/join-our-team",
  "/about/careers",
  "/about/employment",
];

const INSTRUCTOR_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|ground\s+instructor)\b/i;

// Apostrophe variants ['’] are required (not optional) for "we're"
// patterns — without them, "we were looking for" on Squarespace soft-404
// pages was matching as a false hiring signal.
const HIRING_RE =
  /\b(now\s+hiring|we['’]re\s+hiring|we\s+are\s+hiring|currently\s+hiring|hiring\s+(?:cfis?|flight\s+instructors?|instructor)|we['’]re\s+looking\s+for|we\s+are\s+looking\s+for|looking\s+to\s+hire|join\s+our\s+team|apply\s+(?:now|today|here)|open\s+position|career\s+opportunit|employment\s+opportunit)\b/i;

// Soft-404 detector — many Squarespace / Wix / Wordpress themes return
// HTTP 200 with a "page not found" body. Without this, a page that has
// "join our team" boilerplate in its header nav + a 404 message would still
// match our hiring regex and produce a useless listing.
const SOFT_404_RE =
  /\b(?:page\s+(?:not\s+found|you\s+(?:were|are)\s+looking\s+for)|404\s*(?:[-—:]|error|not\s+found)|this\s+page\s+(?:doesn['’]?t|does\s+not)\s+exist|sorry,?\s+(?:we\s+can['’]?t|the\s+page\s+you))/i;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// On a school homepage, "flight instructor training" (a service) and
// "Apply Now" (a student-enrollment CTA) often appear in completely
// unrelated parts of the page. Require the two signals to co-occur within
// a short window when matching outside an explicit careers URL.
const COOCCURRENCE_WINDOW = 400;

function isCareersUrl(url: string): boolean {
  return /\/(careers?|jobs?|employment|hiring|cfi-jobs?|flight-instructor-jobs?|work-with-us|join)\b/i.test(url);
}

function hasCooccurringMatch(text: string): boolean {
  const instr = text.match(INSTRUCTOR_RE);
  if (!instr || instr.index === undefined) return false;
  const start = Math.max(0, instr.index - COOCCURRENCE_WINDOW);
  const end = Math.min(text.length, instr.index + instr[0].length + COOCCURRENCE_WINDOW);
  return HIRING_RE.test(text.slice(start, end));
}

function isMatch(url: string, text: string): boolean {
  if (SOFT_404_RE.test(text)) return false;
  if (!INSTRUCTOR_RE.test(text) || !HIRING_RE.test(text)) return false;
  // Careers-style URLs get the loose match — the page's purpose is hiring,
  // so a generic "join our team" footer is enough confirmation.
  if (isCareersUrl(url)) return true;
  // Anywhere else (homepage, /about, etc.), require the keywords to be
  // physically near each other to weed out unrelated co-occurrence.
  return hasCooccurringMatch(text);
}

function loadSeed(): School[] {
  const path = join(process.cwd(), SEED_PATH);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const all = JSON.parse(raw) as School[];
    return all.filter((s) => !!s.website);
  } catch {
    return [];
  }
}

function pickBatch(schools: School[], now: number): School[] {
  if (schools.length === 0) return [];
  const tick = Math.floor(now / ROTATION_BUCKET_MS);
  const start = (tick * BATCH_SIZE) % schools.length;
  const out: School[] = [];
  for (let i = 0; i < BATCH_SIZE && i < schools.length; i++) {
    out.push(schools[(start + i) % schools.length]);
  }
  return out;
}

async function fetchText(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ac.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/html|text/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBase(website: string): string | null {
  try {
    const u = new URL(website);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function findCareersLinks(homepageHtml: string, base: string): string[] {
  const out = new Set<string>();
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(homepageHtml)) !== null) {
    const href = m[1];
    const text = stripTags(m[2]);
    if (!/\b(career|careers|jobs?|employment|hiring|join\s+(?:our|the)\s+team|work\s+with\s+us)\b/i.test(text + " " + href)) {
      continue;
    }
    let abs: string | null = null;
    try {
      abs = new URL(href, base + "/").toString();
    } catch {
      continue;
    }
    // Stay on the same host — avoid wandering into Indeed/LinkedIn pages.
    try {
      const u = new URL(abs);
      const bu = new URL(base);
      if (u.host !== bu.host) continue;
    } catch {
      continue;
    }
    out.add(abs);
    if (out.size >= 3) break;
  }
  return Array.from(out);
}

function snippet(text: string): string {
  // Pull a short excerpt around the strongest match for the description field.
  const lower = text.toLowerCase();
  const idx = (() => {
    const k = lower.search(INSTRUCTOR_RE);
    if (k >= 0) return k;
    return lower.search(HIRING_RE);
  })();
  if (idx < 0) return text.slice(0, 240);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 200);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

async function probeSchool(school: School): Promise<RawListing | null> {
  if (!school.website) return null;
  const base = normalizeBase(school.website);
  if (!base) return null;

  // Build a candidate-URL queue: the website URL itself, then common
  // careers paths, then any careers-style links found on the homepage.
  const tried = new Set<string>();
  const queue: string[] = [school.website, ...CAREERS_PATHS.map((p) => base + p)];

  let homepageHtml: string | null = null;
  let bestMatch: { url: string; text: string } | null = null;

  for (const candidate of queue) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const html = await fetchText(candidate);
    if (!html) continue;
    if (candidate === school.website) homepageHtml = html;
    const text = stripTags(html);
    if (isMatch(candidate, text)) {
      bestMatch = { url: candidate, text };
      break;
    }
  }

  // If nothing matched yet, follow careers-style anchors on the homepage.
  if (!bestMatch && homepageHtml) {
    const links = findCareersLinks(homepageHtml, base);
    for (const link of links) {
      if (tried.has(link)) continue;
      tried.add(link);
      const html = await fetchText(link);
      if (!html) continue;
      const text = stripTags(html);
      if (isMatch(link, text)) {
        bestMatch = { url: link, text };
        break;
      }
    }
  }

  if (!bestMatch) return null;

  return {
    externalId: `flight-schools-${school.id}`,
    title: `Flight Instructor — ${school.name}`,
    url: bestMatch.url,
    description: snippet(bestMatch.text),
    employer: school.name,
    location: `${school.city.replace(/,\s*[A-Z]{2}$/, "")}, ${school.state}`.trim(),
    postedAt: Date.now(),
  };
}

export const flightSchoolsAdapter: SourceAdapter = {
  id: "flight-schools",
  name: "Flight Schools (CFI hiring)",
  async fetch(): Promise<RawListing[]> {
    const all = loadSeed();
    if (all.length === 0) {
      console.log("[flight-schools] no seed data — run bootstrap-schools.ts");
      return [];
    }
    // FLIGHT_SCHOOLS_FULL=1 disables rotation and probes every school.
    // Use this for the initial DB seed; afterward the cron's rotation
    // covers the full list every ~3 days and the cached listings stay
    // warm in SQLite.
    const fullScan = process.env.FLIGHT_SCHOOLS_FULL === "1";
    const batch = fullScan ? all : pickBatch(all, Date.now());
    console.log(
      `[flight-schools] probing ${batch.length}/${all.length} schools${fullScan ? " (full scan)" : ""}…`,
    );

    const out: RawListing[] = [];
    let i = 0;

    async function worker() {
      while (i < batch.length) {
        const idx = i++;
        const school = batch[idx];
        try {
          const listing = await probeSchool(school);
          if (listing) out.push(listing);
        } catch {
          // Swallow per-school errors — one broken site shouldn't kill the run.
        }
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    console.log(`[flight-schools] matched ${out.length} schools with active hiring signal`);
    return out;
  },
};
