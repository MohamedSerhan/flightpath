import type { RawListing, SourceAdapter } from "../types.ts";

/**
 * Endeavor Air via iCIMS — HTML scrape.
 *
 * iCIMS turned off most public JSON feeds, but their Endeavor instance
 * still serves a server-rendered list when you append `?in_iframe=1`
 * to /jobs/search. The markup is stable: each row is wrapped in a
 * `.iCIMS_Anchor` link with the job id + slug embedded in the URL,
 * a `<h3>` for the title, and a `.description` blurb.
 *
 * Endeavor is a Delta Connection regional carrier — the seat after
 * a CFI builds toward 1,500 hours. Pilot pipeline + sim instructor
 * roles sit here. Worth catching even though the volume per pull is
 * modest.
 */

const URL_BASE =
  "https://careers-endeavorair.icims.com/jobs/search?ss=1&searchKeyword=&in_iframe=1";

// iCIMS rate-limits / blocks our standard full UA string. The shorter
// "Mozilla/5.0 Chrome/120" form passes — apparently they fingerprint
// on the long Win64 UA pattern as "automation" and block.
const UA = "Mozilla/5.0 Chrome/120";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b|new\s+hire\s+pilot|cadet|pathway)\b/i;

// Each row's anchor — captures the job-id, the slug, and the title from
// the wrapping <h3>. The href URL-encodes parens; we decode on extraction.
const ROW_RE =
  /<a\s+href="(https:\/\/careers-endeavorair\.icims\.com\/jobs\/(\d+)\/[^"]+)"\s+class="iCIMS_Anchor"[^>]*>[\s\S]*?<h3[^>]*>\s*([^<]+?)\s*<\/h3>/g;

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

export const icimsEndeavorAdapter: SourceAdapter = {
  id: "icims-endeavor",
  name: "Endeavor Air (iCIMS)",
  async fetch(): Promise<RawListing[]> {
    // Counter-intuitively iCIMS HTTP 405's the request when we send a
    // Referer header — it seems to interpret cross-origin referer as
    // a CSRF signal and blocks the GET. Minimal headers are what work.
    const res = await fetch(URL_BASE, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const seen = new Set<string>();
    const out: RawListing[] = [];
    ROW_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROW_RE.exec(html)) !== null) {
      const [, urlEnc, jobId, rawTitle] = m;
      if (seen.has(jobId)) continue;
      seen.add(jobId);
      const title = decodeHtml(rawTitle);
      if (!PILOT_TITLE_RE.test(title)) continue;
      // Strip the in_iframe=1 query before storing — visitors get the
      // normal site chrome when they click through.
      const url = decodeURIComponent(urlEnc).replace(/[?&]in_iframe=1/, "");
      out.push({
        externalId: `icims-endeavor-${jobId}`,
        title,
        url,
        description: null,
        employer: "Endeavor Air",
        location: null, // iCIMS markup doesn't expose location reliably; detail-enrichment will fill it
        postedAt: Date.now(),
      });
    }
    return out;
  },
};
