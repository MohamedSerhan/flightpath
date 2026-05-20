import { useMemo } from "react";
import type { LearnChunk } from "./types.ts";

/**
 * Reading pane for a single chunk. Shows the chunk title + body text
 * with prev/next nav along the bottom. Renders an empty-state when
 * no chunk is selected (initial /learn visit).
 */
export function ChunkReader({
  chunk,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  chunk: LearnChunk | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Split the flat chunk text into paragraph-ish blocks. PDF extraction
  // collapses everything into one space-joined stream, so without this
  // the reading pane is a single ~200-line wall. We split at sentence
  // boundaries that look like paragraph breaks: `.` followed by whitespace
  // followed by `[A-Z]`, with a minimum block length of ~400 chars so
  // short consecutive sentences merge into one paragraph.
  const paragraphs = useMemo(() => {
    if (!chunk) return [] as string[];
    const sentences = chunk.text.split(/(?<=\.\s)(?=[A-Z])/);
    const out: string[] = [];
    let buf = "";
    for (const s of sentences) {
      buf += s;
      if (buf.length >= 400) {
        out.push(buf.trim());
        buf = "";
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }, [chunk]);

  if (!chunk) {
    return (
      <div className="flex-1 p-8 text-center text-ink-500 dark:text-ink-400">
        Select a section from the left to start reading.
      </div>
    );
  }
  return (
    <article className="flex-1 md:h-screen md:overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 md:p-10">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-50">{chunk.title}</h1>
        <div className="mt-6 text-ink-800 dark:text-ink-100 leading-7 space-y-4">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="mt-10 flex items-center justify-between border-t border-ink-200 dark:border-ink-700 pt-4">
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 disabled:opacity-40 disabled:cursor-not-allowed dark:border-ink-700 dark:text-ink-200"
          >
            ← Previous
          </button>
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 disabled:opacity-40 disabled:cursor-not-allowed dark:border-ink-700 dark:text-ink-200"
          >
            Next →
          </button>
        </div>
      </div>
    </article>
  );
}
