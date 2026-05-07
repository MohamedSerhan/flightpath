import type { BrowserContext } from "playwright";
import type { BrowserAdapter } from "../runner.ts";
import type { RawListing } from "../../types.ts";

/**
 * AeroCrewNews job listings.
 *
 * Plain curl gets 403 — Cloudflare bot block. Playwright with a real
 * Chromium passes the challenge.
 *
 * The category page lists posts, each post is an individual job
 * announcement. We harvest titles + URLs + post dates from the
 * archive grid, then optionally fetch the post body for the full
 * description (deferred to the standard detail-enrichment pass).
 */

const URL = "https://www.aerocrewnews.com/category/job-listings/";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot|hiring|now\s+hiring)\b/i;

type PageItem = { title: string; url: string; date: string | null };

export const aeroCrewNewsAdapter: BrowserAdapter = {
  id: "aerocrewnews",
  name: "AeroCrewNews",
  async fetch(ctx: BrowserContext): Promise<RawListing[]> {
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
    // The archive grid uses .post-* classes. Wait for at least one to render.
    await page
      .waitForSelector("article a[href]", { timeout: 15_000 })
      .catch(() => {
        /* may already be present */
      });

    const items: PageItem[] = await page.evaluate(() => {
      const out: PageItem[] = [];
      const articles = document.querySelectorAll("article");
      articles.forEach((article) => {
        const link = article.querySelector("h2 a[href], h3 a[href], .entry-title a[href]");
        if (!link) return;
        const url = (link as HTMLAnchorElement).href;
        const title = (link.textContent ?? "").trim();
        if (!title || !url) return;
        const dateEl = article.querySelector("time, .entry-date, .posted-on");
        const date = dateEl ? (dateEl.getAttribute("datetime") ?? dateEl.textContent ?? "").trim() : null;
        out.push({ title, url, date });
      });
      return out;
    });

    await page.close();

    return items
      .filter((it) => PILOT_TITLE_RE.test(it.title))
      .map((it): RawListing => {
        const idMatch = it.url.match(/([^\/]+)\/?$/);
        const id = idMatch ? idMatch[1] : it.url;
        const postedAt = it.date ? Date.parse(it.date) : Date.now();
        return {
          externalId: `aerocrewnews-${id}`,
          title: it.title,
          url: it.url,
          description: null,
          employer: "AeroCrewNews (announcement)",
          location: null,
          postedAt: Number.isFinite(postedAt) ? postedAt : Date.now(),
        };
      });
  },
};
