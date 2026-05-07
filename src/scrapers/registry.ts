import type { SourceAdapter } from "./types.ts";
import { jsfirmAdapter } from "./adapters/jsfirm.ts";
import { atsAdapter } from "./adapters/ats.ts";
import { workdayAdapter } from "./adapters/workday.ts";
import { atpCfiAdapter } from "./adapters/atp-cfi.ts";
import { skywestAdapter } from "./adapters/skywest.ts";
import { climbto350Adapter } from "./adapters/climbto350.ts";
import { pccAdapter } from "./adapters/pcc.ts";
import { redditAdapter } from "./adapters/reddit.ts";
import { usaJobsAdapter } from "./adapters/usajobs.ts";

export const adapters: SourceAdapter[] = [
  jsfirmAdapter,
  atsAdapter,
  workdayAdapter,
  atpCfiAdapter,
  skywestAdapter,
  climbto350Adapter,
  pccAdapter,
  redditAdapter,
  usaJobsAdapter,
];
