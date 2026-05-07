import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plane,
  MapPin,
  Clock,
  Search,
  Filter,
  ExternalLink,
  X,
  Bookmark,
  CheckCircle2,
  Briefcase,
  Star,
  XCircle,
  Download,
} from "lucide-react";
import { fetchListings, fetchSources, fetchSummary } from "./api.ts";
import type { JobCategory, Listing, ListingFilter } from "../shared/types.ts";
import {
  entryKey,
  exportToCsv,
  readPipeline,
  setStatus,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_TONES,
  writePipeline,
  type PipelineMap,
  type PipelineStatus,
} from "./pipeline.ts";

/**
 * Filter state ↔ URL hash sync.
 *
 * The hash carries every filter the user has set so the URL is bookmarkable
 * and shareable ("send your sibling this link of CFI roles in TX with ≤500
 * hours required"). On first load we restore from the hash; on every change
 * we push back into it. localStorage holds the most recent filter as a
 * fallback for users who land on the bare URL.
 */
const STORAGE_KEY = "flightpath:lastFilter";

function readFilterFromUrl(): ListingFilter {
  const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  if (hash) {
    const usp = new URLSearchParams(hash);
    return parseFilter(usp);
  }
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return { postedSinceDays: 30, limit: 50, ...JSON.parse(saved) };
      } catch {
        /* fall through */
      }
    }
  }
  return { postedSinceDays: 30, limit: 50 };
}

function parseFilter(usp: URLSearchParams): ListingFilter {
  const num = (k: string) => {
    const v = usp.get(k);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    q: usp.get("q") ?? undefined,
    category: (usp.get("category") as JobCategory) ?? undefined,
    state: usp.get("state") ?? undefined,
    source: usp.get("source") ?? undefined,
    postedSinceDays: num("postedSinceDays") ?? 30,
    maxHoursRequired: num("maxHoursRequired"),
    limit: num("limit") ?? 50,
    offset: num("offset") ?? 0,
  };
}

function writeFilterToUrl(f: ListingFilter): void {
  if (typeof window === "undefined") return;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    if ((k === "postedSinceDays" && v === 30) || (k === "limit" && v === 50) || (k === "offset" && v === 0)) continue;
    usp.set(k, String(v));
  }
  const hash = usp.toString();
  const target = hash ? `#${hash}` : "";
  if (window.location.hash !== target) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${target}`);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* ignore quota errors */
  }
}

const CATEGORY_LABELS: Record<JobCategory, string> = {
  cfi: "CFI",
  cfii: "CFII",
  mei: "MEI",
  part135: "Part 135",
  part91: "Part 91 / Time-build",
  airline: "Airline",
  corporate: "Corporate",
  other: "Other",
};

const CATEGORY_ORDER: JobCategory[] = [
  "cfi",
  "cfii",
  "mei",
  "part135",
  "part91",
  "corporate",
  "airline",
  "other",
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV",
  "WI","WY","DC",
];

/** One-tap filter presets aimed at the low-time CFI persona. */
const PRESETS: Array<{ id: string; label: string; filter: ListingFilter }> = [
  {
    id: "cfi-any",
    label: "All CFI roles",
    filter: { category: "cfi", postedSinceDays: 30, limit: 50 },
  },
  {
    id: "low-time",
    label: "Low-time CFI (<500 hr)",
    filter: { category: "cfi", maxHoursRequired: 500, postedSinceDays: 30, limit: 50 },
  },
  {
    id: "pre-atp",
    label: "Pre-ATP (<1500 hr)",
    filter: { maxHoursRequired: 1500, postedSinceDays: 30, limit: 50 },
  },
  {
    id: "fresh-week",
    label: "Posted this week",
    filter: { postedSinceDays: 7, limit: 50 },
  },
  {
    id: "all-fresh",
    label: "All fresh listings",
    filter: { postedSinceDays: 30, limit: 50 },
  },
];

function presetMatches(preset: ListingFilter, current: ListingFilter): boolean {
  const keys: Array<keyof ListingFilter> = ["category", "maxHoursRequired", "postedSinceDays", "state", "source", "q"];
  return keys.every((k) => (preset[k] ?? undefined) === (current[k] ?? undefined));
}

type View = "browse" | "pipeline";

export function App() {
  const [filter, setFilter] = useState<ListingFilter>(() => readFilterFromUrl());
  const [showFilters, setShowFilters] = useState(false);
  const [active, setActive] = useState<Listing | null>(null);
  const [view, setView] = useState<View>("browse");
  const [pipeline, setPipelineMap] = useState<PipelineMap>(() => readPipeline());

  useEffect(() => {
    writeFilterToUrl(filter);
  }, [filter]);

  useEffect(() => {
    writePipeline(pipeline);
  }, [pipeline]);

  function setListingStatus(listing: Listing, status: PipelineStatus | null) {
    setPipelineMap((prev) => setStatus(prev, entryKey(listing.sourceId, listing.externalId), status));
  }

  function statusOf(listing: Listing): PipelineStatus | null {
    return pipeline[entryKey(listing.sourceId, listing.externalId)]?.status ?? null;
  }

  const listingsQ = useQuery({
    queryKey: ["listings", filter],
    queryFn: () => fetchListings(filter),
  });

  const sourcesQ = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const summaryQ = useQuery({ queryKey: ["summary"], queryFn: fetchSummary });

  const lastUpdate = useMemo(() => {
    const ts = sourcesQ.data?.reduce<number | null>((acc, s) => {
      if (!s.lastSuccessAt) return acc;
      if (!acc || s.lastSuccessAt > acc) return s.lastSuccessAt;
      return acc;
    }, null);
    return ts;
  }, [sourcesQ.data]);

  function update<K extends keyof ListingFilter>(key: K, value: ListingFilter[K]) {
    setFilter((f) => ({ ...f, [key]: value, offset: 0 }));
  }

  const filterChips = useMemo(() => {
    const chips: Array<{ key: keyof ListingFilter; label: string }> = [];
    if (filter.q) chips.push({ key: "q", label: `“${filter.q}”` });
    if (filter.category) chips.push({ key: "category", label: CATEGORY_LABELS[filter.category] });
    if (filter.state) chips.push({ key: "state", label: filter.state });
    if (filter.maxHoursRequired)
      chips.push({ key: "maxHoursRequired", label: `≤ ${filter.maxHoursRequired} hrs` });
    if (filter.postedSinceDays && filter.postedSinceDays !== 30)
      chips.push({ key: "postedSinceDays", label: `last ${filter.postedSinceDays}d` });
    return chips;
  }, [filter]);

  const pipelineCount = Object.keys(pipeline).length;

  return (
    <div className="min-h-dvh">
      <Header
        lastUpdate={lastUpdate}
        fresh30d={summaryQ.data?.fresh30d ?? null}
        onToggleFilters={() => setShowFilters((s) => !s)}
        showFilters={showFilters}
        view={view}
        onSetView={setView}
        pipelineCount={pipelineCount}
      />

      {view === "pipeline" && (
        <PipelineView
          pipeline={pipeline}
          listings={listingsQ.data?.items ?? []}
          onOpen={setActive}
          onSetStatus={setListingStatus}
          onClearAll={() => setPipelineMap({})}
        />
      )}

      {view === "browse" && (
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <SearchBar value={filter.q ?? ""} onChange={(v) => update("q", v || undefined)} />

        <div className="mt-3 -mx-4 overflow-x-auto px-4 pb-1">
          <div className="flex gap-2 whitespace-nowrap">
            {PRESETS.map((p) => {
              const active = presetMatches(p.filter, filter);
              return (
                <button
                  key={p.id}
                  onClick={() => setFilter(p.filter)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "border-sky-500 bg-sky-500 text-white"
                      : "border-ink-200 bg-white text-ink-600 hover:border-ink-400"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {filterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <button
                key={chip.key as string}
                onClick={() => update(chip.key, undefined as never)}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-600 hover:bg-sky-500/20"
              >
                {chip.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        {showFilters && (
          <FilterPanel filter={filter} onChange={setFilter} onClose={() => setShowFilters(false)} />
        )}

        <div className="mt-6">
          {listingsQ.isLoading && <ListSkeleton />}
          {listingsQ.error && (
            <ErrorBox message={(listingsQ.error as Error).message} onRetry={() => listingsQ.refetch()} />
          )}
          {listingsQ.data && (
            <>
              <div className="mb-3 flex items-center justify-between text-sm text-ink-400">
                <span>
                  {listingsQ.data.total} {listingsQ.data.total === 1 ? "listing" : "listings"}
                </span>
                {listingsQ.isFetching && <span className="text-xs">refreshing…</span>}
              </div>
              {listingsQ.data.items.length === 0 ? (
                <EmptyState />
              ) : (
                <ul className="space-y-3">
                  {listingsQ.data.items.map((l) => (
                    <ListingCard
                      key={l.id}
                      listing={l}
                      status={statusOf(l)}
                      onOpen={() => setActive(l)}
                      onSetStatus={(s) => setListingStatus(l, s)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </main>
      )}

      <footer className="safe-bottom mx-auto mt-12 max-w-3xl px-4 pb-6 text-center text-xs text-ink-400">
        Get notified of new CFI roles via RSS:{" "}
        <a
          href={`${import.meta.env.BASE_URL ?? "/"}feed-cfi.xml`}
          className="font-medium text-sky-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          CFI / CFII / MEI feed
        </a>
        {" · "}
        <a
          href={`${import.meta.env.BASE_URL ?? "/"}feed.xml`}
          className="font-medium text-sky-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          all listings
        </a>
        <div className="mt-1">Drop the URL into Feedly, Inoreader, or any RSS-to-email service.</div>
      </footer>

      {active && (
        <ListingDetail
          listing={active}
          status={statusOf(active)}
          onClose={() => setActive(null)}
          onSetStatus={(s) => setListingStatus(active, s)}
        />
      )}
    </div>
  );
}

function Header({
  lastUpdate,
  fresh30d,
  onToggleFilters,
  showFilters,
  view,
  onSetView,
  pipelineCount,
}: {
  lastUpdate: number | null | undefined;
  fresh30d: number | null;
  onToggleFilters: () => void;
  showFilters: boolean;
  view: View;
  onSetView: (v: View) => void;
  pipelineCount: number;
}) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-ink-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={() => onSetView("browse")}
          className="flex items-center gap-2 text-left"
        >
          <div className="rounded-lg bg-sky-500 p-1.5 text-white">
            <Plane className="h-5 w-5" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold text-ink-900">Flightpath</div>
            <div className="truncate text-xs text-ink-400">
              {fresh30d !== null ? `${fresh30d} fresh in last 30 days` : "Fresh pilot jobs"}
              {lastUpdate ? ` · ${formatAgo(lastUpdate)}` : ""}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSetView(view === "pipeline" ? "browse" : "pipeline")}
            className={`relative inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              view === "pipeline"
                ? "border-sky-500 bg-sky-500 text-white"
                : "border-ink-200 bg-white text-ink-800 hover:border-ink-400"
            }`}
          >
            <Briefcase className="h-4 w-4" />
            <span className="hidden sm:inline">Pipeline</span>
            {pipelineCount > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold ${
                  view === "pipeline" ? "bg-white text-sky-600" : "bg-sky-500 text-white"
                }`}
              >
                {pipelineCount}
              </span>
            )}
          </button>
          {view === "browse" && (
            <button
              onClick={onToggleFilters}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                showFilters
                  ? "border-sky-500 bg-sky-500 text-white"
                  : "border-ink-200 bg-white text-ink-800 hover:border-ink-400"
              }`}
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

const STATUS_ICONS: Record<PipelineStatus, typeof Bookmark> = {
  saved: Bookmark,
  applied: CheckCircle2,
  interviewing: Briefcase,
  offered: Star,
  rejected: XCircle,
};

function StatusButton({
  status,
  active,
  onClick,
  size = "sm",
}: {
  status: PipelineStatus;
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: "sm" | "md";
}) {
  const Icon = STATUS_ICONS[status];
  const tone = STATUS_TONES[status];
  const dim = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      onClick={onClick}
      title={STATUS_LABELS[status]}
      className={`inline-flex items-center justify-center rounded-md p-1.5 ring-1 transition ${
        active ? tone : "bg-white text-ink-400 ring-ink-100 hover:text-ink-800"
      }`}
    >
      <Icon className={dim} />
    </button>
  );
}

function PipelineView({
  pipeline,
  listings,
  onOpen,
  onSetStatus,
  onClearAll,
}: {
  pipeline: PipelineMap;
  listings: Listing[];
  onOpen: (l: Listing) => void;
  onSetStatus: (l: Listing, s: PipelineStatus | null) => void;
  onClearAll: () => void;
}) {
  // listings comes from current filter — but pipeline lookup is by sourceId
  // + externalId, which is stable. We resolve from in-memory listings first
  // and fall back to a placeholder if a saved listing has aged out of view.
  const byKey = useMemo(() => {
    const m = new Map<string, Listing>();
    for (const l of listings) m.set(entryKey(l.sourceId, l.externalId), l);
    return m;
  }, [listings]);

  const grouped = useMemo(() => {
    const out: Record<PipelineStatus, Array<{ key: string; listing: Listing | null; entry: PipelineMap[string] }>> = {
      saved: [],
      applied: [],
      interviewing: [],
      offered: [],
      rejected: [],
    };
    for (const [key, entry] of Object.entries(pipeline)) {
      out[entry.status].push({ key, listing: byKey.get(key) ?? null, entry });
    }
    for (const k of STATUS_ORDER) {
      out[k].sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
    }
    return out;
  }, [pipeline, byKey]);

  function downloadCsv() {
    const csv = exportToCsv(pipeline, (key) => {
      const l = byKey.get(key);
      return l
        ? { title: l.title, employer: l.employer, location: l.location, url: l.url }
        : undefined;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flightpath-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const total = Object.keys(pipeline).length;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24">
      <div className="my-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-600">
          {total === 0
            ? "No applications tracked yet — tap the icons on a listing to save / mark applied."
            : `${total} listings in your pipeline`}
        </div>
        {total > 0 && (
          <div className="flex gap-2">
            <button
              onClick={downloadCsv}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 hover:border-ink-400"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={() => {
                if (confirm("Clear all pipeline entries? This cannot be undone.")) onClearAll();
              }}
              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:border-rose-400"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {STATUS_ORDER.map((status) => {
        const items = grouped[status];
        if (items.length === 0) return null;
        return (
          <section key={status} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-400">
              {STATUS_LABELS[status]} · {items.length}
            </h3>
            <ul className="space-y-2">
              {items.map(({ key, listing }) => (
                <li key={key} className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm">
                  {listing ? (
                    <div className="flex items-start justify-between gap-3">
                      <button onClick={() => onOpen(listing)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-semibold text-ink-900">
                          {listing.title}
                        </div>
                        <div className="truncate text-xs text-ink-400">
                          {listing.employer}
                          {listing.location ? ` · ${listing.location}` : ""}
                        </div>
                      </button>
                      <button
                        onClick={() =>
                          onSetStatus(listing, null)
                        }
                        className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
                        title="Remove from pipeline"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs italic text-ink-400">
                      Listing dropped out of the 30-day window — apply state retained ({key}).
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-4">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search title, employer, location…"
          className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
        />
      </label>
    </div>
  );
}

function FilterPanel({
  filter,
  onChange,
  onClose,
}: {
  filter: ListingFilter;
  onChange: (f: ListingFilter) => void;
  onClose: () => void;
}) {
  function set<K extends keyof ListingFilter>(key: K, value: ListingFilter[K]) {
    onChange({ ...filter, [key]: value, offset: 0 });
  }
  return (
    <div className="mt-4 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Category</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CATEGORY_ORDER.map((cat) => {
              const selected = filter.category === cat;
              return (
                <button
                  key={cat}
                  onClick={() => set("category", selected ? undefined : cat)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    selected
                      ? "border-sky-500 bg-sky-500 text-white"
                      : "border-ink-200 bg-white text-ink-600 hover:border-ink-400"
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>State</Label>
          <select
            value={filter.state ?? ""}
            onChange={(e) => set("state", e.target.value || undefined)}
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          >
            <option value="">Any state</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label>Posted within</Label>
          <select
            value={filter.postedSinceDays ?? 30}
            onChange={(e) => set("postedSinceDays", Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={365}>All time (capped 1 yr)</option>
          </select>
        </div>

        <div>
          <Label>Max total hours required</Label>
          <select
            value={filter.maxHoursRequired ?? ""}
            onChange={(e) => set("maxHoursRequired", e.target.value ? Number(e.target.value) : undefined)}
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          >
            <option value="">No limit</option>
            <option value={250}>≤ 250 hrs</option>
            <option value={500}>≤ 500 hrs</option>
            <option value={1000}>≤ 1,000 hrs</option>
            <option value={1500}>≤ 1,500 hrs</option>
          </select>
          <p className="mt-1 text-xs text-ink-400">
            Includes listings with no parsed requirement.
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-between">
        <button
          onClick={() => onChange({ postedSinceDays: 30, limit: filter.limit ?? 50 })}
          className="text-xs font-medium text-ink-400 hover:text-ink-800"
        >
          Reset all
        </button>
        <button
          onClick={onClose}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{children}</div>;
}

const SOURCE_LABELS: Record<string, string> = {
  jsfirm: "JSfirm",
  ats: "ATS",
  workday: "Workday",
  "atp-cfi": "ATP",
  skywest: "SkyWest",
  climbto350: "Climbto350",
  pcc: "PCC",
  findapilot: "FindAPilot",
  reddit: "Reddit",
  usajobs: "USAJobs",
  aerocrewnews: "AeroCrewNews",
};

/** Last segment of a URL path — used as a final-resort visual ID when
 *  two cards otherwise look identical. */
function urlTail(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? u.hostname;
  } catch {
    return "";
  }
}

function ListingCard({
  listing,
  status,
  onOpen,
  onSetStatus,
}: {
  listing: Listing;
  status: PipelineStatus | null;
  onOpen: () => void;
  onSetStatus: (s: PipelineStatus | null) => void;
}) {
  const sourceLabel = SOURCE_LABELS[listing.sourceId] ?? listing.sourceId;
  const tail = !listing.location ? urlTail(listing.url) : "";
  return (
    <li>
      <button
        onClick={onOpen}
        className="block w-full rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-sm transition hover:border-sky-500 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-ink-900">{listing.title}</h3>
            {listing.employer && (
              <div className="mt-0.5 truncate text-sm text-ink-600">{listing.employer}</div>
            )}
          </div>
          {listing.jobCategory && (
            <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
              {CATEGORY_LABELS[listing.jobCategory] ?? listing.jobCategory}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          {listing.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {listing.location}
            </span>
          ) : tail ? (
            <span
              className="inline-flex items-center gap-1 truncate font-mono text-[10px] text-ink-400/80"
              title={listing.url}
            >
              #{tail}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatAgo(listing.postedAt)}
          </span>
          {listing.hoursRequired && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
              {listing.hoursRequired.toLocaleString()} hr min
            </span>
          )}
          <span
            className="ml-auto rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-400 ring-1 ring-ink-100"
            title={`Source: ${sourceLabel}`}
          >
            {sourceLabel}
          </span>
        </div>

        {listing.ratingsRequired && listing.ratingsRequired.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {listing.ratingsRequired.slice(0, 5).map((r) => (
              <span key={r} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600">
                {r}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-3 flex items-center gap-1.5 border-t border-ink-100 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_ORDER.map((s) => (
            <StatusButton
              key={s}
              status={s}
              active={status === s}
              onClick={(e) => {
                e.stopPropagation();
                onSetStatus(status === s ? null : s);
              }}
            />
          ))}
          {status && (
            <span className={`ml-auto rounded px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_TONES[status]}`}>
              {STATUS_LABELS[status]}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function ListingDetail({
  listing,
  status,
  onClose,
  onSetStatus,
}: {
  listing: Listing;
  status: PipelineStatus | null;
  onClose: () => void;
  onSetStatus: (s: PipelineStatus | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="safe-bottom flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-ink-100 p-4">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-lg font-semibold text-ink-900">{listing.title}</h2>
            {listing.employer && <p className="mt-0.5 text-sm text-ink-600">{listing.employer}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
            {listing.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {listing.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Posted {formatAgo(listing.postedAt)}
            </span>
            <span className="text-ink-400">via {listing.sourceId}</span>
          </div>

          {(listing.hoursRequired || listing.ratingsRequired?.length) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {listing.hoursRequired && (
                <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {listing.hoursRequired.toLocaleString()} hour min
                </span>
              )}
              {listing.ratingsRequired?.map((r) => (
                <span key={r} className="rounded bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600">
                  {r}
                </span>
              ))}
            </div>
          )}

          {listing.description && (
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
              {listing.description}
            </div>
          )}
        </div>

        <div className="border-t border-ink-100 bg-ink-50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
            {STATUS_ORDER.map((s) => (
              <StatusButton
                key={s}
                status={s}
                active={status === s}
                onClick={() => onSetStatus(status === s ? null : s)}
                size="md"
              />
            ))}
            {status && (
              <span className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_TONES[status]}`}>
                {STATUS_LABELS[status]}
              </span>
            )}
          </div>
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-600"
          >
            View original posting
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="h-4 w-2/3 animate-pulse rounded bg-ink-100" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-ink-100" />
          <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-ink-100" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center">
      <Plane className="mx-auto h-8 w-8 text-ink-400" />
      <h3 className="mt-3 font-semibold text-ink-900">No listings match these filters</h3>
      <p className="mt-1 text-sm text-ink-400">Try widening the date range or clearing a filter.</p>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="font-semibold">Couldn't load listings</div>
      <div className="mt-1 text-xs text-red-700">{message}</div>
      <button
        onClick={onRetry}
        className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} hr ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(ts).toLocaleDateString();
}
