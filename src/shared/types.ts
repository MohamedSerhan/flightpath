export type Listing = {
  id: number;
  sourceId: string;
  externalId: string;
  title: string;
  employer: string | null;
  location: string | null;
  state: string | null;
  url: string;
  description: string | null;
  postedAt: number;
  /** True when postedAt was parsed from the source. False when the
   *  adapter had no real date and fell back to "first time we saw it";
   *  in that case the UI renders "Indexed N days ago" instead of
   *  "Posted N days ago" so the user isn't misled about how fresh the
   *  posting actually is. */
  postedAtAccurate: boolean;
  fetchedAt: number;
  jobCategory: JobCategory | null;
  hoursRequired: number | null;
  ratingsRequired: string[] | null;
  rawTitle: string;
};

export type JobCategory =
  | "cfi"
  | "cfii"
  | "mei"
  | "part135"
  | "part91"
  | "airline"
  | "corporate"
  | "other";

export type ListingFilter = {
  q?: string;
  category?: JobCategory;
  state?: string;
  postedSinceDays?: number;
  maxHoursRequired?: number;
  source?: string;
  limit?: number;
  offset?: number;
};

export type ListingsResponse = {
  total: number;
  items: Listing[];
};

export type SourceMeta = {
  id: string;
  name: string;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastCount: number | null;
  lastError: string | null;
};
