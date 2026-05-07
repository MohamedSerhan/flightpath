import type { SourceAdapter } from "./types.ts";
import { jsfirmAdapter } from "./adapters/jsfirm.ts";
import { atsAdapter } from "./adapters/ats.ts";
import { atpCfiAdapter } from "./adapters/atp-cfi.ts";
import { redditAdapter } from "./adapters/reddit.ts";
import { usaJobsAdapter } from "./adapters/usajobs.ts";

export const adapters: SourceAdapter[] = [
  jsfirmAdapter,
  atsAdapter,
  atpCfiAdapter,
  redditAdapter,
  usaJobsAdapter,
];
