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
        <div className="mt-6 text-ink-800 dark:text-ink-100 whitespace-pre-wrap leading-relaxed">
          {chunk.text}
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
