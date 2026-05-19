import type { RawListing } from "../types.ts";
import type { JobCategory } from "../../shared/types.ts";

export type Company = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
};

export type ProbeOptions = {
  /** Source-id prefix for the emitted RawListing.externalId. Final form
   *  is `<sourceId>-<company.id>`. */
  sourceId: string;
  /** Builds the listing title from the matched company. */
  titleTemplate: (c: Company) => string;
  /** Optional category to carry through as RawListing.categoryHint. */
  categoryHint?: JobCategory;
};

const REQUEST_TIMEOUT_MS = 12_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const CAREERS_PATHS = [
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

export const INSTRUCTOR_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor\s+pilot|ground\s+instructor)\b/i;

// Apostrophe variants ['’] are required (not optional) for "we're"
// patterns — without them, "we were looking for" on Squarespace soft-404
// pages was matching as a false hiring signal.
export const HIRING_RE =
  /\b(now\s+hiring|we['’]re\s+hiring|we\s+are\s+hiring|currently\s+hiring|hiring\s+(?:cfis?|flight\s+instructors?|instructor|pilots?)|we['’]re\s+looking\s+for|we\s+are\s+looking\s+for|looking\s+to\s+hire|join\s+our\s+team|apply\s+(?:now|today|here)|open\s+position|career\s+opportunit|employment\s+opportunit)\b/i;

// Soft-404 detector — many Squarespace / Wix / Wordpress themes return
// HTTP 200 with a "page not found" body.
export const SOFT_404_RE =
  /\b(?:page\s+(?:not\s+found|you\s+(?:were|are)\s+looking\s+for)|404\s*(?:[-—:]|error|not\s+found)|this\s+page\s+(?:doesn['’]?t|does\s+not)\s+exist|sorry,?\s+(?:we\s+can['’]?t|the\s+page\s+you))/i;

const COOCCURRENCE_WINDOW = 400;

export function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function isCareersUrl(url: string): boolean {
  return /\/(careers?|jobs?|employment|hiring|cfi-jobs?|flight-instructor-jobs?|work-with-us|join)\b/i.test(url);
}

function hasCooccurringMatch(text: string, instructorRe: RegExp, hiringRe: RegExp): boolean {
  const instr = text.match(instructorRe);
  if (!instr || instr.index === undefined) return false;
  const start = Math.max(0, instr.index - COOCCURRENCE_WINDOW);
  const end = Math.min(text.length, instr.index + instr[0].length + COOCCURRENCE_WINDOW);
  return hiringRe.test(text.slice(start, end));
}

export function isMatch(
  url: string,
  text: string,
  instructorRe: RegExp = INSTRUCTOR_RE,
  hiringRe: RegExp = HIRING_RE,
): boolean {
  if (SOFT_404_RE.test(text)) return false;
  if (!instructorRe.test(text) || !hiringRe.test(text)) return false;
  if (isCareersUrl(url)) return true;
  return hasCooccurringMatch(text, instructorRe, hiringRe);
}

export function normalizeBase(website: string): string | null {
  try {
    const u = new URL(website);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function normalizeHostKey(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function fetchText(url: string): Promise<string | null> {
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

export function findCareersLinks(homepageHtml: string, base: string): string[] {
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

function snippet(text: string, instructorRe: RegExp, hiringRe: RegExp): string {
  const lower = text.toLowerCase();
  const idx = (() => {
    const k = lower.search(instructorRe);
    if (k >= 0) return k;
    return lower.search(hiringRe);
  })();
  if (idx < 0) return text.slice(0, 240);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 200);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

export async function probeCareerPage(
  company: Company,
  opts: ProbeOptions & {
    /** Override the default CFI-flavored instructor regex (e.g. for
     *  skydiving operators we want "jump pilot" to count as the
     *  domain-specific keyword). Defaults to INSTRUCTOR_RE. */
    instructorRe?: RegExp;
    /** Override the default hiring-signal regex. Defaults to HIRING_RE. */
    hiringRe?: RegExp;
  },
): Promise<RawListing | null> {
  if (!company.website) return null;
  const base = normalizeBase(company.website);
  if (!base) return null;

  const instructorRe = opts.instructorRe ?? INSTRUCTOR_RE;
  const hiringRe = opts.hiringRe ?? HIRING_RE;

  const tried = new Set<string>();
  const queue: string[] = [company.website, ...CAREERS_PATHS.map((p) => base + p)];

  let homepageHtml: string | null = null;
  let bestMatch: { url: string; text: string } | null = null;

  for (const candidate of queue) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const html = await fetchText(candidate);
    if (!html) continue;
    if (candidate === company.website) homepageHtml = html;
    const text = stripTags(html);
    if (isMatch(candidate, text, instructorRe, hiringRe)) {
      bestMatch = { url: candidate, text };
      break;
    }
  }

  if (!bestMatch && homepageHtml) {
    const links = findCareersLinks(homepageHtml, base);
    for (const link of links) {
      if (tried.has(link)) continue;
      tried.add(link);
      const html = await fetchText(link);
      if (!html) continue;
      const text = stripTags(html);
      if (isMatch(link, text, instructorRe, hiringRe)) {
        bestMatch = { url: link, text };
        break;
      }
    }
  }

  if (!bestMatch) return null;

  return {
    externalId: `${opts.sourceId}-${company.id}`,
    title: opts.titleTemplate(company),
    url: bestMatch.url,
    description: snippet(bestMatch.text, instructorRe, hiringRe),
    employer: company.name,
    location: `${company.city.replace(/,\s*[A-Z]{2}$/, "")}, ${company.state}`.trim(),
    postedAt: Date.now(),
    postedAtAccurate: false,
    categoryHint: opts.categoryHint ?? null,
  };
}
