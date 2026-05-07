# FlightPath — Data Source Feasibility (CFI / Low-Time Pilot Jobs)

Research date: 2026-05-07. Goal: identify which sources can practically feed an MVP that surfaces flight-instructor jobs posted in the last 30 days. For each source: URL pattern, freshness signal, feed/API availability, robots/ToS posture, scrape difficulty (1=trivial, 5=hostile), estimated daily new CFI postings.

---

## 1. JSfirm.com — **the keystone source**

- **Listings URL pattern:** `https://www.jsfirm.com/Jobs/[Job-Title-slug]/job[ID]` (numeric job ID).
- **Search:** `https://www.jsfirm.com/aviation_employment/jobs.cfm?cat=Pilot` with category filters.
- **Post date visible:** Yes, on detail pages and inside RSS `<pubDate>`.
- **Public RSS feeds (confirmed live, RSS 2.0):**
  - `https://www.jsfirm.com/integration/rss/cfirss` — "10 newest CFI jobs"
  - `https://www.jsfirm.com/integration/rss/cfiirss` — CFII
  - `https://www.jsfirm.com/integration/rss/pilotrss` — pilot
  - `https://www.jsfirm.com/integration/rss/maintenancerss` — maintenance
  - `flightinstructorrss` exists but the channel title is truncated to "flightinstructo" and it returned an empty channel today; treat as flaky — rely on `cfirss` and `cfiirss` instead.
  - There is no published index page at `/integration/rss/` (404). Endpoints follow a `<role>rss` slug convention; you can speculatively probe `firstofficerrss`, `captainrss`, `dispatcherrss`, etc.
- **API:** No public JSON API, but NAFI's job board (below) is *powered by JSfirm* — its search interface is effectively a JSfirm front-end and is the easiest way to filter the full ~11,265-listing inventory by keyword/state.
- **robots.txt:** Standard restrictive — disallows `/login`, company control panels, member directories, **resume search**. Does NOT disallow `/integration/rss/` or job detail pages. RSS consumption is implicitly invited.
- **ToS posture:** Standard "no scraping" clause typical of job boards, but RSS is a published distribution channel — pulling and re-displaying with attribution + click-through to the original is the conservative interpretation.
- **Difficulty:** **1 (trivial)** — RSS is the intended ingest path.
- **Estimated daily new CFI postings:** 5–15 nationwide based on the 10-item rolling window refreshing every ~24h.

**Verdict: Tier-1 must-have.**

---

## 2. NAFI Job Board (nafimentor.org)

- **URL:** `https://nafimentor.org/job-board/` — iframe-style integration of JSfirm with quick-search presets for "Flight Instructor", "CFI", "CFII", "Pilot".
- **Listings count today:** ~11,265 across all categories.
- **Post dates:** Hidden on the embed list view but present on the underlying JSfirm detail pages.
- **Feeds:** None native. NAFI is *upstream-equivalent* to JSfirm, so the JSfirm RSS feeds already cover this surface — pulling NAFI separately would just be deduping the same job IDs.
- **Difficulty:** N/A — covered via JSfirm.
- **Action:** Don't ingest separately. List NAFI as a "trusted partner" in marketing copy because CFIs recognize the brand.

---

## 3. Climbto350.com (`ppb.climbto350.com`)

- **Listings URL:** `https://ppb.climbto350.com/climbto350_aviation_jobs_board.cfm` (paginated, ~23 pages of ~50 listings = ~1,150 active).
- **Detail URL:** `climbto350.com/login_popup.cfm?jobID=[N]&page=job_search.cfm` — **detail content is gated behind member login**; the public page only shows title, location, date, and a teaser.
- **Post dates:** Yes, prominently in the leftmost column ("May 06, 2026" format). Excellent freshness signal.
- **CFI category filter:** None — must keyword-grep titles for "CFI", "Certified Flight Instructor", "Flight Instructor". Their inventory does include CFI postings (e.g. "Certified Flight Instructor - Pennsylvania" was visible).
- **Feeds/API:** None.
- **robots.txt:** Disallows ~21 admin directories and ~46 specific `.cfm`/`.htm` files (login, popup, member pages). The job board page itself (`climbto350_aviation_jobs_board.cfm`) is **not** in the disallow list — public crawl of the listings index is technically permitted.
- **ToS posture:** Member-walled details signal protectiveness; scraping the gated detail pages would be a clear violation. Title + date + location from the public index is gray.
- **Difficulty:** **3** — the index is scrapable but you only get teaser data; deep info requires a paid membership login (which would itself void ToS to scrape).
- **Daily new CFI postings:** Estimated 1–4 per day with "CFI" in title.

**Verdict: Tier-2 — pull title/date/location/external-apply-link only, link out for details.**

---

## 4. Pilot Career Centre (`pilotcareercenter.com`)

- Note the spelling: redirects from `pilotcareercentre.com` → `pilotcareercenter.com` (US spelling).
- **Listings URL:** `https://pilotcareercenter.com/Job-Bank/Job-Bank.aspx` (the path returns 404 to bot UAs, returns HTML in a real browser — JS-heavy ASP.NET app).
- **Post dates:** Visible in the live UI; not in any feed.
- **Feeds/API:** None.
- **robots.txt:** **Hostile.** Blocks ~70+ named bots (SemrushBot, AhrefsBot, DataForSeoBot, Bytespider, GPTBot-equivalents, Ezoicbot, etc.). No `Allow:`. Sitemap published at `/sitemap.xml`.
- **ToS posture:** The active block-list signals strong intent to refuse aggregators. Cease-and-desist risk is non-trivial.
- **Difficulty:** **4** — would require headless browser + UA rotation, and you'd be in clear violation of expressed intent.
- **Daily new CFI postings:** Modest; PCC is heavier on regional/airline postings than CFI.

**Verdict: Skip for v1.** Reconsider only if a partnership conversation opens.

---

## 5. FltOps.com

- `https://www.fltops.com/` 301-redirects to `https://www.fapaadvisors.com/` (FAPA — Future & Active Pilot Advisors). FltOps was rolled into FAPA's career-coaching brand.
- FAPA's site is a coaching/services landing page. **No public job board.** Job-fair events only.
- **Verdict: Defunct as a data source. Drop from list.**

---

## 6. AeroCrewNews / AeroCrewSolutions

- AeroCrewNews job board page (`/category/job-board/`) returned **403 Forbidden** to programmatic fetches today — Cloudflare-style bot wall.
- AeroCrewSolutions (`aerocrewsolutions.com`) is a coaching firm; only outputs are a monthly PDF newsletter and a vfairs-hosted virtual job fair (`aerocrewsolutions.vfairs.com`). No public job feed, no API.
- **Difficulty:** **4** for AeroCrewNews (bot-blocked); **N/A** for AeroCrewSolutions (no listings exist to pull).
- **Verdict: Skip for v1.**

---

## 7. Indeed

- **API status:** Indeed's Publisher API was deprecated in 2020 and is fully closed to new applicants. There is no public job-search API today.
- **Listings URL:** `https://www.indeed.com/q-certified-flight-instructor-jobs.html`, `https://www.indeed.com/q-flight-instructor-jobs.html`. ~1,600+ flight-instructor results.
- **Date filter:** UI supports "Last 24 hours / 3 days / 7 days / 14 days" via `&fromage=N` query param.
- **ToS:** Explicitly prohibits screen-scraping. Indeed has a track record of issuing cease-and-desists and blocking IPs aggressively (Cloudflare + PerimeterX).
- **Difficulty:** **5 (hostile).** Possible only via paid third-party scrapers (Apify, Bright Data, ScrapingBee) and you inherit their legal risk.
- **Daily new CFI postings:** Highest absolute volume of any source — easily 20–60/day nationally.
- **Verdict: Skip for v1.** The unit economics don't justify the legal posture for an MVP. Revisit post-PMF with a vendor contract or via SerpAPI's Google Jobs (with the caveat below).

---

## 8. LinkedIn

- **Jobs API:** Not standalone. Access only through Recruiter System Connect (RSC), which requires a Recruiter Corporate seat (~$900/seat/month) plus a partner-program approval that is closed to individual developers. Total cost typically **$50k–$300k+/yr**.
- **Listings URL:** `https://www.linkedin.com/jobs/certified-flight-instructor-jobs` — 2,000+ results.
- **ToS:** Explicitly forbids scraping; LinkedIn vs hiQ Labs litigation history is well-known and currently hostile to scrapers.
- **Difficulty:** **5.**
- **Verdict: Skip.** Out of MVP budget and legally radioactive.

---

## 9. Reddit r/flying

- **API pricing (2026):** Free tier = 100 req/min, 10k/month, **non-commercial only**. Commercial use requires a contract; published benchmarks suggest $12k/yr for the Standard tier and $50k–$500k+ for Enterprise. Pricing is opaque ($0.24/1k calls reported).
- **Search URL:** `https://www.reddit.com/r/flying/search/?q=%5BHiring%5D+CFI&sort=new` (Reddit blocks WebFetch; works in browser).
- **Format:** Posts are unstructured prose. Common tags: `[Hiring]`, `[CFI Wanted]`. Volume is **low — maybe 1–3 relevant posts/week**, not per day. Posters often delete after filling.
- **Difficulty:** **3** — technically free for low-volume non-commercial use under the API rate caps, but classifying "is this a real job posting?" needs an LLM pass since posts are conversational.
- **Verdict: Tier-3.** Useful for narrative color and signal on grassroots openings small schools wouldn't post elsewhere; not a backbone source.

---

## 10. Facebook Job Groups

- Public groups: "Flight Instructor Jobs Available" (~size unknown), "NAFI: CFI Discussion", etc.
- **Graph API:** Group content access was effectively shut down to third parties after the Cambridge Analytica fallout. The current Pages/Groups API only returns content for groups your app installer is an admin of. There is no path to read arbitrary group posts.
- **Scraping:** Facebook actively litigates scrapers (Meta v. Bright Data, Meta v. Voyager Labs). Login walls + account-bans + legal exposure.
- **Difficulty:** **5.**
- **Verdict: Skip permanently.** Worth manually monitoring 2–3 groups for product-research insight only.

---

## 11. Individual Flight School Career Pages

A maintained crawl of 50–100 top schools is **the highest-leverage proprietary moat** for this product. Most schools post CFI openings on their own ATS first and *only* their own site. Examples and ATS detection:

| School | Career page | ATS | Difficulty |
|---|---|---|---|
| ATP Flight School | `atp-flight-school.breezy.hr` (and `/json` returns structured data) | Breezy HR — public JSON | **1** |
| Embry-Riddle | `embryriddle.wd1.myworkdayjobs.com/External` | Workday | 2 (Workday has documented JSON endpoints) |
| University of North Dakota | `und.edu/careers` | PageUp | 3 |
| Purdue | `careers.purdue.edu` | SuccessFactors | 3 |
| CAE | `cae.com/careers` | Workday | 2 |
| American Flyers | `americanflyers.com/cfijobs/` | Static HTML | 1 |
| Leading Edge Flight Training | `leflighttraining.com/flight-instructor-cfi` | Static HTML | 1 |

- **ATS-pattern leverage:** Most ATS systems (Greenhouse `/jobs.json`, Lever `/api/postings`, Workday `wd*.myworkdayjobs.com/wday/cxs/`, Breezy `/json`, Ashby `/api/non-user-graphql`) expose **public structured JSON endpoints** by design. Identify the ATS once per school and the ingest is essentially free thereafter.
- **robots/ToS:** Career-page postings are intended for public consumption; ATS endpoints are designed to be embedded by aggregators. Risk is minimal.
- **Difficulty per school:** 1–3, depending on ATS. Average 2.
- **Verdict: Tier-1.** Build a curated school list (start with 30, grow to 100). This is the *defensible* data layer competitors won't replicate fast.

---

## 12. NAFI JobLink

Same surface as #2. NAFI's "Job Board" is the JobLink product, white-labeled from JSfirm. No separate API. **Already covered.**

---

## 13. University Aviation Programs

Already covered under #11. Additionally worth tracking with their own ATS:

- **Purdue** (SuccessFactors)
- **Auburn University Aviation Center** (PageUp)
- **Ohio State Center for Aviation Studies** (Workday)
- **Western Michigan University College of Aviation** (PageUp)

These post a handful of CFI/IP openings per year each — low volume, high quality.

---

## Bonus APIs Worth Considering

- **USAJobs (`developer.usajobs.gov`):** Free REST API with API-key auth. Has JSON code-lists, a Search endpoint, and a HistoricJoa endpoint. Returns FAA "AIRPLANE FLIGHT INSTRUCTOR", "AIRCRAFT FLIGHT INSTRUCTOR (TITLE 32)" postings. **Tier-1 must-have** — federal flight-instructor jobs (FAA, ANG, Coast Guard) are a small but high-trust category invisible to most aggregators.
- **Adzuna:** Public REST API with a generous free tier (300 calls/day typical), 9 endpoints, country-scoped (`/v1/api/jobs/us/...`). Has a "category" param but aviation is not a first-class category — must keyword-search "flight instructor". Adzuna *itself* aggregates from many boards, so use it as a backstop dedup source rather than primary.
- **SerpAPI / Google Jobs:** Technically gives you Google's federated job index. **Caveat: Google sued SerpAPI in Dec 2025 for DMCA circumvention; case is unresolved (motion-to-dismiss hearing was set for May 19, 2026).** Using SerpAPI today is a bet the case settles. Pricing ~$50/mo for 5k searches — viable economically.
- **ATS aggregator APIs (GetWork, Greenhouse Job Board API, Lever, Ashby):** Free public JSON endpoints when companies publish on them. This is how you scale source #11 efficiently.

---

## Existing Aggregator Landscape — Where's the Wedge?

- **JSfirm.com** — broadest aviation board, but UX is dated, no CFI-only filter at top level, no map view, no "schools hiring near you" lens, no quality signals (fleet size, pay range, completion-time-to-airline).
- **NAFI Job Board** — same content as JSfirm, more trusted brand, even less product polish.
- **FlightHired.com** — newer, clean UX, "low-hours" category, but appears to be direct-post only (small inventory) — not aggregating school career pages.
- **PilotsGlobal, AviationCV** — international focus, weak on US Part 61/141 CFI listings.
- **ZipRecruiter / Indeed / LinkedIn** — high volume but full of noise (military contractor "instructor pilot" roles paying $200k that aren't actually CFI jobs new CFIs can take).

**The wedge for FlightPath:** *Aggregate the long tail of 100 individual flight-school career pages that nobody else indexes, normalize them with the JSfirm/USAJobs feeds, and present "newly posted in the last 30 days, filtered to roles a low-time CFI can actually get."* Add quality metadata (fleet size, hours-to-airline-flow, R-ATP partner, pay band) that no incumbent surfaces.

---

## Recommended MVP Source List (v1)

Pull from these 6 sources at launch — high signal, low legal risk, all support freshness signals:

| # | Source | Method | Freshness | Effort to integrate | Est. CFI volume |
|---|---|---|---|---|---|
| 1 | **JSfirm RSS** (`cfirss` + `cfiirss` + `pilotrss`) | RSS poll every 30min | `pubDate` per item | Half-day | 10–25 new/day |
| 2 | **USAJobs Search API** | Authenticated REST, keyword="flight instructor" | Posted-on field | Half-day | 1–3 new/week |
| 3 | **ATP Flight School** Breezy JSON (`atp-flight-school.breezy.hr/json`) | Daily fetch | Per-item published date | 1 hour | 5–20 new/week (largest single CFI employer in US) |
| 4 | **Curated 30-school crawl** (Embry-Riddle Workday, UND, Purdue, CAE, regional Part 141s) | ATS-specific JSON adapters | ATS publish date | 1–2 weeks to build adapter library | 10–30 new/week aggregate |
| 5 | **Climbto350 public index** (title + date + location only, link out) | Daily HTML scrape of paginated index | Date column | 1–2 days | 1–4 new/day with "CFI" in title |
| 6 | **Adzuna API** (US, keyword "flight instructor", dedup on company+title) | Daily REST, free tier | `created` field | Half-day | Backstop — catches what direct sources miss |

**Explicitly deferred to post-MVP:** Indeed, LinkedIn, Reddit, Facebook, Pilot Career Centre, AeroCrewNews, SerpAPI. Each is either legally fraught, requires significant capex, or has poor signal-to-noise for the CFI segment.

**Dedup strategy:** Hash `(normalized_company, normalized_title, normalized_city)` — JSfirm and Adzuna will overlap on bigger employers; ATP Breezy will overlap with JSfirm. Prefer the canonical-source link (the ATS link beats the aggregator link).

**Freshness pipeline:** All 6 sources expose a post-date or `created` timestamp natively, so the "posted in last 30 days" filter is trivially enforceable without inference.

---

## Open Questions to Validate Before Build

1. Does JSfirm's ToS explicitly forbid republishing RSS contents? (Worth a one-line email to sales — many board operators welcome backlinks.)
2. Adzuna API actual rate limit on the free tier in 2026 (signup-required to confirm).
3. Whether Workday's `/wday/cxs/{tenant}/jobs` endpoint is stable across the 5–10 university tenants we'd target, or each requires bespoke session handling.
4. Reddit r/flying — is there a volunteer-mod arrangement that would let us legitimately mirror `[Hiring]` posts under a content-share?
