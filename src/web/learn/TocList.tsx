import { LEARN_DOCS, type LearnDocId, type LearnTocEntry } from "./types.ts";

/**
 * Left nav for the /learn route: three doc-selector chips at the top,
 * then the current doc's TOC entries underneath.
 */
export function TocList({
  docId,
  toc,
  currentChunkId,
  onSelectDoc,
  onSelectChunk,
}: {
  docId: LearnDocId;
  toc: LearnTocEntry[];
  currentChunkId: string | null;
  onSelectDoc: (id: LearnDocId) => void;
  onSelectChunk: (chunkId: string) => void;
}) {
  return (
    <aside className="w-full md:w-72 shrink-0 border-r border-ink-200 dark:border-ink-700 md:h-screen md:overflow-y-auto">
      <div className="p-3 border-b border-ink-200 dark:border-ink-700">
        <h2 className="text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">Document</h2>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {LEARN_DOCS.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelectDoc(d.id)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                d.id === docId
                  ? "bg-sky-500 text-white"
                  : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              }`}
              title={d.title}
            >
              {d.short}
            </button>
          ))}
        </div>
      </div>
      <nav className="p-2">
        {toc.map((entry) => {
          const active = entry.chunkId === currentChunkId;
          return (
            <button
              key={entry.chunkId}
              onClick={() => onSelectChunk(entry.chunkId)}
              className={`block w-full text-left rounded-md px-2 py-1.5 text-sm transition ${
                active
                  ? "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100"
                  : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
              }`}
            >
              {entry.title}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
