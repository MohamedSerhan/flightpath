import type { JobCategory } from "../shared/types.ts";

export type RawListing = {
  externalId: string;
  title: string;
  url: string;
  description?: string | null;
  employer?: string | null;
  location?: string | null;
  postedAt: number;
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
