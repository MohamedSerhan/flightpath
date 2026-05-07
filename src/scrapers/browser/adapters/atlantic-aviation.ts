import type { BrowserContext } from "playwright";
import type { BrowserAdapter } from "../runner.ts";
import type { RawListing } from "../../types.ts";

/**
 * Atlantic Aviation FBO chain — iCIMS-hosted careers board.
 *
 * Atlantic runs 100+ FBO locations across the US. Most postings are
 * line-service / customer-service / management roles, so the pilot
 * regex will filter most rows out — but when a pilot, instructor, or
 * captain role does land, it's worth catching.
 *
 * The iCIMS jobs table is rendered via JS, so a plain curl returns
 * mostly empty markup. Playwright waits for `tr.row` to populate.
 *
 * Selectors rotate over time on iCIMS; we use multiple fallbacks per
 * field and bail with `[]` if the table never renders (challenge or
 * empty result).
 */

const URL = "https://careers-atlanticaviation.icims.com/jobs/intro?in_iframe=1";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|second\s+in\s+command|sic\b|pic\b)\b/i;

type PageItem = {
  title: string;
  url: string;
  location: string | null;
  postedText: string | null;
};

function parsePostedAt(text: string | null): number {
  if (!text) return Date.now();
  const days = text.match(/(\d+)\s+day/i);
  if (days) return Date.now() - Number(days[1]) * 86400_000;
  if (/today|just\s+posted/i.test(text)) return Date.now();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function extractJobId(url: string): string {
  // iCIMS URLs look like .../jobs/12345/some-slug/job — the numeric id
  // is the stable bit. Fall back to the trailing slug, then the URL.
  const num = url.match(/\/jobs\/(\d+)/);
  if (num) return num[1];
  const slug = url.match(/\/jobs\/[^/]+\/([^/?#]+)/);
  if (slug) return slug[1];
  return url;
}

export const atlanticAviationAdapter: BrowserAdapter = {
  id: "atlantic-aviation",
  name: "Atlantic Aviation",
  async fetch(ctx: BrowserContext): Promise<RawListing[]> {
    const page = await ctx.newPage();
    try {
      await page
        .goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => {});
      const ready = await page
        .waitForSelector("tr.row, a.iCIMS_Anchor, a[href*='/jobs/']", {
          timeout: 15_000,
        })
        .then(() => true)
        .catch(() => false);
      if (!ready) {
        console.log(`[atlantic-aviation] table never rendered, returning 0`);
        return [];
      }

      const items: PageItem[] = await page.evaluate(() => {
        function pick<T extends Element>(el: ParentNode, selectors: string[]): T | null {
          for (const sel of selectors) {
            const found = el.querySelector(sel);
            if (found) return found as T;
          }
          return null;
        }
        // Prefer table rows; fall back to anchor-only mode if iCIMS
        // shipped a card-style markup variant on this run.
        const rows = Array.from(document.querySelectorAll("tr.row"));
        const out: PageItem[] = [];
        if (rows.length > 0) {
          for (const row of rows) {
            const link = pick<HTMLAnchorElement>(row, [
              "a.iCIMS_Anchor",
              "a[href*='/jobs/']",
            ]);
            if (!link) continue;
            const url = link.href;
            const title = (link.textContent ?? "").trim();
            if (!title || !url) continue;
            const locEl = pick<HTMLElement>(row, [
              ".iCIMS_JobLocation",
              "[class*='Location']",
              "td.location",
            ]);
            const dateEl = pick<HTMLElement>(row, [
              ".iCIMS_JobDate",
              "[class*='PostedDate']",
              "time",
              "td.posted",
            ]);
            out.push({
              title,
              url,
              location: locEl?.textContent?.trim() ?? null,
              postedText:
                dateEl?.getAttribute("datetime") ?? dateEl?.textContent?.trim() ?? null,
            });
          }
          return out;
        }
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>("a[href*='/jobs/']"),
        );
        for (const a of anchors) {
          const title = (a.textContent ?? "").trim();
          if (!title) continue;
          out.push({ title, url: a.href, location: null, postedText: null });
        }
        return out;
      });

      const seen = new Set<string>();
      const kept = items
        .filter((it) => PILOT_TITLE_RE.test(it.title))
        .map((it): RawListing => {
          const id = extractJobId(it.url);
          return {
            externalId: `atlantic-aviation-${id}`,
            title: it.title,
            url: it.url,
            description: null,
            employer: "Atlantic Aviation",
            location: it.location,
            postedAt: parsePostedAt(it.postedText),
          };
        })
        .filter((r) => {
          if (seen.has(r.externalId)) return false;
          seen.add(r.externalId);
          return true;
        });

      console.log(
        `[atlantic-aviation] saw ${items.length} rows, kept ${kept.length} pilot listings`,
      );
      return kept;
    } finally {
      await page.close();
    }
  },
};
