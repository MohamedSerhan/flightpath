/**
 * Browser-scrape entry point.
 *
 * Runs only the Playwright-backed adapters. Decoupled from the regular
 * `bun run scrape` so a developer without the Chromium binary still
 * gets a working scrape.
 *
 * In CI: `npx playwright install --with-deps chromium` then
 * `bun run scrape:browser`.
 */

import { runBrowserAdapters } from "./runner.ts";
import { aeroCrewNewsAdapter } from "./adapters/aerocrewnews.ts";
import { indeedAdapter } from "./adapters/indeed.ts";
import { nbaaAdapter } from "./adapters/nbaa.ts";

const adapters = [aeroCrewNewsAdapter, indeedAdapter, nbaaAdapter];

await runBrowserAdapters(adapters);
