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
  Mail,
  Copy,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { applyTheme, readTheme, writeTheme, type Theme } from "./theme.ts";
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
import {
  buildOutreach,
  readApplicantProfile,
  writeApplicantProfile,
  type ApplicantProfile,
  type OutreachMode,
} from "./outreach.ts";
import { matchScore, type MatchResult, type MatchTier } from "./match.ts";

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

// Default landing filter. The first-time user is a CFI looking for CFI
// roles — tighter default than "everything in the last 30 days." If
// they've used the site before, we restore their saved filter instead.
const DEFAULT_FILTER: ListingFilter = {
  category: "cfi",
  postedSinceDays: 30,
  limit: 50,
};

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
        return { ...DEFAULT_FILTER, ...JSON.parse(saved) };
      } catch {
        /* fall through */
      }
    }
  }
  return { ...DEFAULT_FILTER };
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
type SortMode = "match" | "date";

const SORT_STORAGE_KEY = "flightpath:sortMode";

function readSortMode(): SortMode {
  if (typeof localStorage === "undefined") return "match";
  const v = localStorage.getItem(SORT_STORAGE_KEY);
  return v === "date" || v === "match" ? v : "match";
}

export function App() {
  const [filter, setFilter] = useState<ListingFilter>(() => readFilterFromUrl());
  const [showFilters, setShowFilters] = useState(false);
  const [active, setActive] = useState<Listing | null>(null);
  const [view, setView] = useState<View>("browse");
  const [pipeline, setPipelineMap] = useState<PipelineMap>(() => readPipeline());
  const [outreachFor, setOutreachFor] = useState<{ listing: Listing; mode: OutreachMode } | null>(null);
  const [profile, setProfile] = useState<ApplicantProfile>(() => readApplicantProfile());
  const [showProfile, setShowProfile] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [sortMode, setSortMode] = useState<SortMode>(() => readSortMode());
  const [compareKeys, setCompareKeys] = useState<Set<string>>(() => new Set());
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    writeApplicantProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SORT_STORAGE_KEY, sortMode);
    }
  }, [sortMode]);

  useEffect(() => {
    applyTheme(theme);
    writeTheme(theme);
  }, [theme]);

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

  function toggleCompare(listing: Listing) {
    const key = entryKey(listing.sourceId, listing.externalId);
    setCompareKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < 4) next.add(key); // cap at 4 columns for layout
      return next;
    });
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
        onOpenProfile={() => setShowProfile(true)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />

      {view === "pipeline" && (
        <PipelineView
          pipeline={pipeline}
          listings={listingsQ.data?.items ?? []}
          onOpen={setActive}
          onSetStatus={setListingStatus}
          onClearAll={() => setPipelineMap({})}
          onDraftFollowUp={(listing) => setOutreachFor({ listing, mode: "follow-up" })}
        />
      )}

      {view === "browse" && (
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <HoursToAtpBanner profile={profile} onEditProfile={() => setShowProfile(true)} />
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
                      : "border-ink-200 bg-white text-ink-600 hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:border-ink-500"
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
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-600 hover:bg-sky-500/20 dark:bg-sky-500/20 dark:text-sky-300"
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
          {listingsQ.data && (() => {
            const scored = listingsQ.data.items.map((l) => ({
              listing: l,
              match: matchScore(l, profile),
            }));
            const sorted = [...scored].sort((a, b) =>
              sortMode === "match"
                ? b.match.score - a.match.score || b.listing.postedAt - a.listing.postedAt
                : b.listing.postedAt - a.listing.postedAt,
            );
            return (
              <>
                <div className="mb-3 flex items-center justify-between text-sm text-ink-400">
                  <span>
                    {listingsQ.data.total} {listingsQ.data.total === 1 ? "listing" : "listings"}
                  </span>
                  <div className="flex items-center gap-2">
                    {listingsQ.isFetching && <span className="text-xs">refreshing…</span>}
                    <SortToggle mode={sortMode} onChange={setSortMode} />
                  </div>
                </div>
                {sorted.length === 0 ? (
                  <EmptyState />
                ) : (
                  <ul className="space-y-3">
                    {sorted.map(({ listing, match }) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        match={match}
                        status={statusOf(listing)}
                        compareSelected={compareKeys.has(entryKey(listing.sourceId, listing.externalId))}
                        onToggleCompare={() => toggleCompare(listing)}
                        onOpen={() => setActive(listing)}
                        onSetStatus={(s) => setListingStatus(listing, s)}
                      />
                    ))}
                  </ul>
                )}
              </>
            );
          })()}
        </div>
      </main>
      )}

      <footer className="safe-bottom mx-auto mt-12 max-w-3xl px-4 pb-6 text-center text-xs text-ink-400">
        Get notified of new CFI roles via RSS:{" "}
        <a
          href={`${import.meta.env.BASE_URL ?? "/"}feed-cfi.xml`}
          className="font-medium text-sky-600 hover:underline dark:text-sky-300"
          target="_blank"
          rel="noopener noreferrer"
        >
          CFI / CFII / MEI feed
        </a>
        {" · "}
        <a
          href={`${import.meta.env.BASE_URL ?? "/"}feed.xml`}
          className="font-medium text-sky-600 hover:underline dark:text-sky-300"
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
          onDraftOutreach={() => setOutreachFor({ listing: active, mode: "initial" })}
        />
      )}

      {outreachFor && (
        <OutreachModal
          listing={outreachFor.listing}
          mode={outreachFor.mode}
          profile={profile}
          onClose={() => setOutreachFor(null)}
          onEditProfile={() => {
            setOutreachFor(null);
            setShowProfile(true);
          }}
        />
      )}

      {showProfile && (
        <ProfileModal
          profile={profile}
          onSave={(p) => {
            setProfile(p);
            setShowProfile(false);
          }}
          onClose={() => setShowProfile(false)}
        />
      )}

      {compareKeys.size > 0 && view === "browse" && (
        <CompareBar
          count={compareKeys.size}
          onCompare={() => setShowCompare(true)}
          onClear={() => setCompareKeys(new Set())}
        />
      )}

      {showCompare && (
        <CompareModal
          keys={compareKeys}
          listings={listingsQ.data?.items ?? []}
          profile={profile}
          onClose={() => setShowCompare(false)}
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
  onOpenProfile,
  theme,
  onToggleTheme,
}: {
  lastUpdate: number | null | undefined;
  fresh30d: number | null;
  onToggleFilters: () => void;
  showFilters: boolean;
  view: View;
  onSetView: (v: View) => void;
  pipelineCount: number;
  onOpenProfile: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-ink-100 bg-white/80 backdrop-blur dark:bg-ink-800 dark:bg-ink-900/80 dark:border-ink-800">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={() => onSetView("browse")}
          className="flex items-center gap-2 text-left"
        >
          <div className="rounded-lg bg-sky-500 p-1.5 text-white">
            <Plane className="h-5 w-5" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold text-ink-900 dark:text-ink-50">Flightpath</div>
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
                : "border-ink-200 bg-white text-ink-800 hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:border-ink-500"
            }`}
          >
            <Briefcase className="h-4 w-4" />
            <span className="hidden sm:inline">Logbook</span>
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
                  : "border-ink-200 bg-white text-ink-800 hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:border-ink-500"
              }`}
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>
          )}
          <button
            onClick={onToggleTheme}
            className="inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white p-1.5 text-ink-800 hover:border-ink-400 dark:border-ink-800 dark:bg-ink-800 dark:text-ink-100 dark:hover:border-ink-600"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={onOpenProfile}
            className="inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white p-1.5 text-ink-800 hover:border-ink-400 dark:border-ink-800 dark:bg-ink-800 dark:text-ink-100 dark:hover:border-ink-600"
            title="Your applicant profile"
          >
            <Settings className="h-4 w-4" />
          </button>
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
        active
          ? tone
          : "bg-white text-ink-400 ring-ink-100 hover:text-ink-800 dark:bg-ink-800 dark:ring-ink-700 dark:hover:text-ink-100"
      }`}
    >
      <Icon className={dim} />
    </button>
  );
}

/** "Applied N days ago, no movement" → time to nudge them. 7 calendar
 *  days is the standard pilot-recruiter SLA in industry — earlier feels
 *  pushy, later they've forgotten you. */
const FOLLOW_UP_AFTER_DAYS = 7;

function PipelineView({
  pipeline,
  listings,
  onOpen,
  onSetStatus,
  onClearAll,
  onDraftFollowUp,
}: {
  pipeline: PipelineMap;
  listings: Listing[];
  onOpen: (l: Listing) => void;
  onSetStatus: (l: Listing, s: PipelineStatus | null) => void;
  onClearAll: () => void;
  onDraftFollowUp: (l: Listing) => void;
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
    a.download = `flightpath-logbook-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const total = Object.keys(pipeline).length;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24">
      <div className="my-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-600 dark:text-ink-200">
          {total === 0
            ? "No applications tracked yet — tap the icons on a listing to save / mark applied."
            : `${total} ${total === 1 ? "entry" : "entries"} in your logbook`}
        </div>
        {total > 0 && (
          <div className="flex gap-2">
            <button
              onClick={downloadCsv}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 hover:border-ink-400 dark:bg-ink-800 dark:border-ink-800 dark:text-ink-100 dark:hover:border-ink-600"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={() => {
                if (confirm("Clear all logbook entries? This cannot be undone.")) onClearAll();
              }}
              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:border-rose-400 dark:bg-ink-800 dark:text-rose-200 dark:border-rose-800 dark:hover:border-rose-600"
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
              {items.map(({ key, listing, entry }) => {
                const daysSince = Math.floor((Date.now() - entry.updatedAt) / 86400_000);
                const dueForFollowUp =
                  status === "applied" && listing && daysSince >= FOLLOW_UP_AFTER_DAYS;
                return (
                  <li key={key} className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm dark:bg-ink-800 dark:border-ink-800">
                    {listing ? (
                      <div className="flex items-start justify-between gap-3">
                        <button onClick={() => onOpen(listing)} className="min-w-0 flex-1 text-left">
                          <div className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
                            {listing.title}
                          </div>
                          <div className="truncate text-xs text-ink-400">
                            {listing.employer}
                            {listing.location ? ` · ${listing.location}` : ""}
                          </div>
                          {dueForFollowUp && (
                            <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-200">
                              Applied {daysSince} days ago — time to follow up?
                            </div>
                          )}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {dueForFollowUp && (
                            <button
                              onClick={() => onDraftFollowUp(listing)}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
                              title="Draft a follow-up email"
                            >
                              <Mail className="h-3 w-3" />
                              Follow up
                            </button>
                          )}
                          <button
                            onClick={() => onSetStatus(listing, null)}
                            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:bg-ink-700 dark:text-ink-50 dark:hover:bg-ink-700 dark:hover:text-ink-100"
                            title="Remove from logbook"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs italic text-ink-400">
                        Listing dropped out of the 30-day window — apply state retained ({key}).
                      </div>
                    )}
                  </li>
                );
              })}
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
          className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-10 pr-4 text-sm text-ink-900 placeholder:text-ink-400 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-50 dark:placeholder:text-ink-500"
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
    <div className="mt-4 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm dark:bg-ink-800 dark:border-ink-800">
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
                      : "border-ink-200 bg-white text-ink-600 hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:border-ink-500"
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
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
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
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
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
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
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
          className="text-xs font-medium text-ink-400 hover:text-ink-800 dark:text-ink-100"
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

/** Tiny progress banner on the browse view: how close the user is to
 *  the FAA ATP minimum of 1,500 hours, and (if they've set a monthly
 *  pace) when they'll get there at the current rate. Quiet and
 *  motivational — nothing if they haven't set total time, since we
 *  don't want to assume. */
function HoursToAtpBanner({
  profile,
  onEditProfile,
}: {
  profile: ApplicantProfile;
  onEditProfile: () => void;
}) {
  const ATP = 1500;
  const tt = profile.totalTime;
  if (typeof tt !== "number" || tt < 0) {
    return (
      <button
        onClick={onEditProfile}
        className="mt-4 block w-full rounded-2xl border border-dashed border-ink-200 bg-white px-4 py-3 text-left text-xs text-ink-400 hover:border-ink-400 dark:border-ink-800 dark:bg-ink-800 dark:text-ink-200"
      >
        Set your total time in your profile to see how close you are to the 1,500-hour ATP minimum.
      </button>
    );
  }
  const remaining = Math.max(0, ATP - tt);
  const pct = Math.min(100, Math.round((tt / ATP) * 100));
  const reached = tt >= ATP;
  const monthly = profile.monthlyHours ?? 0;
  const months = !reached && monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const eta =
    months !== null
      ? new Date(Date.now() + months * 30 * 86400_000).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <button
      onClick={onEditProfile}
      title="Click to edit your profile"
      className="mt-4 block w-full rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-sm hover:border-sky-500 dark:bg-ink-800 dark:border-ink-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-ink-900 dark:text-ink-50">
          {reached ? (
            <>You've hit the 1,500-hour ATP minimum 🎉</>
          ) : (
            <>
              {tt.toLocaleString()} <span className="text-ink-400">/</span>{" "}
              {ATP.toLocaleString()} hrs
              <span className="ml-2 text-xs font-normal text-ink-400">
                ({remaining.toLocaleString()} to ATP)
              </span>
            </>
          )}
        </div>
        <div className="text-xs font-medium tabular-nums text-ink-400">{pct}%</div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-700">
        <div
          className={`h-full rounded-full transition-all ${
            reached ? "bg-emerald-500" : pct >= 75 ? "bg-sky-500" : pct >= 40 ? "bg-amber-400" : "bg-rose-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!reached && (
        <div className="mt-2 text-xs text-ink-400">
          {eta ? (
            <>
              At {monthly} hrs/mo you'll reach ATP in {months} months ({eta})
            </>
          ) : (
            <>Add monthly hours in profile to see a projected ATP date</>
          )}
        </div>
      )}
    </button>
  );
}

function SortToggle({
  mode,
  onChange,
}: {
  mode: SortMode;
  onChange: (m: SortMode) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-ink-200 dark:border-ink-800">
      {(["match", "date"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2 py-0.5 text-[11px] font-medium transition ${
            mode === m
              ? "bg-sky-500 text-white"
              : "bg-white text-ink-600 hover:bg-ink-50 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
          }`}
          title={m === "match" ? "Sort by match score" : "Sort by post date"}
        >
          {m === "match" ? "Match" : "Newest"}
        </button>
      ))}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  jsfirm: "JSfirm",
  ats: "ATS",
  workday: "Workday",
  "atp-cfi": "ATP",
  skywest: "SkyWest",
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

const MATCH_TONES: Record<MatchTier, { ring: string; text: string; bg: string }> = {
  high: { ring: "ring-emerald-400/60", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
  mid: { ring: "ring-amber-400/60", text: "text-amber-700 dark:text-amber-200", bg: "bg-amber-50 dark:bg-amber-900/30" },
  low: { ring: "ring-rose-300/60", text: "text-rose-600 dark:text-rose-300", bg: "bg-rose-50 dark:bg-rose-900/30" },
};

function MatchBadge({ match }: { match: MatchResult }) {
  const tone = MATCH_TONES[match.tier];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${tone.bg} ${tone.text} ${tone.ring}`}
      title={`Match score ${match.score}/100 — ${match.reason}`}
    >
      <span className="tabular-nums">{match.score}</span>
      <span className="opacity-70">match</span>
    </span>
  );
}

function ListingCard({
  listing,
  match,
  status,
  compareSelected,
  onOpen,
  onSetStatus,
  onToggleCompare,
}: {
  listing: Listing;
  match: MatchResult;
  status: PipelineStatus | null;
  compareSelected: boolean;
  onOpen: () => void;
  onSetStatus: (s: PipelineStatus | null) => void;
  onToggleCompare: () => void;
}) {
  const sourceLabel = SOURCE_LABELS[listing.sourceId] ?? listing.sourceId;
  const tail = !listing.location ? urlTail(listing.url) : "";
  return (
    <li>
      <button
        onClick={onOpen}
        className="block w-full rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-sm transition hover:border-sky-500 hover:shadow-md dark:bg-ink-800 dark:border-ink-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">{listing.title}</h3>
            {listing.employer && (
              <div className="mt-0.5 truncate text-sm text-ink-600 dark:text-ink-200">{listing.employer}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <MatchBadge match={match} />
            {listing.jobCategory && (
              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 dark:bg-ink-700 dark:text-ink-200">
                {CATEGORY_LABELS[listing.jobCategory] ?? listing.jobCategory}
              </span>
            )}
          </div>
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
            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
              {listing.hoursRequired.toLocaleString()} hr min
            </span>
          )}
          <span
            className="ml-auto rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-400 ring-1 ring-ink-100 dark:bg-ink-900 dark:ring-ink-700"
            title={`Source: ${sourceLabel}`}
          >
            {sourceLabel}
          </span>
        </div>

        {listing.ratingsRequired && listing.ratingsRequired.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {listing.ratingsRequired.slice(0, 5).map((r) => (
              <span key={r} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:bg-sky-500/20 dark:text-sky-300">
                {r}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-3 flex items-center gap-1.5 border-t border-ink-100 pt-2 dark:border-ink-800"
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCompare();
            }}
            title={compareSelected ? "Remove from compare" : "Add to compare"}
            className={`ml-auto inline-flex items-center justify-center rounded-md p-1.5 text-[10px] font-bold ring-1 transition ${
              compareSelected
                ? "bg-sky-500 text-white ring-sky-500"
                : "bg-white text-ink-400 ring-ink-100 hover:text-ink-800 dark:bg-ink-800 dark:ring-ink-700 dark:hover:text-ink-100"
            }`}
          >
            ⇄
          </button>
          {status && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_TONES[status]}`}>
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
  onDraftOutreach,
}: {
  listing: Listing;
  status: PipelineStatus | null;
  onClose: () => void;
  onSetStatus: (s: PipelineStatus | null) => void;
  onDraftOutreach: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl dark:bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-ink-100 p-4 dark:border-ink-800">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{listing.title}</h2>
            {listing.employer && <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-200">{listing.employer}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:bg-ink-700 dark:text-ink-50 dark:hover:bg-ink-700 dark:hover:text-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600 dark:text-ink-200">
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
                <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                  {listing.hoursRequired.toLocaleString()} hour min
                </span>
              )}
              {listing.ratingsRequired?.map((r) => (
                <span key={r} className="rounded bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600 dark:bg-sky-500/20 dark:text-sky-300">
                  {r}
                </span>
              ))}
            </div>
          )}

          {listing.description && (
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-800 dark:text-ink-100">
              {listing.description}
            </div>
          )}
        </div>

        <div className="border-t border-ink-100 bg-ink-50 p-4 dark:bg-ink-900 dark:border-ink-800">
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
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              onClick={onDraftOutreach}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-500 bg-white px-4 py-3 text-sm font-semibold text-sky-600 hover:bg-sky-50 dark:bg-ink-800 dark:text-sky-300"
            >
              <Mail className="h-4 w-4" />
              Draft outreach
            </button>
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-600"
            >
              View original posting
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutreachModal({
  listing,
  mode,
  profile,
  onClose,
  onEditProfile,
}: {
  listing: Listing;
  mode: OutreachMode;
  profile: ApplicantProfile;
  onClose: () => void;
  onEditProfile: () => void;
}) {
  const initial = useMemo(() => buildOutreach(listing, profile, mode), [listing, profile, mode]);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [copied, setCopied] = useState<"none" | "subject" | "body">("none");

  const profileEmpty = !profile.name && !profile.email && !profile.totalTime;

  function copy(text: string, which: "subject" | "body") {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(which);
        setTimeout(() => setCopied("none"), 1500);
      },
      () => {
        /* clipboard blocked — let the user copy manually */
      },
    );
  }

  function mailto() {
    const params = new URLSearchParams();
    params.set("subject", subject);
    params.set("body", body);
    return `mailto:?${params.toString()}`;
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="safe-bottom flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl dark:bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-ink-100 p-4 dark:border-ink-800">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
              {mode === "follow-up" ? "Draft follow-up" : "Draft outreach"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-ink-400">
              {listing.title} · {listing.employer ?? "—"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:bg-ink-700 dark:text-ink-50 dark:hover:bg-ink-700 dark:hover:text-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {profileEmpty && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
            Tip: fill in your{" "}
            <button onClick={onEditProfile} className="font-semibold underline hover:no-underline">
              applicant profile
            </button>{" "}
            so the draft includes your name, ratings, and total time automatically.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            Subject
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50 dark:placeholder:text-ink-500"
            />
            <button
              onClick={() => copy(subject, "subject")}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:border-ink-400 dark:bg-ink-800 dark:border-ink-800 dark:hover:border-ink-600 dark:text-ink-200"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied === "subject" ? "Copied" : "Copy"}
            </button>
          </div>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-ink-400">
            Body
          </label>
          <div className="mt-1">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              className="w-full rounded-lg border border-ink-200 bg-white p-3 font-sans text-sm leading-relaxed text-ink-900 placeholder:text-ink-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50 dark:placeholder:text-ink-500"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => copy(body, "body")}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-ink-400 dark:bg-ink-800 dark:border-ink-800 dark:hover:border-ink-600 dark:text-ink-200"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "body" ? "Copied" : "Copy body"}
              </button>
              <button
                onClick={() => {
                  copy(`${subject}\n\n${body}`, "body");
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-ink-400 dark:bg-ink-800 dark:border-ink-800 dark:hover:border-ink-600 dark:text-ink-200"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy subject + body
              </button>
              <a
                href={mailto()}
                className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600"
              >
                <Mail className="h-3.5 w-3.5" />
                Open in mail app
              </a>
            </div>
          </div>

          <p className="mt-4 text-xs text-ink-400">
            This is a starting point — please edit before sending. Use first names where
            you know them, swap in specifics from the original posting, and proofread for
            tone. Templates can't replace the human touch hiring managers actually look for.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProfileModal({
  profile,
  onSave,
  onClose,
}: {
  profile: ApplicantProfile;
  onSave: (p: ApplicantProfile) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ApplicantProfile>(profile);

  function update<K extends keyof ApplicantProfile>(key: K, value: ApplicantProfile[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="safe-bottom flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl dark:bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-ink-100 p-4 dark:border-ink-800">
          <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">Applicant profile</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:bg-ink-700 dark:text-ink-50 dark:hover:bg-ink-700 dark:hover:text-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4 text-sm">
          <p className="text-xs text-ink-400">
            Stays in your browser. Used to pre-fill the outreach draft templates so you
            don't have to retype your basics every time.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={draft.name ?? ""}
                onChange={(e) => update("name", e.target.value)}
                className={fieldClass}
                placeholder="e.g. Alex Smith"
              />
            </Field>
            <Field label="Email">
              <input
                value={draft.email ?? ""}
                onChange={(e) => update("email", e.target.value)}
                type="email"
                className={fieldClass}
                placeholder="alex@example.com"
              />
            </Field>
            <Field label="Phone">
              <input
                value={draft.phone ?? ""}
                onChange={(e) => update("phone", e.target.value)}
                className={fieldClass}
                placeholder="+1 …"
              />
            </Field>
            <Field label="Base location">
              <input
                value={draft.baseLocation ?? ""}
                onChange={(e) => update("baseLocation", e.target.value)}
                className={fieldClass}
                placeholder="Cleveland, OH"
              />
            </Field>
            <Field label="Total time (hours)">
              <input
                value={draft.totalTime?.toString() ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update("totalTime", v ? Number(v) : undefined);
                }}
                type="number"
                inputMode="numeric"
                className={fieldClass}
                placeholder="e.g. 320"
              />
            </Field>
            <Field label="Monthly hours pace">
              <input
                value={draft.monthlyHours?.toString() ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update("monthlyHours", v ? Number(v) : undefined);
                }}
                type="number"
                inputMode="numeric"
                className={fieldClass}
                placeholder="e.g. 40"
              />
            </Field>
            <Field label="Willing to relocate">
              <select
                value={draft.willingToRelocate ? "yes" : "no"}
                onChange={(e) => update("willingToRelocate", e.target.value === "yes")}
                className={fieldClass}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
          </div>

          <div className="rounded-lg border border-ink-100 bg-ink-50 p-3 dark:bg-ink-900 dark:border-ink-800">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Ratings (CFI is assumed)
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <CheckboxField
                label="Instrument"
                checked={!!draft.hasInstrument}
                onChange={(v) => update("hasInstrument", v)}
              />
              <CheckboxField
                label="Multi-Engine"
                checked={!!draft.hasMultiEngine}
                onChange={(v) => update("hasMultiEngine", v)}
              />
              <CheckboxField
                label="CFII"
                checked={!!draft.hasCfii}
                onChange={(v) => update("hasCfii", v)}
              />
              <CheckboxField
                label="MEI"
                checked={!!draft.hasMei}
                onChange={(v) => update("hasMei", v)}
              />
            </div>
          </div>

          <Field label="Notes (private — not used in templates)">
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              rows={3}
              className={fieldClass}
              placeholder="anything you want to remember when applying"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50 p-4 dark:bg-ink-900 dark:border-ink-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-800 hover:border-ink-400 dark:bg-ink-800 dark:border-ink-800 dark:text-ink-100 dark:hover:border-ink-600"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50 dark:placeholder:text-ink-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</span>
      {children}
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-ink-300 text-sky-500 focus:ring-sky-500"
      />
      <span>{label}</span>
    </label>
  );
}

function CompareBar({
  count,
  onCompare,
  onClear,
}: {
  count: number;
  onCompare: () => void;
  onClear: () => void;
}) {
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 bg-white/95 px-4 py-3 shadow-[0_-1px_8px_rgba(0,0,0,0.12)] backdrop-blur dark:bg-ink-900/95">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="text-sm text-ink-700 dark:text-ink-100">
          <span className="font-semibold">{count}</span> selected for compare
          {count >= 4 && <span className="ml-2 text-xs text-ink-400">(max)</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClear}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-ink-400 dark:bg-ink-800 dark:border-ink-800 dark:text-ink-200"
          >
            Clear
          </button>
          <button
            onClick={onCompare}
            disabled={count < 2}
            className="rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 dark:disabled:bg-ink-700 dark:disabled:text-ink-400"
          >
            Compare {count}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompareModal({
  keys,
  listings,
  profile,
  onClose,
}: {
  keys: Set<string>;
  listings: Listing[];
  profile: ApplicantProfile;
  onClose: () => void;
}) {
  const selected = listings.filter((l) => keys.has(entryKey(l.sourceId, l.externalId)));
  const rows: Array<{ label: string; render: (l: Listing) => React.ReactNode }> = [
    { label: "Match", render: (l) => `${matchScore(l, profile).score}/100` },
    { label: "Employer", render: (l) => l.employer ?? "—" },
    { label: "Location", render: (l) => l.location ?? "—" },
    { label: "Posted", render: (l) => formatAgo(l.postedAt) },
    {
      label: "Min hours",
      render: (l) => (l.hoursRequired ? `${l.hoursRequired.toLocaleString()}` : "—"),
    },
    {
      label: "Ratings",
      render: (l) => (l.ratingsRequired?.length ? l.ratingsRequired.join(", ") : "—"),
    },
    {
      label: "Category",
      render: (l) =>
        l.jobCategory ? (CATEGORY_LABELS[l.jobCategory] ?? l.jobCategory) : "—",
    },
    {
      label: "Source",
      render: (l) => SOURCE_LABELS[l.sourceId] ?? l.sourceId,
    },
    {
      label: "Apply",
      render: (l) => (
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-600 underline hover:no-underline dark:text-sky-300"
        >
          Open posting →
        </a>
      ),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="safe-bottom flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl dark:bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-ink-100 p-4 dark:border-ink-800">
          <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
            Compare {selected.length} listings
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-400 dark:bg-ink-800">
                  Field
                </th>
                {selected.map((l) => (
                  <th
                    key={l.id}
                    className="px-3 py-2 text-left align-top font-semibold text-ink-900 dark:text-ink-50"
                  >
                    <div className="truncate" title={l.title}>
                      {l.title}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-ink-100 dark:border-ink-700">
                  <td className="sticky left-0 z-10 bg-white px-2 py-2 align-top text-xs font-medium text-ink-400 dark:bg-ink-800">
                    {r.label}
                  </td>
                  {selected.map((l) => (
                    <td
                      key={l.id}
                      className="px-3 py-2 align-top text-ink-800 dark:text-ink-100"
                    >
                      {r.render(l)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm dark:bg-ink-800 dark:border-ink-800">
          <div className="h-4 w-2/3 animate-pulse rounded bg-ink-100 dark:bg-ink-700" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-ink-100 dark:bg-ink-700" />
          <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-ink-100 dark:bg-ink-700" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center dark:bg-ink-800 dark:border-ink-800">
      <Plane className="mx-auto h-8 w-8 text-ink-400" />
      <h3 className="mt-3 font-semibold text-ink-900 dark:text-ink-50">No listings match these filters</h3>
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
