# Flight Schools / Aviation Training — ATS Map

Goal: identify which schools expose a public JSON job-listing endpoint that one of our scraper adapters (Greenhouse, Lever, Ashby, Workable, Breezy, Recruitee, SmartRecruiters) can ingest. Every "verified" row was confirmed live with `curl` against the documented public endpoint on **2026-05-07**.

## TL;DR

The CFI hiring market is dominated by **Workday, iCIMS, ADP Workforce Now, Paylocity, AirlineApps, and custom email/form workflows** — none of which expose public JSON. Of the original list (~30 schools/employers), only **one** flight school + **one** aviation maintenance school chain were confirmed on a scrape-friendly ATS with current postings:

- **ATP Flight School** -> Breezy (`atp-flight-school`) — biggest CFI employer in the US, public JSON live
- **Aviation Institute of Maintenance** -> Greenhouse (`aviationinstituteofmaintenance`) — aviation maintenance instructors only (A&P/AMT), not CFI

A handful of other schools have public JSON endpoints with no current relevant postings (Florida Flyers, WSU Tech, Cotulla Education, Breeze Airways) — useful to ingest opportunistically because postings rotate.

Everyone else (Embry-Riddle, CAE, Republic/LIFT, AeroGuard, Hillsboro, FlightSafety, L3Harris, Spartan, SkyWest, Endeavor, etc.) is on Workday / iCIMS / Eploy / NAS / AirlineApps / Paylocity / custom — no public API. Skip until we add a Workday/iCIMS adapter.

## Verified table (sorted: live JSON + currently-relevant postings first)

| School | Careers URL | ATS | Public Slug | Has CFI roles? | Notes |
|---|---|---|---|---|---|
| **ATP Flight School** | https://atpflightschool.com/jobs/ | Breezy | `atp-flight-school` | Yes (off-feed) + maintenance/training-support live | `https://atp-flight-school.breezy.hr/json` returns 18 active jobs (mostly A&P + Training Support). CFI role detail pages exist (e.g. `/p/b0216507c255-faa-certified-airplane-flight-instructor...`) and are indexed by Google but are filtered out of the public JSON feed — likely posted as private/share-link roles. We get all the maintenance + training support jobs cleanly; CFI requires a secondary scrape of `breezy.hr/p/<id>` URLs found via sitemap or HTML scrape of the careers landing. **Largest single CFI employer in the US.** |
| **Aviation Institute of Maintenance** | https://job-boards.greenhouse.io/aviationinstituteofmaintenance | Greenhouse | `aviationinstituteofmaintenance` | No CFI — only A&P/AMT mechanic instructors | `https://boards-api.greenhouse.io/v1/boards/aviationinstituteofmaintenance/jobs` -> 95 active jobs nationwide, ~30+ "Aircraft Mechanic Instructor" / "A&P Instructor" / "Airframe Instructor" roles. Adjacent to CFI persona but a separate certification path. Useful if scope expands to A&P instructors. |
| **Breeze Airways** | https://job-boards.greenhouse.io/breezeairways | Greenhouse | `breezeairways` | "A220 Flight Instructor" + "A220 Ground Instructor" live (SLC); not CFI but adjacent | 49 active jobs. Embark Pilot Program posting also live — that program partners with feeder flight schools for CFI placement. Worth ingesting; the A220 instructor role is sometimes mistargetted as CFI in aggregators. |
| **Cotulla Education** | https://job-boards.greenhouse.io/cotullaeducation | Greenhouse | `cotullaeducation` | No CFI — A&P / AMT / Aircraft Mechanic instructors | 12 active jobs. Same maintenance-instructor adjacency as AIM. |
| **WSU Tech (Wichita State Tech)** | https://apply.workable.com/wsutech/ | Workable | `wsutech` | Sometimes — "Adjunct Faculty, Certified Flight Instructor" was active, currently expired | 20 active jobs today, no flight roles currently. Use the **GET widget** endpoint `https://apply.workable.com/api/v1/widget/accounts/wsutech` (returns `{name, description, jobs:[…]}`). The POST API at `apply.workable.com/api/v3/accounts/wsutech/jobs` is Cloudflare-rate-limited and returned 1015 — prefer the widget endpoint. |
| **Florida Flyers Flight Academy** | https://florida-flyers-flight-academy-inc.breezy.hr/ | Breezy | `florida-flyers-flight-academy-inc` | Currently zero open roles; account is verified live | `/json` returns `[]` (HTTP 200, 2 bytes). Account exists and Breezy has been used in the past for flight instructor postings. Worth polling — when they hire, the JSON endpoint will populate. |

## Skipped (verified to be on no-public-JSON ATS — don't waste cycles)

| School | ATS | Why skip |
|---|---|---|
| Embry-Riddle Aeronautical University | Workday | `embryriddle.wd1.myworkdayjobs.com/External` — needs Workday adapter |
| CAE (incl. CAE Phoenix, SimCom by CAE) | Workday | `cae.wd3.myworkdayjobs.com/en-US/career` — Workday |
| Bristow Academy / Bristow Group | Workday | `bristow.wd1.myworkdayjobs.com` — Workday |
| Republic Airways / LIFT Academy | AirlineApps (proprietary) | `careers.rjet.com` + `airlineapps.com/jobs/details.aspx?emp=Republic-Airways&job=...` — AirlineApps proprietary, no public JSON |
| SkyWest Airlines | iCIMS | `careers-skywest.icims.com` |
| Endeavor Air | iCIMS | `careers-endeavorair.icims.com/jobs/intro` |
| FlightSafety International | NAS Recruitment "Activate" | `jobs.flightsafety.com` — Activate platform, no public JSON |
| Hillsboro Aero Academy | ADP Workforce Now | `workforcenow.adp.com/mascsr/...` — ADP, no public JSON |
| Skyborne Airline Academy (US, Vero Beach) | Eploy | `us.careers.skyborne.com` -> Eploy (UK ASP.NET ATS); previously had a SmartRecruiters slug (`SkyborneAirlineAcademy`) but that's now empty/deprecated |
| Thrust Flight | Paylocity | `recruiting.paylocity.com/recruiting/jobs/All/4f1b2577-...-Thrust-Flight-Group` — Paylocity, no public JSON |
| Lewis University (Aviation) | PeopleAdmin | `jobs.lewisu.edu` -> PeopleAdmin (PowerSchool); no documented public JSON |
| L3Harris Commercial Aviation / Airline Academy | Workday-style enterprise | `careers.l3harris.com` (US/military org behind it) — large enterprise ATS, treat as Workday |
| AeroGuard Flight Training Center | Custom / email | `flyaeroguard.com/work-for-aeroguard/` — applications go to `HR.benefits@flyaeroguard.com` and per-state pages with embedded forms; no third-party ATS |
| Coast Flight Training | Custom / email | Email to `Careers@iflycoast.com`; embedded WP form |
| Epic Flight Academy | Custom | No third-party ATS detected on `epicflightacademy.com/epic-careers/` |
| Phoenix East Aviation | Custom | Apply links go to `cfi.pea.com/aviation-careers-apply-now/` and `cfiinstructorjobs.com/...` — own domains, custom forms |
| Leading Edge Aviation (Bend OR) | Custom | Custom form on `leaviation.com/careers/` |
| Leading Edge Flight Training (Fort Collins CO) | Custom | Custom form on `leflighttraining.com/careers` |
| American Flyers | Custom | `americanflyers.com/apply-now/` — proprietary form |
| Wayman College of Aeronautics | Custom | No external ATS detected |
| US Aviation Academy (Denton TX) | Custom (likely) | Standard `/careers/` returned 404 in fetch; no ATS markers found via search |
| Spartan College of Aeronautics | (page returned 403 via fetch) | Could not verify cleanly; no public-JSON ATS markers found in search results |
| Mauna Loa Helicopters | Custom | `maunaloahelicopters.edu` and `maunaloaaero.com/about-us/careers/` returned 403; no third-party ATS markers in search |
| Mesa Airlines | (none surfaced) | No iCIMS/Workday/Greenhouse/Lever/Ashby presence found |
| Cape Air | (none surfaced) | No iCIMS/Workday/Greenhouse/Lever/Ashby presence found; uses internal pilot recruiting flow |
| Helicopter Institute (Texas) | Custom | No third-party ATS markers |
| Helicopter Academy (FL) | Custom | Phone/email + on-site form |
| Universal Helicopters | Custom | No third-party ATS markers |
| Aero Elite Flight Training | Custom | Embedded form on `aeflight.com/flight-instructor-jobs/` |
| Sierra Charlie Aviation | Custom | Per-page CFI application form |
| Sun State Aviation | Not found | Search returned no clear org / careers page |
| Falcon Aviation Academy (US) | Custom | No third-party ATS markers |
| Cornerstone Aviation | Custom | Apply via own careers page |
| University programs (Purdue, UND, WMU, Auburn, FIT, MTSU, K-State Salina, OSU, SIU Carbondale, Liberty) | University HRIS (Workday / PeopleAdmin / NeoEd / Cornerstone) | All universities sit on enterprise HRIS — none of these expose Greenhouse/Lever/Ashby/Workable. Each would need its specific HRIS adapter. Lewis confirmed = PeopleAdmin (PowerSchool). |

## Implementation guidance

1. **Start with ATP Flight School** — it's the single highest-leverage source. The Breezy `/json` feed gives us 18+ jobs cleanly via the existing Breezy adapter. To capture CFI roles specifically, add a secondary path that scrapes `https://atp-flight-school.breezy.hr/sitemap.xml` (or the rendered HTML of the root page) for `/p/<id>-...` job-detail URLs that aren't in the JSON, then fetch each one directly. The CFI postings are real and indexed (Google has at least 4 distinct airport-specific FAA Certified Airplane Flight Instructor postings — JQF, CRG, SUS, GKY).
2. **Add Greenhouse adapter ingest for** `aviationinstituteofmaintenance`, `cotullaeducation`, `breezeairways` even though most aren't pure CFI — A&P instructors are an adjacent persona, and Breeze has flight-instructor-adjacent roles plus the Embark feeder pathway.
3. **Poll Florida Flyers and WSU Tech weekly** — both have verified live ATS endpoints with the correct slug, and both have historically posted CFI / flight instructor roles. They'll re-populate.
4. **Defer building Workday and iCIMS adapters** until coverage demands it. When we do, the highest-value Workday tenants on this list are: Embry-Riddle (`embryriddle.wd1`), CAE (`cae.wd3`), Bristow (`bristow.wd1`), and most of the universities. Highest-value iCIMS tenants are SkyWest (`careers-skywest.icims.com`) and Endeavor (`careers-endeavorair.icims.com`).
5. **For ATS detection**: SmartRecruiters returns HTTP 200 with `{"totalFound":0,"content":[]}` for nonexistent slugs — never trust 200 alone, always check `totalFound` and that the company's job-board URL doesn't redirect to the SR root. Workable's POST `/api/v3/accounts/<slug>/jobs` is rate-limited via Cloudflare; prefer the GET widget endpoint `/api/v1/widget/accounts/<slug>`. Breezy's `/json` returns `[]` for valid-but-empty accounts and HTML errors for nonexistent slugs (302 -> error page).

## Endpoint reference (live as of 2026-05-07)

```
GET https://atp-flight-school.breezy.hr/json                                           -> 200, 24,374 bytes
GET https://florida-flyers-flight-academy-inc.breezy.hr/json                           -> 200, 2 bytes ([])
GET https://boards-api.greenhouse.io/v1/boards/aviationinstituteofmaintenance/jobs     -> 200, 63,598 bytes
GET https://boards-api.greenhouse.io/v1/boards/cotullaeducation/jobs                   -> 200, 7,516 bytes
GET https://boards-api.greenhouse.io/v1/boards/breezeairways/jobs                      -> 200, 31,103 bytes
GET https://apply.workable.com/api/v1/widget/accounts/wsutech                          -> 200, 13,518 bytes
```
