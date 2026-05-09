/**
 * Browser-scrape entry point.
 *
 * Currently empty — every browser-only adapter we maintained turned
 * out to be either dead (AeroCrewNews removed their /category/job-listings/
 * URL), captcha-blocked (Indeed), or convertible to plain HTTP (NBAA).
 *
 * Kept around as a stub so the CI workflow's `bun run scrape:browser`
 * step doesn't error and so a future Playwright adapter has somewhere
 * obvious to land. When/if a new browser adapter is added:
 *
 *   import { runBrowserAdapters } from "./runner.ts";
 *   import { fooAdapter } from "./adapters/foo.ts";
 *   await runBrowserAdapters([fooAdapter]);
 */

console.log("[browser] no browser adapters registered — skipping");
