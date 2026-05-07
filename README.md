# Flightpath

Fresh CFI and low-time pilot job listings, aggregated from sources that don't suck.

Built for the 200–1500 hour CFI cohort that the major aggregators have abandoned. Defaults to listings from the **last 30 days**.

## Quick start (local)

```bash
bun install
bun run db:migrate
bun run scrape       # pull fresh listings
bun run dev          # API on :3001, web on :5173
```

Open http://localhost:5173. Filters live in the URL hash, so any view is bookmarkable and shareable.

## Push alerts (Telegram + email, free)

The cron runs every 4 hours; alerts go out for new pilot listings since
the previous run. Both channels are independent and gated by repo secrets.

**Telegram (recommended — instant, no domain needed):**

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, copy the token it gives you.
2. Send any message to your new bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `result[0].message.chat.id`.
3. Repo → **Settings → Secrets and variables → Actions → New secret**:
   - `TELEGRAM_BOT_TOKEN` = the token from BotFather
   - `TELEGRAM_CHAT_ID` = your chat id

**Email via [Resend](https://resend.com) (free 3000/month):**

1. Sign up at resend.com, create an API key.
2. Repo secrets:
   - `RESEND_API_KEY` = the api key
   - `ALERT_EMAIL_TO` = where to send (comma-separated for multiple)
   - `ALERT_EMAIL_FROM` *(optional)* = `Your Name <you@verified-domain.com>` if you've verified a domain in Resend; otherwise leave unset and it ships from `onboarding@resend.dev`

**Filter** *(optional repo variable, not secret)*:
- `ALERT_FILTER` = `cfi` (default — only CFI/CFII/MEI), `all` (every pilot listing), or a comma-separated category list (`cfi,cfii,mei,part135`).

## Optional: Adzuna aggregator

Adzuna's free tier (1000 calls/month) returns aviation listings via their search API. Set these repo secrets to enable:

  ADZUNA_APP_ID    app id from developer.adzuna.com
  ADZUNA_APP_KEY   app key from same page

Sign up free at https://developer.adzuna.com/admin/access_details.

## Free 24/7 hosting on GitHub Pages

The `.github/workflows/scrape-and-deploy.yml` workflow scrapes every 4 hours, builds a static bundle, and publishes it to GitHub Pages. No backend server, no hosting fees.

**One-time setup:**

1. Push this repo to GitHub.
2. **Settings → Pages → Source → "GitHub Actions"** (not "Deploy from a branch").
3. **Settings → Actions → General → Workflow permissions → "Read and write permissions"** so the workflow can publish.
4. Optional: **Settings → Secrets and variables → Actions → New repository secret**:
   - `USAJOBS_AUTH_KEY` and `USAJOBS_USER_AGENT` to enable federal job listings (free key at https://developer.usajobs.gov/apirequest/).

The first run takes ~3 minutes. Subsequent runs are incremental: SQLite state is cached between runs, so listings accumulate over time. The site lives at:

```
https://<your-username>.github.io/<repo-name>/
```

The workflow auto-detects the repo name and configures the Vite base path. If you use a custom domain, override `VITE_BASE` in the workflow.

To trigger a run on demand: **Actions → Scrape and deploy → Run workflow**.

## Browser-based scraping (Playwright)

Some sites (AeroCrewNews, future Cloudflare-protected pages, JS-rendered SPAs) need a real browser. `bun run scrape:browser` launches a headless Chromium via Playwright and runs the adapters in `src/scrapers/browser/adapters/`.

```bash
# one-time
bunx playwright install --with-deps chromium

# run
bun run scrape:browser

# or both HTTP and browser passes
bun run scrape:all
```

The CI workflow installs Chromium and runs the browser pass automatically.

**Windows local-dev caveat:** Bun + Playwright + Chromium hits a pipe-protocol stall on Windows ([known Bun issue](https://github.com/oven-sh/bun/issues)). Two workarounds locally: `set PLAYWRIGHT_BROWSER=firefox` (after `bunx playwright install firefox`), or just run browser scrapes in CI only — Linux runners are unaffected.

## Architecture

```
src/
  server/           Hono API on Bun (port 3001)            ← dev / self-hosted only
  web/              Vite + React + Tailwind UI (port 5173)
  scrapers/
    adapters/       Per-source: jsfirm, ats, reddit, usajobs
    ats/            Generic ATS layer (Greenhouse / Lever / Ashby /
                    Workable / Breezy / Recruitee / SmartRecruiters)
    enrich.ts       State, category, hours, ratings extraction
    enrich-detail.ts Re-fetches original postings for missing fields
    run.ts          Orchestrator: scrape → enrich → upsert → enrich-detail
    export.ts       DB → static JSON for GitHub Pages
  db/               Drizzle schema, bun:sqlite client
  shared/           Types shared between server, scrapers, and web
```

### Two data modes

| Mode | When | Source |
|---|---|---|
| **Live API** | `bun run dev` | Hono server on :3001, SQLite-backed |
| **Static** | `bun run build:static` (GitHub Pages) | `dist/web/data/listings.json` filtered in-browser |

The frontend selects mode at build time via `VITE_STATIC_DATA=1`.

### Adding a new ATS-backed employer

Most flight schools and airlines use Greenhouse / Lever / Ashby / Workable / Breezy. Adding one is a single line in `src/scrapers/ats/sources.ts`:

```ts
{ kind: "greenhouse", slug: "<their-slug>", name: "Their Name", pilotOnly: true },
```

To find the slug, look at their careers page URL — it'll usually be `boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`, `apply.workable.com/<slug>`, or `<slug>.breezy.hr`.

### Adding a totally new source

Create `src/scrapers/adapters/<name>.ts` exporting a `SourceAdapter` (id, name, async fetch → RawListing[]). Register it in `src/scrapers/registry.ts`. The shared dedup, enrichment, and storage layers handle the rest.

## Status

v0.1 — JSfirm + ATS aggregator (Greenhouse/Lever/Ashby/Workable/Breezy/Recruitee/SmartRecruiters) + Reddit r/flying [Hiring] + USAJobs (opt-in). Detail-page enrichment fills in hours and pay. Roadmap and research in `research/00-synthesis.md`.

## Research

- [Synthesis](research/00-synthesis.md)
- [Pilot pain points](research/01-pain-points.md)
- [Data sources](research/02-data-sources.md)
- [Competitive scan](research/03-competitive-scan.md)
- [ATS map](research/04-ats-map.md) *(generated by background agent)*
