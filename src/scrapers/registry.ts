import type { SourceAdapter } from "./types.ts";
import { jsfirmAdapter } from "./adapters/jsfirm.ts";
import { atsAdapter } from "./adapters/ats.ts";
import { workdayAdapter } from "./adapters/workday.ts";
import { atpCfiAdapter } from "./adapters/atp-cfi.ts";
import { skywestAdapter } from "./adapters/skywest.ts";
import { pccAdapter } from "./adapters/pcc.ts";
import { findAPilotAdapter } from "./adapters/findapilot.ts";
import { aopaJdnAdapter } from "./adapters/aopa-jdn.ts";
import { usaJobsAdapter } from "./adapters/usajobs.ts";
import { adzunaAdapter } from "./adapters/adzuna.ts";
import { millionairAdapter } from "./adapters/millionair.ts";
import { avJobsAdapter } from "./adapters/avjobs.ts";
import { icimsAdapter } from "./adapters/icims.ts";
import { nbaaAdapter } from "./adapters/nbaa.ts";
import { flightSchoolsAdapter } from "./adapters/flight-schools.ts";

export const adapters: SourceAdapter[] = [
  jsfirmAdapter,
  atsAdapter,
  workdayAdapter,
  atpCfiAdapter,
  skywestAdapter,
  pccAdapter,
  findAPilotAdapter,
  aopaJdnAdapter,
  usaJobsAdapter,
  adzunaAdapter,
  millionairAdapter,
  avJobsAdapter,
  icimsAdapter,
  nbaaAdapter,
  flightSchoolsAdapter,
];

/** Sources that have been intentionally removed. The migrate step uses
 *  this list to retroactively hide their cached listings from the UI on
 *  the next CI run; without this they'd linger in the SQLite cache until
 *  their fake postedAt timestamps aged out of the 30-day window.
 *
 *  - climbto350: paywalled, sibling didn't find value
 *  - reddit: Reddit perma-403'd unauthenticated RSS in 2026
 *  - aerocrewnews: removed their /category/job-listings/ URL
 *  - indeed: captcha-walled, browser pass also failed
 *  - atlantic-aviation: FBO chain — no pilot postings exist
 *  - icims-endeavor: replaced by the multi-tenant `icims` adapter */
export const REMOVED_SOURCE_IDS: string[] = [
  "climbto350",
  "reddit",
  "aerocrewnews",
  "indeed",
  "atlantic-aviation",
  "icims-endeavor",
];
