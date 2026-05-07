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
