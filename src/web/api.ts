import type { Listing, ListingFilter, ListingsResponse, SourceMeta } from "../shared/types.ts";

/**
 * Two-mode data layer:
 *
 *   - Live mode (dev / self-hosted): hits /api/* on the Hono server.
 *   - Static mode (GitHub Pages): loads /data/listings.json once and
 *     filters in-browser. This is what makes the free 24/7 deploy work.
 *
 * The mode is selected at build time via VITE_STATIC_DATA. Filtering in
 * static mode is done in JavaScript over the in-memory bundle — fine for
 * thousands of listings, which is what we'd expect for the v0.x range.
 */

const STATIC = (import.meta as { env?: { VITE_STATIC_DATA?: string } }).env?.VITE_STATIC_DATA === "1";
const BASE = "/api";

function qs(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

type Bundle = {
  generatedAt: number;
  count: number;
  listings: Listing[];
  sources: SourceMeta[];
};

let bundlePromise: Promise<Bundle> | null = null;

function loadBundle(): Promise<Bundle> {
  if (!bundlePromise) {
    bundlePromise = fetch(`${import.meta.env.BASE_URL ?? "/"}data/listings.json`).then((r) => {
      if (!r.ok) throw new Error(`bundle: HTTP ${r.status}`);
      return r.json();
    });
  }
  return bundlePromise;
}

function applyFilter(listings: Listing[], f: ListingFilter): Listing[] {
  let out = listings;
  if (f.postedSinceDays && f.postedSinceDays > 0) {
    const cutoff = Date.now() - f.postedSinceDays * 86400_000;
    out = out.filter((l) => l.postedAt >= cutoff);
  }
  if (f.category) out = out.filter((l) => l.jobCategory === f.category);
  if (f.state) out = out.filter((l) => l.state === f.state);
  if (f.source) out = out.filter((l) => l.sourceId === f.source);
  if (typeof f.maxHoursRequired === "number") {
    out = out.filter((l) => l.hoursRequired === null || l.hoursRequired <= f.maxHoursRequired!);
  }
  if (f.q) {
    const needle = f.q.toLowerCase();
    out = out.filter((l) =>
      [l.title, l.employer, l.location, l.description].some(
        (s) => s && s.toLowerCase().includes(needle),
      ),
    );
  }
  return out;
}

export async function fetchListings(filter: ListingFilter): Promise<ListingsResponse> {
  if (STATIC) {
    const bundle = await loadBundle();
    const filtered = applyFilter(bundle.listings, filter);
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
  }
  const url = `${BASE}/listings${qs({ ...filter })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchListings: HTTP ${res.status}`);
  return res.json();
}

export async function fetchListing(id: number): Promise<Listing> {
  if (STATIC) {
    const bundle = await loadBundle();
    const found = bundle.listings.find((l) => l.id === id);
    if (!found) throw new Error("not found");
    return found;
  }
  const res = await fetch(`${BASE}/listings/${id}`);
  if (!res.ok) throw new Error(`fetchListing: HTTP ${res.status}`);
  return res.json();
}

export async function fetchSources(): Promise<SourceMeta[]> {
  if (STATIC) return (await loadBundle()).sources;
  const res = await fetch(`${BASE}/sources`);
  if (!res.ok) throw new Error(`fetchSources: HTTP ${res.status}`);
  return res.json();
}

export async function fetchSummary(): Promise<{
  fresh30d: number;
  byCategory: Array<{ category: string | null; count: number }>;
}> {
  if (STATIC) {
    const bundle = await loadBundle();
    const cutoff = Date.now() - 30 * 86400_000;
    const fresh = bundle.listings.filter((l) => l.postedAt >= cutoff);
    const byCategoryMap = new Map<string | null, number>();
    for (const l of fresh) {
      byCategoryMap.set(l.jobCategory, (byCategoryMap.get(l.jobCategory) ?? 0) + 1);
    }
    return {
      fresh30d: fresh.length,
      byCategory: Array.from(byCategoryMap.entries()).map(([category, count]) => ({
        category,
        count,
      })),
    };
  }
  const res = await fetch(`${BASE}/listings/stats/summary`);
  if (!res.ok) throw new Error(`fetchSummary: HTTP ${res.status}`);
  return res.json();
}
