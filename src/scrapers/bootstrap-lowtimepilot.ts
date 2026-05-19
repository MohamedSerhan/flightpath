/**
 * One-time bootstrap: scrape lowtimepilot.com/company-map to produce
 * data/lowtimepilot-companies.json — a seed list of aviation employers
 * (aerial survey, skydiving, banner tow, pipeline patrol, etc.) with
 * their websites and operation categories.
 *
 * Used by the `lowtimepilot` adapter (src/scrapers/adapters/lowtimepilot.ts)
 * to probe each company's careers page for active hiring signals — same
 * pattern as the flight-schools adapter, but with a broader, category-tagged
 * source.
 *
 * Run manually when refreshing the seed:
 *   bun src/scrapers/bootstrap-lowtimepilot.ts          # full harvest
 *   bun src/scrapers/bootstrap-lowtimepilot.ts --probe  # discovery mode:
 *                                                       # dumps the rendered
 *                                                       # network calls + DOM
 *                                                       # shape so we can
 *                                                       # write the parser
 *
 * On Windows local dev, set PLAYWRIGHT_BROWSER=firefox if chromium hangs
 * (same convention as runner.ts).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JobCategory } from "../shared/types.ts";

const SOURCE_URL = "https://www.lowtimepilot.com/company-map";
const OUTPUT = "data/lowtimepilot-companies.json";

/** `"time_building"` is a seed-only category — it's NOT in the public
 *  JobCategory union because time-building programs are pay-to-play, not
 *  job postings, and we don't want them showing up in the listings UI.
 *  The adapter filters these out before probing. Keeping the label in
 *  the seed lets us preserve the data without polluting the listings DB. */
export type LowtimepilotCompany = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
  category: JobCategory | "time_building";
};

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI","GU",
]);

const CATEGORY_MAP: Record<string, JobCategory | "time_building"> = {
  "aerial survey": "aerial_survey",
  "pipeline patrol": "pipeline_patrol",
  "powerline patrol": "pipeline_patrol",
  "air ambulance": "air_ambulance",
  "hems": "air_ambulance",
  "medevac": "air_ambulance",
  "skydiving": "skydiving",
  "skydive": "skydiving",
  "jump pilot": "skydiving",
  "banner tow": "banner_tow",
  "banner towing": "banner_tow",
  "traffic watch": "traffic_watch",
  "eng": "traffic_watch",
  "charter": "part135",
  "part 135": "part135",
  "airline": "airline",
  // Seed-only — adapter filters these out before probing. Pay-to-play
  // programs aren't real job postings; we keep the data but never
  // emit listings.
  "time building": "time_building",
  "time-building": "time_building",
};

function mapCategory(label: string): JobCategory | "time_building" {
  const k = label.toLowerCase().trim();
  if (CATEGORY_MAP[k]) return CATEGORY_MAP[k];
  console.log(`[lowtimepilot] unmapped category: "${label}" — defaulting to part91`);
  return "part91";
}

async function main() {
  const probeMode = process.argv.includes("--probe");
  const playwright = await import("playwright");
  const engine = (process.env.PLAYWRIGHT_BROWSER ?? "chromium") as
    | "chromium"
    | "firefox"
    | "webkit";
  const browser = await playwright[engine].launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
  });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();

    if (probeMode) {
      console.log("[probe] capturing network responses…");
      const captured: Array<{ url: string; status: number; type: string; bytes: number; sample: string }> = [];
      page.on("response", async (res) => {
        try {
          const url = res.url();
          const ct = res.headers()["content-type"] ?? "";
          // Focus on JSON, scripts that might inline data, and same-origin requests.
          if (!/json|javascript|application\/x|text\/plain/i.test(ct)) return;
          const buf = await res.body().catch(() => null);
          if (!buf) return;
          const body = buf.toString("utf8");
          captured.push({
            url,
            status: res.status(),
            type: ct,
            bytes: buf.length,
            sample: body.slice(0, 400),
          });
        } catch {
          /* ignore — some responses can't be re-read */
        }
      });

      await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 45_000 });
      // Give late XHRs a moment to settle.
      await page.waitForTimeout(2_000);

      console.log(`[probe] captured ${captured.length} JSON/JS responses`);
      for (const c of captured) {
        console.log(`\n--- ${c.status} ${c.url} (${c.type}, ${c.bytes} bytes) ---`);
        console.log(c.sample);
      }

      const domDump = await page.evaluate(() => {
        // Heuristics: look for elements with map-marker-like attributes,
        // any data-* attributes that reference companies, and the structured
        // text content of the largest list element on the page.
        const candidates = Array.from(
          document.querySelectorAll("[data-company], [data-id], .company, .marker, [class*='company']"),
        ).slice(0, 10);
        return candidates.map((el) => ({
          tag: el.tagName,
          cls: el.className,
          attrs: Array.from(el.attributes).map((a) => `${a.name}="${a.value.slice(0, 80)}"`),
          text: (el.textContent || "").slice(0, 200),
        }));
      });

      console.log("\n--- DOM candidates ---");
      console.log(JSON.stringify(domDump, null, 2));
      return;
    }

    // Full harvest path — implemented in Task 5 once we know the shape.
    console.error("[lowtimepilot] full harvest not yet implemented. Run with --probe first.");
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
