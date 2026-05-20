import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSearchIndex } from "./data.ts";
import type { LearnDocId, LearnSearchHit } from "./types.ts";

/**
 * Cross-doc search bar. Debounced (150ms) substring match against the
 * flat search-index.json fields (title + snippet). Results grouped by
 * doc, capped at 50. Clicking a result navigates to that chunk via
 * the parent's writeHash callback.
 */
export function SearchBar({
  onSelectHit,
}: {
  onSelectHit: (docId: LearnDocId, chunkId: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw), 150);
    return () => clearTimeout(t);
  }, [raw]);

  const indexQ = useQuery({
    queryKey: ["learn-search-index"],
    queryFn: getSearchIndex,
    staleTime: Infinity,
  });

  const q = debounced.trim().toLowerCase();
  const hits: LearnSearchHit[] = (() => {
    if (!q || !indexQ.data) return [];
    const out: LearnSearchHit[] = [];
    for (const e of indexQ.data) {
      if (e.title.toLowerCase().includes(q) || e.snippet.toLowerCase().includes(q)) {
        out.push(e);
        if (out.length >= 50) break;
      }
    }
    return out;
  })();

  const byDoc = new Map<LearnDocId, LearnSearchHit[]>();
  for (const h of hits) {
    if (!byDoc.has(h.docId)) byDoc.set(h.docId, []);
    byDoc.get(h.docId)!.push(h);
  }

  return (
    <div className="px-4 py-3 border-b border-ink-200 dark:border-ink-700">
      <input
        type="search"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Search across PHAK, ACS, and FAR…"
        className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
      />
      {q && (
        <div className="mt-3 space-y-3">
          {hits.length === 0 && (
            <p className="text-sm text-ink-500 dark:text-ink-400">No matches.</p>
          )}
          {[...byDoc.entries()].map(([docId, group]) => (
            <div key={docId}>
              <h3 className="text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {group[0].docTitle}
              </h3>
              <ul className="mt-1 space-y-1">
                {group.map((hit) => (
                  <li key={`${hit.docId}-${hit.chunkId}`}>
                    <button
                      onClick={() => {
                        onSelectHit(hit.docId, hit.chunkId);
                        setRaw("");
                      }}
                      className="block w-full text-left rounded-md px-2 py-1.5 text-sm text-ink-800 hover:bg-ink-100 dark:text-ink-100 dark:hover:bg-ink-800"
                    >
                      <span className="font-medium">{hit.title}</span>
                      <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                        {hit.snippet.slice(0, 80)}…
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
