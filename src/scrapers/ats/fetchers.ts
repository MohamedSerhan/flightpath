import type { RawListing } from "../types.ts";
import { passesPilotFilter, type AtsSource } from "./sources.ts";

const UA = "Flightpath/0.1 (+https://github.com/flightpath; aggregator of public CFI listings)";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
}

function safeDate(s: string | undefined | null): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}

async function jsonFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (res.status === 404) throw new Error("404");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Greenhouse ----------
type GhJob = {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
  departments?: Array<{ name?: string }>;
  company_name?: string;
};
type GhResp = { jobs: GhJob[] };

async function fetchGreenhouse(src: AtsSource): Promise<RawListing[]> {
  const url =
    src.apiOverride ??
    `https://boards-api.greenhouse.io/v1/boards/${src.slug}/jobs?content=true`;
  const data = (await jsonFetch(url)) as GhResp;
  return (data.jobs ?? [])
    .filter((j) => j?.title && j?.absolute_url)
    .filter((j) => passesPilotFilter(j.title, src.pilotOnly))
    .map(
      (j): RawListing => ({
        externalId: `greenhouse-${src.slug}-${j.id}`,
        title: j.title.trim(),
        url: j.absolute_url,
        description: stripHtml(j.content),
        employer: j.company_name?.trim() || src.name,
        location: j.location?.name?.trim() || null,
        postedAt: safeDate(j.updated_at),
      }),
    );
}

// ---------- Lever ----------
type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string };
  descriptionPlain?: string;
  description?: string;
};

async function fetchLever(src: AtsSource): Promise<RawListing[]> {
  const url = src.apiOverride ?? `https://api.lever.co/v0/postings/${src.slug}?mode=json`;
  const data = (await jsonFetch(url)) as LeverJob[];
  return (data ?? [])
    .filter((j) => j?.text && (j?.hostedUrl || j?.applyUrl))
    .filter((j) => passesPilotFilter(j.text, src.pilotOnly))
    .map(
      (j): RawListing => ({
        externalId: `lever-${src.slug}-${j.id}`,
        title: j.text.trim(),
        url: j.hostedUrl ?? j.applyUrl!,
        description: j.descriptionPlain?.trim() || stripHtml(j.description),
        employer: src.name,
        location: j.categories?.location?.trim() || null,
        postedAt: typeof j.createdAt === "number" ? j.createdAt : Date.now(),
      }),
    );
}

// ---------- Ashby ----------
type AshbyJob = {
  id: string;
  title: string;
  jobUrl?: string;
  externalLink?: string;
  publishedDate?: string;
  locationName?: string;
  departmentName?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
};
type AshbyResp = { jobs: AshbyJob[] };

async function fetchAshby(src: AtsSource): Promise<RawListing[]> {
  const url =
    src.apiOverride ?? `https://api.ashbyhq.com/posting-api/job-board/${src.slug}`;
  const data = (await jsonFetch(url)) as AshbyResp;
  return (data?.jobs ?? [])
    .filter((j) => j?.title && (j?.jobUrl || j?.externalLink))
    .filter((j) => passesPilotFilter(j.title, src.pilotOnly))
    .map(
      (j): RawListing => ({
        externalId: `ashby-${src.slug}-${j.id}`,
        title: j.title.trim(),
        url: j.jobUrl ?? j.externalLink!,
        description: j.descriptionPlain?.trim() || stripHtml(j.descriptionHtml),
        employer: src.name,
        location: j.locationName?.trim() || null,
        postedAt: safeDate(j.publishedDate),
      }),
    );
}

// ---------- Workable ----------
type WorkableJob = {
  id: string;
  shortcode?: string;
  title: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  published_on?: string;
  created_at?: string;
  location?: { city?: string; region?: string; country?: string };
  description?: string;
};
type WorkableResp = { results?: WorkableJob[]; jobs?: WorkableJob[] };

async function fetchWorkable(src: AtsSource): Promise<RawListing[]> {
  // Use the GET widget endpoint, not the POST API. The POST endpoint sits
  // behind Cloudflare rate-limiting (returns 1015 to clients without a
  // browser fingerprint); the widget endpoint is stable and unauthenticated.
  // See research/04-ats-map.md for the verification.
  const url =
    src.apiOverride ?? `https://apply.workable.com/api/v1/widget/accounts/${src.slug}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (res.status === 404) throw new Error("404");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as WorkableResp;
  const jobs = data.results ?? data.jobs ?? [];
  return jobs
    .filter((j) => j?.title)
    .filter((j) => passesPilotFilter(j.title, src.pilotOnly))
    .map((j): RawListing | null => {
      const id = j.shortcode ?? j.id;
      const url =
        j.url ??
        j.application_url ??
        j.shortlink ??
        `https://apply.workable.com/${src.slug}/j/${j.shortcode ?? j.id}/`;
      if (!id || !url) return null;
      const loc = [j.location?.city, j.location?.region, j.location?.country]
        .filter(Boolean)
        .join(", ");
      return {
        externalId: `workable-${src.slug}-${id}`,
        title: j.title.trim(),
        url,
        description: stripHtml(j.description),
        employer: src.name,
        location: loc || null,
        postedAt: safeDate(j.published_on ?? j.created_at),
      };
    })
    .filter((x): x is RawListing => x !== null);
}

// ---------- Recruitee ----------
type RecruiteeJob = {
  id: number;
  title: string;
  careers_url?: string;
  url?: string;
  city?: string;
  state?: string;
  country?: string;
  created_at?: string;
  published_at?: string;
  description?: string;
};

async function fetchRecruitee(src: AtsSource): Promise<RawListing[]> {
  const url = src.apiOverride ?? `https://${src.slug}.recruitee.com/api/offers/`;
  const data = (await jsonFetch(url)) as { offers?: RecruiteeJob[] };
  return (data?.offers ?? [])
    .filter((j) => j?.title && (j?.careers_url || j?.url))
    .filter((j) => passesPilotFilter(j.title, src.pilotOnly))
    .map(
      (j): RawListing => ({
        externalId: `recruitee-${src.slug}-${j.id}`,
        title: j.title.trim(),
        url: j.careers_url ?? j.url!,
        description: stripHtml(j.description),
        employer: src.name,
        location: [j.city, j.state, j.country].filter(Boolean).join(", ") || null,
        postedAt: safeDate(j.published_at ?? j.created_at),
      }),
    );
}

// ---------- SmartRecruiters ----------
type SrJob = {
  id: string;
  name: string;
  postingUrl?: string;
  ref?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  jobAd?: { sections?: Record<string, { text?: string }> };
};
type SrResp = { content?: SrJob[] };

async function fetchSmartRecruiters(src: AtsSource): Promise<RawListing[]> {
  const url =
    src.apiOverride ??
    `https://api.smartrecruiters.com/v1/companies/${src.slug}/postings?limit=100`;
  const data = (await jsonFetch(url)) as SrResp;
  return (data?.content ?? [])
    .filter((j) => j?.name && (j?.postingUrl || j?.ref))
    .filter((j) => passesPilotFilter(j.name, src.pilotOnly))
    .map(
      (j): RawListing => ({
        externalId: `smartrecruiters-${src.slug}-${j.id}`,
        title: j.name.trim(),
        url: j.postingUrl ?? j.ref!,
        description: stripHtml(
          Object.values(j.jobAd?.sections ?? {})
            .map((s) => s?.text ?? "")
            .join("\n\n"),
        ),
        employer: src.name,
        location:
          [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ") ||
          null,
        postedAt: safeDate(j.releasedDate),
      }),
    );
}

// ---------- Breezy ----------
type BreezyJob = {
  id: string;
  name: string;
  url: string;
  published_date?: string;
  location?: { country?: { id?: string }; state?: { id?: string }; city?: string; name?: string };
  locations?: Array<{ country?: { id?: string }; state?: { id?: string }; city?: string; name?: string }>;
  department?: string;
  salary?: string;
};

async function fetchBreezy(src: AtsSource): Promise<RawListing[]> {
  const url = src.apiOverride ?? `https://${src.slug}.breezy.hr/json`;
  const data = (await jsonFetch(url)) as BreezyJob[];
  return (data ?? [])
    .filter((j) => j?.name && j?.url)
    .filter((j) => passesPilotFilter(j.name, src.pilotOnly))
    .map((j): RawListing => {
      const locs = j.locations && j.locations.length > 0 ? j.locations : j.location ? [j.location] : [];
      const us = locs.filter((l) => (l.country?.id ?? "").toUpperCase() === "US");
      const display = (us.length > 0 ? us : locs)
        .map((l) => l.name?.trim() || [l.city, l.state?.id].filter(Boolean).join(", "))
        .filter(Boolean);
      const location = display.length > 2 ? `${display.slice(0, 2).join(" / ")} (+${display.length - 2})` : display.join(" / ");
      const desc = [j.department && `Department: ${j.department}`, j.salary && `Salary: ${j.salary}`]
        .filter(Boolean)
        .join("\n");
      return {
        externalId: `breezy-${src.slug}-${j.id}`,
        title: j.name.trim(),
        url: j.url,
        description: desc || null,
        employer: src.name,
        location: location || null,
        postedAt: safeDate(j.published_date),
      };
    });
}

// ---------- dispatcher ----------
export async function fetchAtsSource(src: AtsSource): Promise<RawListing[]> {
  switch (src.kind) {
    case "greenhouse":
      return fetchGreenhouse(src);
    case "lever":
      return fetchLever(src);
    case "ashby":
      return fetchAshby(src);
    case "workable":
      return fetchWorkable(src);
    case "breezy":
      return fetchBreezy(src);
    case "recruitee":
      return fetchRecruitee(src);
    case "smartrecruiters":
      return fetchSmartRecruiters(src);
  }
}
