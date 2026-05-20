import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChunkReader } from "./ChunkReader.tsx";
import { SearchBar } from "./SearchBar.tsx";
import { TocList } from "./TocList.tsx";
import { getDocChunks, getDocIndex } from "./data.ts";
import type { LearnDocId } from "./types.ts";

/**
 * /learn route root. Layout:
 *   [Header — site title + back-to-listings link]
 *   [SearchBar — cross-doc search input + results]
 *   [TocList | ChunkReader]
 *
 * Navigation between docs and chunks is via hash params
 * (#doc=phak&chunk=ch-4-2) so links are shareable and the back/forward
 * button works. State syncs both directions via the hashchange event.
 */

function readHash(): { doc: LearnDocId; chunk: string | null } {
  if (typeof window === "undefined") return { doc: "phak", chunk: null };
  const usp = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const doc = (usp.get("doc") as LearnDocId) || "phak";
  const chunk = usp.get("chunk");
  return { doc, chunk };
}

function writeHash(doc: LearnDocId, chunk: string | null) {
  const usp = new URLSearchParams();
  usp.set("doc", doc);
  if (chunk) usp.set("chunk", chunk);
  window.location.hash = usp.toString();
}

export function LearnApp() {
  const [{ doc, chunk: chunkId }, setState] = useState(readHash());

  useEffect(() => {
    const onHashChange = () => setState(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const tocQ = useQuery({
    queryKey: ["learn-toc", doc],
    queryFn: () => getDocIndex(doc),
  });
  const chunksQ = useQuery({
    queryKey: ["learn-chunks", doc],
    queryFn: () => getDocChunks(doc),
  });

  const toc = tocQ.data ?? [];
  const chunks = chunksQ.data ?? [];
  const currentIndex = chunks.findIndex((c) => c.chunkId === chunkId);
  const current = currentIndex >= 0 ? chunks[currentIndex] : null;

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-900 text-ink-900 dark:text-ink-50">
      <header className="border-b border-ink-200 dark:border-ink-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Flightpath — Learn</h1>
        </div>
        <a
          href={import.meta.env.BASE_URL}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400 dark:border-ink-700 dark:text-ink-200"
        >
          ← Listings
        </a>
      </header>
      <SearchBar onSelectHit={(d, c) => writeHash(d, c)} />
      <div className="flex flex-col md:flex-row">
        <TocList
          docId={doc}
          toc={toc}
          currentChunkId={chunkId}
          onSelectDoc={(d) => writeHash(d, null)}
          onSelectChunk={(c) => writeHash(doc, c)}
        />
        <ChunkReader
          chunk={current}
          hasPrev={currentIndex > 0}
          hasNext={currentIndex >= 0 && currentIndex < chunks.length - 1}
          onPrev={() => writeHash(doc, chunks[currentIndex - 1]?.chunkId ?? null)}
          onNext={() => writeHash(doc, chunks[currentIndex + 1]?.chunkId ?? null)}
        />
      </div>
    </div>
  );
}
