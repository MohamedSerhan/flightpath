import type { JobCategory } from "../shared/types.ts";

export type RawListing = {
  externalId: string;
  title: string;
  url: string;
  description?: string | null;
  employer?: string | null;
  location?: string | null;
  postedAt: number;
  /** Set to false when the adapter had no real posting date and fell back
   *  to Date.now(). Default (undefined / true) means postedAt came from
   *  the source. Drives the UI's "Indexed" vs "Posted" copy. */
  postedAtAccurate?: boolean;
};

export type SourceAdapter = {
  id: string;
  name: string;
  fetch(): Promise<RawListing[]>;
};

export type EnrichedListing = RawListing & {
  state: string | null;
  jobCategory: JobCategory | null;
  hoursRequired: number | null;
  ratingsRequired: string[] | null;
};
