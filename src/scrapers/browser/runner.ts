/**
 * Playwright-driven browser scraping layer.
 *
 * For sites that need JS execution to populate listings (SPAs, lazy-
 * loaded results, anti-bot challenges that simple curl trips), we
 * launch a real Chromium and let the page render before harvesting
 * the DOM.
 *
 * Why a separate runner:
 * - Heavy: Chromium is ~150MB, install times measured in seconds, and
 *   each tab uses 100+MB of RAM. Don't load Playwright unless we
 *   actually need it.
 * - Lazy import: the regular `bun run scrape` does NOT touch this file,
 *   so a fresh checkout without `npx playwright install` still works.
 *   Browser scraping runs via `bun run scrape:browser` (or in CI after
 *   the workflow installs the Chromium binary).
 *
 * Each browser adapter is a `BrowserAdapter` — same shape as
 * SourceAdapter but takes a `BrowserRunner` for context. The runner
 * spawns / shares a Chromium across all browser adapters so we pay
 * the launch cost once per scrape.
 */

import type { Browser, BrowserContext, Page } from "playwright";
import type { RawListing } from "../types.ts";
import { sql } from "drizzle-orm";
import { db, sqlite } from "../../db/client.ts";
import { listings, sources } from "../../db/schema.ts";
import { enrichListing } from "../enrich.ts";

export type BrowserAdapter = {
  id: string;
  name: string;
  fetch(ctx: BrowserContext): Promise<RawListing[]>;
};

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  // Lazy import so a fresh `bun install` (no Playwright browser binary
  // downloaded yet) doesn't blow up at module-load time.
  const playwright = await import("playwright");
  // PLAYWRIGHT_BROWSER selects engine — defaults to chromium. On Windows
  // local-dev where bun + chromium pipe protocol hangs, set
  // PLAYWRIGHT_BROWSER=firefox (after `bunx playwright install firefox`).
  // CI runs on Linux where chromium works natively.
  const engine = (process.env.PLAYWRIGHT_BROWSER ?? "chromium") as
    | "chromium"
    | "firefox"
    | "webkit";
  _browser = await playwright[engine].launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
  });
  return _browser;
}

export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

export async function shutdown(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

export async function gotoAndWait(
  ctx: BrowserContext,
  url: string,
  waitForSelector: string,
  timeoutMs = 20_000,
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForSelector(waitForSelector, { timeout: timeoutMs });
  return page;
}

function ensureSchema() {
  const row = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='listings'")
    .get() as { name?: string } | undefined;
  if (!row?.name) {
    console.error("Schema missing. Run: bun run db:migrate");
    process.exit(1);
  }
}

export async function runBrowserAdapters(adapters: BrowserAdapter[]): Promise<void> {
  ensureSchema();
  for (const adapter of adapters) {
    const startedAt = Date.now();
    console.log(`[browser:${adapter.id}] starting…`);
    try {
      const items = await withContext((ctx) => adapter.fetch(ctx));
      console.log(`[browser:${adapter.id}] got ${items.length} raw listings`);
      const now = Date.now();
      for (const r of items) {
        const enriched = enrichListing(r);
        await db
          .insert(listings)
          .values({
            sourceId: adapter.id,
            externalId: enriched.externalId,
            title: enriched.title,
            rawTitle: enriched.title,
            employer: enriched.employer ?? null,
            location: enriched.location ?? null,
            state: enriched.state,
            url: enriched.url,
            description: enriched.description ?? null,
            postedAt: enriched.postedAt,
            fetchedAt: now,
            jobCategory: enriched.jobCategory,
            hoursRequired: enriched.hoursRequired,
            ratingsRequired: enriched.ratingsRequired
              ? JSON.stringify(enriched.ratingsRequired)
              : null,
            hoursBreakdown: enriched.hoursBreakdown
              ? JSON.stringify(enriched.hoursBreakdown)
              : null,
          })
          .onConflictDoUpdate({
            target: [listings.sourceId, listings.externalId],
            set: {
              title: enriched.title,
              employer: enriched.employer ?? null,
              location: enriched.location ?? null,
              state: enriched.state,
              description: enriched.description ?? null,
              postedAt: enriched.postedAt,
              fetchedAt: now,
              jobCategory: enriched.jobCategory,
              hoursRequired: enriched.hoursRequired,
              ratingsRequired: enriched.ratingsRequired
                ? JSON.stringify(enriched.ratingsRequired)
                : null,
              hoursBreakdown: enriched.hoursBreakdown
                ? JSON.stringify(enriched.hoursBreakdown)
                : null,
            },
          });
      }
      await db
        .insert(sources)
        .values({
          id: adapter.id,
          name: adapter.name,
          lastRunAt: startedAt,
          lastSuccessAt: Date.now(),
          lastCount: items.length,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: sources.id,
          set: {
            lastRunAt: startedAt,
            lastSuccessAt: Date.now(),
            lastCount: items.length,
            lastError: null,
          },
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[browser:${adapter.id}] FAILED: ${message}`);
      await db
        .insert(sources)
        .values({
          id: adapter.id,
          name: adapter.name,
          lastRunAt: startedAt,
          lastSuccessAt: null,
          lastCount: null,
          lastError: message,
        })
        .onConflictDoUpdate({
          target: sources.id,
          set: { lastRunAt: startedAt, lastError: message },
        });
    }
  }
  await shutdown();
  void sql;
}
