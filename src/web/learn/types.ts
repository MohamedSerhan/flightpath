/**
 * Shared types for the /learn route.
 *
 * The ingest pipeline (scripts/ingest/) writes per-doc index.json and
 * chunks.json plus a flat search-index.json; these types describe the
 * shape the client fetches and renders.
 */

export type LearnDocId = "phak" | "commercial-acs" | "far";

export type LearnTocEntry = {
  chunkId: string;
  title: string;
  page: number;
};

export type LearnChunk = {
  chunkId: string;
  title: string;
  text: string;
};

export type LearnSearchHit = {
  docId: LearnDocId;
  docTitle: string;
  chunkId: string;
  title: string;
  snippet: string;
};

/** Doc registry — drives the doc-selector tabs in the UI. `short` is
 *  the chip label; `title` is the full title for the search-hit header. */
export const LEARN_DOCS: { id: LearnDocId; title: string; short: string }[] = [
  { id: "phak", title: "Pilot's Handbook of Aeronautical Knowledge", short: "PHAK" },
  { id: "commercial-acs", title: "Commercial Pilot ACS", short: "Commercial ACS" },
  { id: "far", title: "FAR (Parts 61/91/119/135/141)", short: "FAR" },
];
