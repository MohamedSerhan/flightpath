import type { SourceAdapter } from "./types.ts";
import { jsfirmAdapter } from "./adapters/jsfirm.ts";
import { atsAdapter } from "./adapters/ats.ts";
import { workdayAdapter } from "./adapters/workday.ts";
import { atpCfiAdapter } from "./adapters/atp-cfi.ts";
import { skywestAdapter } from "./adapters/skywest.ts";
import { pccAdapter } from "./adapters/pcc.ts";
import { findAPilotAdapter } from "./adapters/findapilot.ts";
import { aopaJdnAdapter } from "./adapters/aopa-jdn.ts";
import { redditAdapter } from "./adapters/reddit.ts";
import { usaJobsAdapter } from "./adapters/usajobs.ts";
import { adzunaAdapter } from "./adapters/adzuna.ts";
import { millionairAdapter } from "./adapters/millionair.ts";
import { avJobsAdapter } from "./adapters/avjobs.ts";

export const adapters: SourceAdapter[] = [
  jsfirmAdapter,
  atsAdapter,
  workdayAdapter,
  atpCfiAdapter,
  skywestAdapter,
  pccAdapter,
  findAPilotAdapter,
  aopaJdnAdapter,
  redditAdapter,
  usaJobsAdapter,
  adzunaAdapter,
  millionairAdapter,
  avJobsAdapter,
];

/** Sources that have been intentionally removed. The migrate step uses
 *  this list to retroactively hide their cached listings from the UI on
 *  the next CI run; without this they'd linger in the SQLite cache until
 *  their fake postedAt timestamps aged out of the 30-day window. */
export const REMOVED_SOURCE_IDS: string[] = ["climbto350"];
