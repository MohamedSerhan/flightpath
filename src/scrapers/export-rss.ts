/**
 * RSS feed export for the static deploy.
 *
 * "Email alerts" without a backend cost money. RSS is the no-cost
 * equivalent: drop the URL into Feedly / Inoreader / NetNewsWire / any
 * email-via-RSS service (e.g. RSStoEmail, Blogtrottr) and you get
 * pushed every new listing the scraper finds.
 *
 * We emit two flavours into dist/web/:
 *   - feed.xml         — every listing in the last 30 days (~few hundred)
 *   - feed-cfi.xml     — pre-filtered to CFI / CFII / MEI titles (the
 *                        feed the sibling actually wants to subscribe to)
 *
 * The "guid" element uses the listing's URL so feed readers won't
 * re-notify on the same job when its post date gets bumped.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { desc, gte } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listings } from "../db/schema.ts";

const FEED_DAYS = 30;
const SITE_BASE = process.env.FLIGHTPATH_SITE_URL ?? "https://example.com/flightpath";

function escape(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc2822(ts: number): string {
  return new Date(ts).toUTCString();
}

function buildFeed(
  title: string,
  description: string,
  rows: Array<typeof listings.$inferSelect>,
): string {
  const items = rows
    .map((r) => {
      const tags: string[] = [];
      if (r.jobCategory) tags.push(`<category>${escape(r.jobCategory)}</category>`);
      if (r.state) tags.push(`<category>${escape(r.state)}</category>`);
      const descParts: string[] = [];
      if (r.employer) descParts.push(`Employer: ${r.employer}`);
      if (r.location) descParts.push(`Location: ${r.location}`);
      if (r.hoursRequired) descParts.push(`Min hours: ${r.hoursRequired.toLocaleString()}`);
      if (r.ratingsRequired) {
        try {
          const arr = JSON.parse(r.ratingsRequired);
          if (Array.isArray(arr) && arr.length > 0) {
            descParts.push(`Ratings: ${arr.join(", ")}`);
          }
        } catch {
          /* ignore */
        }
      }
      if (r.description) descParts.push("", r.description.slice(0, 1500));
      const desc = descParts.join("\n");
      return [
        "    <item>",
        `      <title>${escape(r.title)}</title>`,
        `      <link>${escape(r.url)}</link>`,
        `      <guid isPermaLink="true">${escape(r.url)}</guid>`,
        `      <pubDate>${rfc2822(r.postedAt)}</pubDate>`,
        `      <source url="${escape(SITE_BASE)}">${escape(r.sourceId)}</source>`,
        ...tags.map((t) => `      ${t}`),
        `      <description>${escape(desc)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escape(title)}</title>
    <link>${escape(SITE_BASE)}</link>
    <description>${escape(description)}</description>
    <language>en-us</language>
    <lastBuildDate>${rfc2822(Date.now())}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

async function main() {
  const outDir = join(process.cwd(), "dist/web");
  await mkdir(outDir, { recursive: true });

  const cutoff = Date.now() - FEED_DAYS * 86400_000;
  const allRows = await db
    .select()
    .from(listings)
    .where(gte(listings.postedAt, cutoff))
    .orderBy(desc(listings.postedAt))
    .limit(500);

  const allFeed = buildFeed(
    "Flightpath — All fresh pilot/CFI listings",
    `Pilot, CFI, and flight-instructor listings from the last ${FEED_DAYS} days, aggregated by Flightpath.`,
    allRows,
  );
  await Bun.write(join(outDir, "feed.xml"), allFeed);
  console.log(`rss: feed.xml (${allRows.length} items)`);

  const cfiRows = allRows.filter((r) => r.jobCategory === "cfi" || r.jobCategory === "cfii" || r.jobCategory === "mei");
  const cfiFeed = buildFeed(
    "Flightpath — CFI / CFII / MEI listings",
    "Flight instructor roles only — CFI, CFII, and MEI postings from the last 30 days.",
    cfiRows,
  );
  await Bun.write(join(outDir, "feed-cfi.xml"), cfiFeed);
  console.log(`rss: feed-cfi.xml (${cfiRows.length} items)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
