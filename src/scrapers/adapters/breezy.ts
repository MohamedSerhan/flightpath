import type { RawListing, SourceAdapter } from "../types.ts";

type BreezySource = {
  id: string;
  name: string;
  slug: string;
  /** Optional title-substring filter to limit to pilot/CFI roles. */
  titleFilter?: RegExp;
};

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight instructor|pilot|first officer|captain|line check|check airman|sim instructor|simulator instructor|ground instructor)\b/i;

const SOURCES: BreezySource[] = [
  {
    id: "atp-flight-school",
    name: "ATP Flight School",
    slug: "atp-flight-school",
    titleFilter: PILOT_TITLE_RE,
  },
];

type BreezyJob = {
  id: string;
  friendly_id?: string;
  name: string;
  url: string;
  published_date?: string;
  department?: string;
  salary?: string;
  type?: { id?: string; name?: string };
  location?: {
    country?: { name?: string; id?: string };
    state?: { id?: string; name?: string };
    city?: string;
    name?: string;
    is_remote?: boolean;
  };
  locations?: Array<{
    country?: { id?: string; name?: string };
    state?: { id?: string; name?: string };
    city?: string;
    name?: string;
  }>;
  company?: { name?: string };
};

function buildLocation(job: BreezyJob): string | null {
  const locs = job.locations && job.locations.length > 0 ? job.locations : job.location ? [job.location] : [];
  const usOnly = locs.filter((l) => (l.country?.id ?? "").toUpperCase() === "US");
  if (usOnly.length === 0 && locs.length > 0) return null;
  const display = (usOnly.length > 0 ? usOnly : locs)
    .map((l) => l.name?.trim() || [l.city, l.state?.id].filter(Boolean).join(", "))
    .filter(Boolean);
  if (display.length <= 2) return display.join(" / ") || null;
  return `${display.slice(0, 2).join(" / ")} (+${display.length - 2} more)`;
}

async function fetchSource(source: BreezySource): Promise<RawListing[]> {
  const url = `https://${source.slug}.breezy.hr/json`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Flightpath/0.1" },
  });
  if (!res.ok) throw new Error(`${source.slug}: HTTP ${res.status}`);
  const jobs = (await res.json()) as BreezyJob[];
  return jobs
    .map((j): RawListing | null => {
      if (!j.name || !j.url) return null;
      if (source.titleFilter && !source.titleFilter.test(j.name)) return null;
      const description =
        j.salary || j.department
          ? [j.department && `Department: ${j.department}`, j.salary && `Salary: ${j.salary}`]
              .filter(Boolean)
              .join("\n")
          : null;
      const postedAt = j.published_date ? Date.parse(j.published_date) : Date.now();
      return {
        externalId: `${source.id}-${j.id}`,
        title: j.name.trim(),
        url: j.url,
        description,
        employer: j.company?.name?.trim() || source.name,
        location: buildLocation(j),
        postedAt: Number.isFinite(postedAt) ? postedAt : Date.now(),
      };
    })
    .filter((x): x is RawListing => x !== null);
}

export const breezyAdapter: SourceAdapter = {
  id: "breezy",
  name: "Breezy ATS (flight schools)",
  async fetch(): Promise<RawListing[]> {
    const out: RawListing[] = [];
    const seen = new Set<string>();
    for (const source of SOURCES) {
      try {
        const items = await fetchSource(source);
        console.log(`[breezy:${source.slug}] ${items.length} listings`);
        for (const item of items) {
          if (seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          out.push(item);
        }
      } catch (err) {
        console.warn(`[breezy:${source.slug}] failed:`, err instanceof Error ? err.message : err);
      }
    }
    return out;
  },
};
