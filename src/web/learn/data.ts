/**
 * Lazy fetchers for the /learn route's JSON data files.
 *
 * Each per-doc index is small (~10 KB) so fetched on doc selection.
 * The chunks file is larger (~1-3 MB) so fetched the first time the
 * user opens that doc — cached in-memory across subsequent toggles.
 * The cross-doc search index (~200 KB) is fetched once on mount so
 * search results are instant.
 */

import type {
  LearnChunk,
  LearnDocId,
  LearnSearchHit,
  LearnTocEntry,
} from "./types.ts";

const base = (() => {
  const b = import.meta.env.BASE_URL || "/";
  return b.endsWith("/") ? b : `${b}/`;
})();

const indexCache = new Map<LearnDocId, LearnTocEntry[]>();
const chunksCache = new Map<LearnDocId, LearnChunk[]>();
let searchCache: LearnSearchHit[] | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`fetch ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function getDocIndex(docId: LearnDocId): Promise<LearnTocEntry[]> {
  const cached = indexCache.get(docId);
  if (cached) return cached;
  const data = await fetchJson<LearnTocEntry[]>(`data/learn/${docId}/index.json`);
  indexCache.set(docId, data);
  return data;
}

export async function getDocChunks(docId: LearnDocId): Promise<LearnChunk[]> {
  const cached = chunksCache.get(docId);
  if (cached) return cached;
  const data = await fetchJson<LearnChunk[]>(`data/learn/${docId}/chunks.json`);
  chunksCache.set(docId, data);
  return data;
}

export async function getSearchIndex(): Promise<LearnSearchHit[]> {
  if (searchCache) return searchCache;
  searchCache = await fetchJson<LearnSearchHit[]>(`data/learn/search-index.json`);
  return searchCache;
}
