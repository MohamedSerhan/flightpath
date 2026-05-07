/**
 * Viewed-state tracker — like RSS-reader read/unread.
 *
 * The Logbook tracks deliberate intent (Saved / Applied / etc.). This
 * tracks the lighter "I clicked into this listing" signal, so the
 * sibling can scan a 400-listing scroll and tell at a glance what's
 * been opened vs. what's still new — without having to hit a Save
 * button on everything.
 *
 * Storage: localStorage["flightpath:viewed"] = { [key]: timestamp }
 * Key format: sourceId + ":" + externalId — same shape as the pipeline,
 * stable across SQLite cache rebuilds.
 *
 * Pruning: entries older than 90 days are dropped on read. Listings
 * themselves roll out of the 30-day window long before that, so we'd
 * just be carrying dead keys; 90 keeps a small grace window if a
 * listing's postedAt drifts.
 */

const STORAGE_KEY = "flightpath:viewed";
const PRUNE_AFTER_DAYS = 90;

export type ViewedMap = Record<string, number>;

export function readViewed(): ViewedMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const cutoff = Date.now() - PRUNE_AFTER_DAYS * 86400_000;
    const out: ViewedMap = {};
    for (const [k, v] of Object.entries(parsed as ViewedMap)) {
      if (typeof v === "number" && v >= cutoff) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeViewed(map: ViewedMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors — viewed-state is best-effort */
  }
}

export function viewedKey(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`;
}
