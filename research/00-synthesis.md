# Flightpath — Research Synthesis & MVP Plan

## What the research established

**The market gap is real and specific.** The airline / 121 / corporate end is saturated (Climbto350, JSfirm, BizJetJobs, FAPA, LogTen Careers, airlineapps.com). The **200–1500 hour cohort — CFIs, Part 135 SIC, banner tow, pipeline patrol, skydive ops** — is unserved. Climbto350 is the brand leader but is openly mocked on r/flying for stale, recycled, paywalled listings: ~470 March listings → only 1 sub-1500-hour role. The community's standing advice for low-time pilots is literally *"cold-call FBOs"* — proof the aggregators have given up on this segment.

**Top pain points (ranked):**
1. The 1500-hour ATP wall warps every CFI/135 job into a "time meter" — average CFI tenure is 12–18 months.
2. Job-board fragmentation: 8–12 sources to check; freshest signals have migrated to Facebook groups + Discord + FBO walk-ins.
3. Stale / recycled listings (Climbto350 reposts Facebook content, ~90% considered questionable per forum sentiment).
4. Pay opacity — flight-hour vs. ground-hour vs. master-on/master-off splits almost never disclosed.
5. No filtering on the things that matter: total time required, MEI / CFII / tailwheel needs, Part 141 vs 61, year-round VFR location, aircraft type, student pipeline.

**Data sources that actually work for an MVP:**
- ✅ **JSfirm RSS** — undocumented but live: `/integration/rss/cfirss` and `/integration/rss/cfiirss`. RSS 2.0 with `pubDate`. Robots.txt does not block. **This is the backbone.**
- ✅ **USAJobs API** — official, free, includes some aviation/flight-instructor roles.
- ✅ **ATP Flight School Breezy JSON** — `atp-flight-school.breezy.hr/json`, public.
- ✅ **Greenhouse / Lever / Workday / Breezy / Ashby ATS** — public JSON endpoints; build a curated adapter library for top ~30 flight schools (Embry-Riddle, UND, Purdue, ATP, CAE, Republic LIFT, Skyborne, Epic Flight Academy, etc.).
- ✅ **Adzuna API** — free tier.
- ✅ **NAFI Job Board** — confirmed white-label of JSfirm; same data, no need to dual-pull.
- ✅ **Climbto350 public index** — title/date/location only (details paywalled), but enough for freshness signal.

**Skip for v1:** Indeed (hostile, API dead 2020), LinkedIn ($50k+/yr Recruiter API), Reddit (paid commercial tier, low volume), Facebook groups (no Graph access path), SerpAPI (Google lawsuit pending May 2026), Pilot Career Centre (robots.txt hostile).

**Wedge:** Free to pilots. Mobile-first. CFI/sub-1500-hour focus. Freshness-first (last 30d default, with push when new role matches saved filter). Real FAA-aligned filters (total time, MEI, CFII, tailwheel, complex, multi, ratings). Crowdsourced pay/quality data as the long-term moat. Monetize employer-side later via featured placement.

**Risks to track:** LogTen Pro could pivot down-market (they have the logbook moat). 2025–2026 121 hiring slowdown is softening the CFI feeder pipeline.

## Proposed MVP — "Flightpath v0.1"

**One-line spec:** A mobile-friendly web app that pulls fresh (≤30 days) CFI and low-time pilot job listings from a curated source list, dedupes them, and lets a pilot filter by total-time-required, ratings, location, and aircraft.

**Stack proposal (open to your push-back):**
- **Backend:** Python (FastAPI) — async-friendly for fan-out scraping; rich RSS/HTML lib ecosystem.
- **Scraper layer:** modular per-source adapters (`adapters/jsfirm.py`, `adapters/usajobs.py`, `adapters/breezy.py`, `adapters/greenhouse.py`, etc.) returning a normalized `Listing` schema.
- **Scheduler:** cron / GitHub Actions every 4–6 hours (free tier friendly).
- **Storage:** SQLite for v0.1 (zero-ops), Postgres if/when it grows.
- **Frontend:** Next.js + Tailwind. Mobile-first. PWA so the sibling can "install" it.
- **Dedup:** title + employer + location fingerprint with fuzzy match.
- **Hosting:** Vercel (frontend) + Fly.io or Render (backend + DB). All free tier for MVP.
- **No auth in v0.1.** Saved searches kept in localStorage. Auth + push notifications come in v0.2.

**Phased roadmap:**
- **v0.1 (week 1):** JSfirm RSS only, web UI, basic filters (location text search, posted-since), 30-day freshness. Goal: useful to the sibling tomorrow.
- **v0.2 (week 2-3):** add USAJobs + ATP Breezy + 5 school ATS adapters, dedup, structured hours-required parser ("500 TT" → numeric), saved-search localStorage.
- **v0.3 (week 4+):** auth + email/push alerts, hours-to-1500 calculator, crowdsourced pay submissions, mobile PWA polish.

## Open questions for you / the sibling

These genuinely change the build — worth answering before I start:
1. **Sibling's current state:** total time, ratings held (PPL/CPL/CFI/CFII/MEI?), R-ATP eligible (military or 141 4-year?), citizenship (affects USAJobs / regional sponsorship).
2. **Geographic flexibility:** willing to relocate anywhere in US? Or constrained to a region? (Forum data: this is the single strongest predictor of finding a CFI job.)
3. **Risk appetite on questionable scraping:** Facebook groups would give the freshest listings but violates ToS. OK to skip them entirely for v1?
4. **Scope ambition:** Build app for sibling specifically (could be ~1 weekend), or build product that scales to thousands of pilots (multi-week)?

## Why I'm not running `/batch` yet

`/batch` parallelizes *independent* implementation tasks, but at hour-zero everything overlaps (the schema choice constrains scraper, frontend, storage). After v0.1 lands, /batch is perfect for parallel work: "agent A: add Greenhouse adapter, agent B: add Workday adapter, agent C: build pay-submission form." That's where it earns its keep.
