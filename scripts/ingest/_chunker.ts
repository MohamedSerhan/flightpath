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
  /** Hard cap on chunk text length; longer chunks are kept anyway
   *  but a warning is logged. Default 12_000. */
  maxChars?: number;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function chunkByHeading(pages: PdfPage[], opts: ChunkerOptions): Chunk[] {
  const maxChars = opts.maxChars ?? 12_000;
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

  for (const c of chunks) {
    if (c.text.length > maxChars) {
      console.warn(`[chunker] chunk ${c.chunkId} is ${c.text.length} chars (cap ${maxChars}) — keeping but flagging`);
    }
  }
  return chunks;
}
