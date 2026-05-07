import type { Listing, ListingFilter, ListingsResponse, SourceMeta } from "../shared/types.ts";

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

export async function fetchListings(filter: ListingFilter): Promise<ListingsResponse> {
  const url = `${BASE}/listings${qs({ ...filter })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchListings: HTTP ${res.status}`);
  return res.json();
}

export async function fetchListing(id: number): Promise<Listing> {
  const res = await fetch(`${BASE}/listings/${id}`);
  if (!res.ok) throw new Error(`fetchListing: HTTP ${res.status}`);
  return res.json();
}

export async function fetchSources(): Promise<SourceMeta[]> {
  const res = await fetch(`${BASE}/sources`);
  if (!res.ok) throw new Error(`fetchSources: HTTP ${res.status}`);
  return res.json();
}

export async function fetchSummary(): Promise<{
  fresh30d: number;
  byCategory: Array<{ category: string | null; count: number }>;
}> {
  const res = await fetch(`${BASE}/listings/stats/summary`);
  if (!res.ok) throw new Error(`fetchSummary: HTTP ${res.status}`);
  return res.json();
}
