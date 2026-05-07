import type { RawListing, SourceAdapter } from "../types.ts";

const PILOT_JOBS_URL = "https://www.jsfirm.com/pilot+jobs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseDate(s: string): number {
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`).getTime();
  }
  return Date.now();
}

const ROW_RE =
  /<a\s+href='(\/[^']+\/jobID_(\d+))'\s+target="_blank">([\s\S]*?)<\/a>[\s\S]*?<td[^>]*>\s*<div>\s*([\s\S]*?)\s*<\/div>\s*<\/td>\s*<td[^>]*>\s*<div>\s*([\s\S]*?)\s*<\/div>\s*<\/td>\s*<td[^>]*>\s*([\d\/\-: APMapm]+?)\s*<\/td>/g;

const FLIGHT_INSTRUCTION_RE =
  /\b(cfi|cfii|mei|flight instructor|certified flight instructor|instructor pilot|sim instructor|simulator instructor|ground instructor|cfg|chief instructor|cfid|check airman|line check)\b/i;

function isFlightInstruction(title: string): boolean {
  return FLIGHT_INSTRUCTION_RE.test(title);
}

function parseListings(html: string): RawListing[] {
  const out: RawListing[] = [];
  ROW_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROW_RE.exec(html)) !== null) {
    const [, hrefPath, jobId, titleHtml, employerHtml, locationHtml, dateRaw] = m;
    const title = stripTags(titleHtml);
    const employer = stripTags(employerHtml);
    const locationParts = stripTags(locationHtml).split(/\s+/);
    const location = stripTags(locationHtml).replace(/\s*\n\s*/g, ", ");
    const url = `https://www.jsfirm.com${hrefPath}`;
    const postedAt = parseDate(dateRaw);
    if (!isFlightInstruction(title)) continue;
    out.push({
      externalId: `jsfirm-${jobId}`,
      title,
      url,
      description: null,
      employer: employer || null,
      location: location || null,
      postedAt,
    });
    void locationParts;
  }
  return out;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

export const jsfirmAdapter: SourceAdapter = {
  id: "jsfirm",
  name: "JSfirm",
  async fetch(): Promise<RawListing[]> {
    const html = await fetchPage(PILOT_JOBS_URL);
    return parseListings(html);
  },
};
