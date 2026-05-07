import type { BrowserContext } from "playwright";
import type { BrowserAdapter } from "../runner.ts";
import type { RawListing } from "../../types.ts";

/**
 * Indeed.com — CFI / flight-instructor search results via Playwright.
 *
 * Risky-on-purpose adapter. Indeed deploys aggressive bot detection
 * (Cloudflare + reCAPTCHA + behavioral fingerprinting) and will return
 * a challenge page when it suspects automation. We mitigate with a
 * realistic browser context (Chromium, real UA, viewport, locale,
 * referer) but make no claim that this will work every run. The CI
 * workflow wraps the browser scrape in continue-on-error so a flaky
 * pass doesn't block the deploy.
 *
 * Pages:
 *   /jobs?q=flight+instructor             — main pull
 *   /jobs?q=flight+instructor&start=10    — paginate (10/page)
 *
 * Selectors are based on Indeed's 2026 markup — they rotate names
 * frequently. We use multiple fallbacks per field so a partial
 * markup change doesn't 0-out the result.
 */

const QUERIES: Array<{ q: string; l: string }> = [
  { q: "flight instructor", l: "" },
  { q: "CFI", l: "" },
];

const MAX_PAGES_PER_QUERY = 3;
const NAV_DELAY_MS = 1500;

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|simulator\s+instructor|sim\s+instructor|ground\s+instructor|chief\s+instructor|instructor\s+pilot|line\s+check|check\s+airman|first\s+officer|captain|pilot)\b/i;

type Hit = {
  jobKey: string;
  title: string;
  url: string;
  employer: string | null;
  location: string | null;
  postedDays: number | null;
};

async function harvestPage(ctx: BrowserContext, url: string): Promise<Hit[]> {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Wait for either real content or a known challenge marker.
    await Promise.race([
      page.waitForSelector("td.resultContent, div[data-testid='slider_item'], div.job_seen_beacon", { timeout: 15_000 }),
      page.waitForSelector("text=/verify you are human/i", { timeout: 15_000 }),
    ]).catch(() => {
      /* either way, we'll harvest what we can */
    });
    // If a captcha showed, harvest will return [] cleanly.
    const items: Hit[] = await page.evaluate(() => {
      function pick<T>(arr: T[]): T | null {
        return arr.length > 0 ? arr[0] : null;
      }
      const cards = Array.from(
        document.querySelectorAll(
          "div.job_seen_beacon, td.resultContent, div[data-testid='slider_item']",
        ),
      );
      return cards.flatMap((card): Hit[] => {
        const linkEl = pick(
          Array.from(
            card.querySelectorAll<HTMLAnchorElement>(
              "a.jcs-JobTitle, h2.jobTitle a, a[data-jk]",
            ),
          ),
        );
        if (!linkEl) return [];
        const jk = linkEl.getAttribute("data-jk") ?? linkEl.id ?? linkEl.href;
        if (!jk) return [];
        const titleEl = pick(
          Array.from(card.querySelectorAll<HTMLElement>("h2.jobTitle, span[title], a.jcs-JobTitle")),
        );
        const title =
          (titleEl?.getAttribute("title") ?? titleEl?.textContent ?? linkEl.textContent ?? "").trim();
        const employer =
          pick(
            Array.from(
              card.querySelectorAll<HTMLElement>(
                "[data-testid='company-name'], span.companyName, .companyName",
              ),
            ),
          )?.textContent?.trim() ?? null;
        const location =
          pick(
            Array.from(
              card.querySelectorAll<HTMLElement>(
                "[data-testid='text-location'], div.companyLocation, .companyLocation",
              ),
            ),
          )?.textContent?.trim() ?? null;
        const dateEl = pick(
          Array.from(
            card.querySelectorAll<HTMLElement>("span.date, [data-testid='myJobsStateDate']"),
          ),
        );
        const dateText = dateEl?.textContent ?? "";
        let postedDays: number | null = null;
        const m = dateText.match(/(\d+)\s+day/i);
        if (m) postedDays = Number(m[1]);
        if (/today|just posted/i.test(dateText)) postedDays = 0;
        return [
          {
            jobKey: jk.replace(/^.*data-jk=/, "").slice(0, 64),
            title,
            url: linkEl.href.startsWith("/")
              ? `https://www.indeed.com${linkEl.href}`
              : linkEl.href,
            employer,
            location,
            postedDays,
          },
        ];
      });
    });
    return items;
  } finally {
    await page.close();
  }
}

export const indeedAdapter: BrowserAdapter = {
  id: "indeed",
  name: "Indeed (Playwright)",
  async fetch(ctx: BrowserContext): Promise<RawListing[]> {
    const seen = new Set<string>();
    const out: RawListing[] = [];

    for (const { q, l } of QUERIES) {
      for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
        const start = page * 10;
        const url = `https://www.indeed.com/jobs?${new URLSearchParams({
          q,
          l,
          ...(start > 0 ? { start: String(start) } : {}),
        }).toString()}`;
        let hits: Hit[] = [];
        try {
          hits = await harvestPage(ctx, url);
        } catch (err) {
          console.warn(
            `[indeed] q="${q}" page=${page} failed: ${err instanceof Error ? err.message : err}`,
          );
          break;
        }
        if (hits.length === 0) break;
        let added = 0;
        for (const h of hits) {
          if (!h.title || !PILOT_TITLE_RE.test(h.title)) continue;
          if (seen.has(h.jobKey)) continue;
          seen.add(h.jobKey);
          out.push({
            externalId: `indeed-${h.jobKey}`,
            title: h.title,
            url: h.url,
            description: null,
            employer: h.employer,
            location: h.location,
            postedAt:
              h.postedDays !== null ? Date.now() - h.postedDays * 86400_000 : Date.now(),
          });
          added++;
        }
        if (added === 0) break;
        await new Promise((r) => setTimeout(r, NAV_DELAY_MS));
      }
    }

    console.log(`[indeed] kept ${out.length} pilot listings`);
    return out;
  },
};
