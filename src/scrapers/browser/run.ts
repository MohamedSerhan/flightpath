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

const adapters = [aeroCrewNewsAdapter];

await runBrowserAdapters(adapters);
