import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Generic iCIMS HTML scraper.
 *
 * iCIMS retired most public JSON feeds, but their server-rendered job
 * search at `/jobs/search?ss=1&searchKeyword=&in_iframe=1` still works
 * for many tenants. Each row is wrapped in a `.iCIMS_Anchor` link with
 * the job id + slug embedded in the URL, plus an `<h3>` for the title.
 *
 * Tenants verified live 2026-05-09:
 *   - Endeavor Air (regional carrier — Delta Connection, ATP feeder)
 *   - Joby Aviation (eVTOL — flight test + production pilots)
 *
 * Adding a tenant:
 *   1) Visit https://careers-<tenant>.icims.com/jobs/search?in_iframe=1
 *   2) Confirm the page renders rows with `.iCIMS_Anchor` and `<h3>`
 *   3) Add a row to TENANTS below
 *
 * iCIMS quirks that bit us:
 *   - Long Chrome UA strings (`Mozilla/5.0 (Windows NT 10.0; Win64...`)
 *     trip a fingerprint and HTTP 403. Short generic UA passes.
 *   - Sending a Referer header makes them HTTP 405 (interprets the
 *     cross-origin referer as a CSRF signal). Send no Referer.
 */

type IcimsTenant = {
  /** Used as the source-id slug + as the subdomain in `careers-<id>`. */
  id: string;
  /** Human-readable employer name. */
  name: string;
  /** Override host if it doesn't match `careers-<id>.icims.com`. */
  hostOverride?: string;
  /**
   * Optional searchKeyword filters. Big tenants (Joby, ~250 jobs) bury
   * pilot roles past the first page, so we hit `?searchKeyword=<term>`
   * for each term and dedupe by job-id. Empty string = full unfiltered
   * page (preferred for small tenants like Endeavor where pilot roles
   * sit in the first ~20 results).
   */
  keywords?: string[];
};

const TENANTS: IcimsTenant[] = [
  // Endeavor Air — Delta Connection regional. Pilot pipeline + sim
  // instructor roles. Volume: 1–3 active.
  { id: "endeavor", name: "Endeavor Air", hostOverride: "careers-endeavorair.icims.com" },
  // Joby Aviation — eVTOL OEM. ~250 jobs total, mostly engineering. The
  // first unfiltered page is all engineers; pilot roles ("Flight Instructor",
  // "Flight Research Test Pilot", "Remote Pilot") only show up under
  // searchKeyword. Pull them individually then dedupe.
  {
    id: "joby",
    name: "Joby Aviation",
    hostOverride: "careers-jobyaviation.icims.com",
    keywords: ["pilot", "flight instructor", "flight test", "cfi"],
  },
  // Envoy Air — American Eagle regional. Has Ground School Instructor,
  // Sim Instructor, Manager Flight Ops + Pilot Cadet Program postings.
  {
    id: "envoyair",
    name: "Envoy Air",
    hostOverride: "careers-envoyair.icims.com",
    keywords: ["pilot", "instructor", "flight"],
  },
  // PSA Airlines — American Eagle regional. Pilot Cadet, Manager of
  // Flight Standards, Ground Instructor.
  {
    id: "psaairlines",
    name: "PSA Airlines",
    hostOverride: "careers-psaairlines.icims.com",
    keywords: ["pilot", "instructor", "flight"],
  },
];

const UA = "Mozilla/5.0 Chrome/120";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b|new\s+hire\s+pilot|cadet|pathway|test\s+pilot|flight\s+test|production\s+pilot)\b/i;

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchTenantPage(
  host: string,
  tenantId: string,
  tenantName: string,
  keyword: string,
): Promise<RawListing[]> {
  const kw = encodeURIComponent(keyword);
  const url = `https://${host}/jobs/search?ss=1&searchKeyword=${kw}&in_iframe=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Anchor row regex — captures job id, URL, and title. iCIMS embeds
  // the human title in the `title` attribute as `<id> - <title>`.
  const rowRe = new RegExp(
    `<a\\s+href="(https://${host.replace(/\./g, "\\.")}/jobs/(\\d+)/[^"]+)"\\s+class="iCIMS_Anchor"\\s+title="\\d+\\s*-\\s*([^"]+)"`,
    "g",
  );

  const out: RawListing[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const [, urlEnc, jobId, rawTitle] = m;
    const title = decodeHtml(rawTitle);
    if (!PILOT_TITLE_RE.test(title)) continue;
    const cleanUrl = decodeURIComponent(urlEnc).replace(/[?&]in_iframe=1/, "");
    out.push({
      externalId: `icims-${tenantId}-${jobId}`,
      title,
      url: cleanUrl,
      description: null,
      employer: tenantName,
      // iCIMS markup doesn't expose location reliably; detail-enrich fills.
      location: null,
      postedAt: Date.now(),
    });
  }
  return out;
}

async function fetchTenant(t: IcimsTenant): Promise<RawListing[]> {
  const host = t.hostOverride ?? `careers-${t.id}.icims.com`;
  const keywords = t.keywords?.length ? t.keywords : [""];
  const seen = new Set<string>();
  const out: RawListing[] = [];
  for (const kw of keywords) {
    try {
      const items = await fetchTenantPage(host, t.id, t.name, kw);
      for (const item of items) {
        if (seen.has(item.externalId)) continue;
        seen.add(item.externalId);
        out.push(item);
      }
    } catch (err) {
      console.warn(
        `[icims:${t.id}] keyword="${kw}" failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (out.length > 0) {
    console.log(`[icims:${t.id}] +${out.length} pilot/CFI roles`);
  }
  return out;
}

export const icimsAdapter: SourceAdapter = {
  id: "icims",
  name: "iCIMS (Endeavor, Joby, Envoy, PSA)",
  async fetch(): Promise<RawListing[]> {
    const all: RawListing[] = [];
    for (const t of TENANTS) {
      try {
        const items = await fetchTenant(t);
        all.push(...items);
      } catch (err) {
        console.warn(
          `[icims:${t.id}] failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return all;
  },
};
