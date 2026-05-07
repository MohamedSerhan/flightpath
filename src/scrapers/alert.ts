/**
 * Push-alert sender — Telegram + email.
 *
 * Runs after each scrape. Finds new listings since the last successful
 * alert run, formats them into a short digest, and pushes to whichever
 * channel(s) the operator has configured. No external dependencies in
 * the runtime — both Telegram and Resend are HTTPS POST endpoints.
 *
 * Channels are gated by env vars and entirely independent:
 *
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  → Telegram bot push
 *   RESEND_API_KEY     + ALERT_EMAIL_TO    → Email via Resend
 *                                            (FROM defaults to
 *                                            onboarding@resend.dev,
 *                                            override with ALERT_EMAIL_FROM)
 *
 * Filter: env var ALERT_FILTER controls which listings are sent.
 *   "cfi"  (default) — only CFI/CFII/MEI categories
 *   "all"            — every pilot listing (noisier)
 *
 * Delivery state lives in the existing `sources` table under id
 * `_alerts_last_run` so it rides the same SQLite cache as everything
 * else. No additional schema needed.
 */

import { and, asc, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listings, sources } from "../db/schema.ts";

const ALERT_KEY = "_alerts_last_run";
const FRESHNESS_DAYS = 30;
const MAX_PER_DIGEST = 25;

type Listing = typeof listings.$inferSelect;

async function getLastRunAt(): Promise<number | null> {
  const row = (await db.select().from(sources).where(eq(sources.id, ALERT_KEY))).at(0);
  return row?.lastSuccessAt ?? null;
}

async function setLastRunAt(at: number): Promise<void> {
  await db
    .insert(sources)
    .values({ id: ALERT_KEY, name: "Alert digest", lastRunAt: at, lastSuccessAt: at, lastCount: 0, lastError: null })
    .onConflictDoUpdate({
      target: sources.id,
      set: { lastRunAt: at, lastSuccessAt: at, lastError: null },
    });
}

function categoryFilter(): string[] | null {
  const f = (process.env.ALERT_FILTER ?? "cfi").toLowerCase();
  if (f === "all") return null;
  if (f === "cfi") return ["cfi", "cfii", "mei"];
  // Comma-separated list, e.g. "cfi,cfii,mei,part135"
  const list = f.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : ["cfi", "cfii", "mei"];
}

async function findNewListings(sinceMs: number): Promise<Listing[]> {
  const cats = categoryFilter();
  const cutoff = Date.now() - FRESHNESS_DAYS * 86400_000;
  const conds = [eq(listings.isClosed, 0), gte(listings.postedAt, cutoff), gt(listings.fetchedAt, sinceMs)];
  if (cats) conds.push(inArray(listings.jobCategory, cats));
  const rows = await db
    .select()
    .from(listings)
    .where(and(...conds))
    .orderBy(asc(listings.fetchedAt))
    .limit(MAX_PER_DIGEST);
  return rows;
}

function summarize(listing: Listing): string {
  const bits: string[] = [];
  bits.push(listing.title);
  if (listing.employer) bits.push(`@ ${listing.employer}`);
  if (listing.location) bits.push(`(${listing.location})`);
  if (listing.hoursRequired) bits.push(`≥${listing.hoursRequired.toLocaleString()}h`);
  return bits.join(" ");
}

function plainBody(rows: Listing[], moreCount: number): string {
  const lines = rows.map((r, i) => {
    return `${i + 1}. ${summarize(r)}\n   ${r.url}`;
  });
  if (moreCount > 0) lines.push(`\n…and ${moreCount} more in the app.`);
  return lines.join("\n\n");
}

function htmlBody(rows: Listing[], moreCount: number): string {
  const li = rows
    .map((r) => {
      const meta: string[] = [];
      if (r.employer) meta.push(`<strong>${escape(r.employer)}</strong>`);
      if (r.location) meta.push(escape(r.location));
      if (r.hoursRequired) meta.push(`≥${r.hoursRequired.toLocaleString()}h`);
      const cat = r.jobCategory ? `<span style="font-size:11px;background:#e8ecf3;border-radius:4px;padding:1px 5px;margin-left:6px;color:#3b4a63;">${escape(r.jobCategory)}</span>` : "";
      return `<li style="margin:0 0 14px 0;">
        <a href="${escape(r.url)}" style="font-weight:600;color:#1976d2;text-decoration:none;font-size:15px;">${escape(r.title)}</a>${cat}
        <div style="color:#3b4a63;font-size:13px;margin-top:2px;">${meta.join(" · ")}</div>
      </li>`;
    })
    .join("");
  const more = moreCount > 0 ? `<p style="color:#7a869a;font-size:13px;">…and ${moreCount} more in the app.</p>` : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;color:#1c2434;">
    <p style="font-size:14px;color:#3b4a63;">${rows.length} new pilot listing${rows.length === 1 ? "" : "s"} since the last digest.</p>
    <ul style="list-style:none;padding:0;">${li}</ul>
    ${more}
    <p style="color:#7a869a;font-size:12px;margin-top:24px;border-top:1px solid #e8ecf3;padding-top:12px;">Sent by Flightpath. <a href="https://mohamedserhan.github.io/flightpath/" style="color:#1976d2;">Open the app →</a></p>
  </div>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendTelegram(rows: Listing[], total: number): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;

  const more = Math.max(0, total - rows.length);
  // Telegram caps message length at 4096 chars; trim if we get unlucky.
  const text = plainBody(rows, more).slice(0, 3900);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: `✈️ ${rows.length} new pilot listing${rows.length === 1 ? "" : "s"}\n\n${text}`,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.warn(`[alert:telegram] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  console.log(`[alert:telegram] sent ${rows.length} listings`);
  return true;
}

async function sendEmail(rows: Listing[], total: number): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  if (!apiKey || !to) return false;
  const from = process.env.ALERT_EMAIL_FROM ?? "Flightpath <onboarding@resend.dev>";

  const more = Math.max(0, total - rows.length);
  const subject = `Flightpath: ${rows.length} new ${rows.length === 1 ? "listing" : "listings"}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()),
      subject,
      html: htmlBody(rows, more),
      text: plainBody(rows, more),
    }),
  });
  if (!res.ok) {
    console.warn(`[alert:email] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  console.log(`[alert:email] sent ${rows.length} listings`);
  return true;
}

export async function runAlerts(): Promise<void> {
  const tg = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const em = !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO);
  if (!tg && !em) {
    console.log("[alert] no channels configured (set TELEGRAM_* or RESEND_* env vars)");
    return;
  }

  const lastRun = (await getLastRunAt()) ?? Date.now() - 4 * 3600_000;
  const rows = await findNewListings(lastRun);
  if (rows.length === 0) {
    console.log("[alert] no new listings since last run");
    await setLastRunAt(Date.now());
    return;
  }

  const total = rows.length;
  console.log(`[alert] dispatching ${total} new listings (since ${new Date(lastRun).toISOString()})`);

  const sent: boolean[] = await Promise.all([
    tg ? sendTelegram(rows, total) : Promise.resolve(false),
    em ? sendEmail(rows, total) : Promise.resolve(false),
  ]);
  // Only advance the high-water mark if at least one channel succeeded —
  // otherwise we'd silently drop these listings on the next run.
  if (sent.some(Boolean)) {
    await setLastRunAt(Date.now());
  } else {
    console.warn("[alert] every channel failed; keeping last_run_at unchanged so we retry next tick");
  }
}

if (import.meta.main) {
  runAlerts().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
