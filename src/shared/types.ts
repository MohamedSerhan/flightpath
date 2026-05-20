export type HoursBreakdown = {
  multiEngine?: number;
  turbine?: number;
  tailwheel?: number;
  complex?: number;
  instrument?: number;
  pic?: number;
  crossCountry?: number;
};

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
  hoursBreakdown: HoursBreakdown | null;
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
  | "other"
  // Non-CFI part-91-adjacent operations. Split out from the old
  // catch-all `part91` so the sibling can filter for them directly.
  // `part91` remains the bucket for personal/general GA that doesn't fit
  // a more specific operation.
  | "aerial_survey"
  | "pipeline_patrol"
  | "skydiving"
  | "banner_tow"
  | "traffic_watch"
  | "air_ambulance";

export type ListingFilter = {
  q?: string;
  /** Single category OR array of categories. The API accepts repeated
   *  `category=` query params; the UI's grouped chips (e.g. "Non-CFI" =
   *  aerial_survey | pipeline_patrol | ...) submit multiple values. */
  category?: JobCategory | JobCategory[];
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
