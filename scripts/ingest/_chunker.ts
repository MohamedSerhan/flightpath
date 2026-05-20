/**
 * Shared chunker: groups extracted PDF lines into named chunks
 * by a heading regex. Each per-doc ingest script provides a regex
 * that matches its section headings; the chunker walks the line
 * stream and starts a new chunk every time a heading fires.
 *
 * Build-time only.
 */

import type { PdfPage } from "./_pdf-extract.ts";

export type Chunk = {
  chunkId: string;
  title: string;
  text: string;
  page: number;
};

export type ChunkerOptions = {
  /** Regex that matches a heading line. The first capture group
   *  is used as the chunkId (slugified). */
  headingRegex: RegExp;
  /** Optional transform applied to the captured group to produce
   *  the title (default: trim + collapse whitespace). */
  titleFor?: (match: RegExpExecArray) => string;
  /** Skip these lines anywhere (page headers, footers, copyright). */
  skipLineRegex?: RegExp;
  /** Soft cap on chunk text length. Chunks that exceed it are split
   *  at sentence boundaries into "<title> (part N)" sub-chunks so the
   *  reading pane doesn't have to render a 100-screen wall. Default
   *  12_000 chars (~3-5 minutes of reading per chunk). */
  maxChars?: number;
  /** When true (default), oversized chunks are split into sub-chunks
   *  at sentence boundaries. When false, kept whole with a warning. */
  splitOversized?: boolean;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Split a chunk's text at sentence boundaries into N sub-chunks of
 *  roughly targetSize each. Sub-chunk IDs get `-pt<N>` suffixes; titles
 *  get "(part N of M)" suffixes so the reading pane and TOC stay
 *  navigable. Tries to break only after `.`, `?`, or `!` followed by
 *  whitespace + capital — i.e. real sentence boundaries — so we don't
 *  cut mid-sentence. */
function splitChunk(c: Chunk, targetSize: number): Chunk[] {
  const sentences = c.text.split(/(?<=[.?!]\s)(?=[A-Z])/);
  const buckets: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf.length > 0 && buf.length + s.length > targetSize) {
      buckets.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) buckets.push(buf.trim());
  if (buckets.length <= 1) return [c];
  return buckets.map((text, i) => ({
    chunkId: `${c.chunkId}-pt${i + 1}`,
    title: `${c.title} (part ${i + 1} of ${buckets.length})`,
    text,
    page: c.page,
  }));
}

export function chunkByHeading(pages: PdfPage[], opts: ChunkerOptions): Chunk[] {
  const maxChars = opts.maxChars ?? 12_000;
  const splitOversized = opts.splitOversized !== false;
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;

  for (const { page, lines } of pages) {
    for (const line of lines) {
      if (opts.skipLineRegex && opts.skipLineRegex.test(line)) continue;
      opts.headingRegex.lastIndex = 0;
      const m = opts.headingRegex.exec(line);
      if (m) {
        if (current) chunks.push(current);
        const title = opts.titleFor ? opts.titleFor(m) : m[0].trim();
        const id = m[1] ? slugify(m[1]) : slugify(title);
        current = { chunkId: id, title: title.replace(/\s+/g, " ").trim(), text: "", page };
      } else if (current) {
        current.text += (current.text ? " " : "") + line;
      }
    }
  }
  if (current) chunks.push(current);

  if (!splitOversized) {
    for (const c of chunks) {
      if (c.text.length > maxChars) {
        console.warn(
          `[chunker] chunk ${c.chunkId} is ${c.text.length} chars (cap ${maxChars}) — keeping whole (splitOversized=false)`,
        );
      }
    }
    return chunks;
  }

  // Split each oversized chunk into sub-chunks at sentence boundaries.
  const out: Chunk[] = [];
  for (const c of chunks) {
    if (c.text.length <= maxChars) {
      out.push(c);
    } else {
      const parts = splitChunk(c, maxChars);
      out.push(...parts);
      if (parts.length > 1) {
        console.log(`[chunker] split ${c.chunkId} (${c.text.length} chars) into ${parts.length} parts`);
      }
    }
  }
  return out;
}
