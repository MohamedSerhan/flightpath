/**
 * Application pipeline state — localStorage-backed.
 *
 * The browser is the source of truth for what the user has done with each
 * listing. We don't need a backend for this: the data is personal, never
 * needs to be shared, and the user already trusts their browser with all
 * the other state we keep there (filter hash, last visited, etc.).
 *
 * Storage shape:
 *   localStorage["flightpath:pipeline"] = JSON.stringify({
 *     [`${sourceId}:${externalId}`]: { status: PipelineStatus, note?: string, updatedAt: number }
 *   })
 *
 * The key is sourceId+externalId rather than the autoincrement DB id
 * because the DB id can change when the SQLite cache is wiped (rare, but
 * non-zero). sourceId+externalId is stable across all rebuilds.
 */

export type PipelineStatus = "saved" | "applied" | "interviewing" | "offered" | "rejected";

/**
 * Display fields snapshotted into the pipeline entry at save time.
 *
 * Without this, the Logbook can only resolve listings that happen to be in
 * the *currently filtered* Browse list — switch filters, and saved entries
 * orphan into "dropped out of window" placeholders. Snapshotting makes the
 * Logbook self-sufficient regardless of filter state, and also preserves
 * entries when the listing itself ages out of the 30-day window.
 *
 * `manual: true` flags entries the user typed in for a job they applied to
 * outside of Flightpath (e.g. a posting we don't scrape).
 */
export type ListingSnapshot = {
  title: string;
  employer: string | null;
  location: string | null;
  url: string;
  postedAt?: number;
  jobCategory?: string | null;
  manual?: boolean;
};

export type PipelineEntry = {
  status: PipelineStatus;
  note?: string;
  updatedAt: number;
  snapshot?: ListingSnapshot;
};

export type PipelineMap = Record<string, PipelineEntry>;

const STORAGE_KEY = "flightpath:pipeline";

export function entryKey(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`;
}

export function manualKey(): string {
  return `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function isManualKey(key: string): boolean {
  return key.startsWith("manual:");
}

export function readPipeline(): PipelineMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as PipelineMap) : {};
  } catch {
    return {};
  }
}

export function writePipeline(map: PipelineMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function setStatus(
  map: PipelineMap,
  key: string,
  status: PipelineStatus | null,
  opts?: { snapshot?: ListingSnapshot; note?: string },
): PipelineMap {
  const next = { ...map };
  if (status === null) {
    delete next[key];
  } else {
    const prev = next[key];
    next[key] = {
      status,
      note: opts?.note ?? prev?.note,
      updatedAt: Date.now(),
      snapshot: opts?.snapshot ?? prev?.snapshot,
    };
  }
  return next;
}

export function updateNote(map: PipelineMap, key: string, note: string | undefined): PipelineMap {
  const prev = map[key];
  if (!prev) return map;
  const next = { ...map };
  next[key] = { ...prev, note, updatedAt: Date.now() };
  return next;
}

export const STATUS_ORDER: PipelineStatus[] = [
  "saved",
  "applied",
  "interviewing",
  "offered",
  "rejected",
];

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offered: "Offered",
  rejected: "Rejected",
};

export const STATUS_TONES: Record<PipelineStatus, string> = {
  saved: "bg-amber-100 text-amber-800 ring-amber-200",
  applied: "bg-sky-100 text-sky-800 ring-sky-200",
  interviewing: "bg-violet-100 text-violet-800 ring-violet-200",
  offered: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-100 text-rose-700 ring-rose-200",
};

export function exportToCsv(
  map: PipelineMap,
  resolver: (key: string) => { title?: string; employer?: string | null; location?: string | null; url?: string } | undefined,
): string {
  const rows = [["Status", "Title", "Employer", "Location", "URL", "Updated", "Note"]];
  for (const [key, entry] of Object.entries(map)) {
    const r = entry.snapshot ?? resolver(key);
    rows.push([
      STATUS_LABELS[entry.status],
      r?.title ?? "",
      r?.employer ?? "",
      r?.location ?? "",
      r?.url ?? "",
      new Date(entry.updatedAt).toISOString(),
      entry.note ?? "",
    ]);
  }
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}
