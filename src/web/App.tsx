import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plane, MapPin, Clock, Search, Filter, ExternalLink, X } from "lucide-react";
import { fetchListings, fetchSources, fetchSummary } from "./api.ts";
import type { JobCategory, Listing, ListingFilter } from "../shared/types.ts";

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

export function App() {
  const [filter, setFilter] = useState<ListingFilter>({
    postedSinceDays: 30,
    limit: 50,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [active, setActive] = useState<Listing | null>(null);

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

  return (
    <div className="min-h-dvh">
      <Header
        lastUpdate={lastUpdate}
        fresh30d={summaryQ.data?.fresh30d ?? null}
        onToggleFilters={() => setShowFilters((s) => !s)}
        showFilters={showFilters}
      />

      <main className="mx-auto max-w-3xl px-4 pb-24">
        <SearchBar value={filter.q ?? ""} onChange={(v) => update("q", v || undefined)} />

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
                    <ListingCard key={l.id} listing={l} onOpen={() => setActive(l)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </main>

      {active && <ListingDetail listing={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function Header({
  lastUpdate,
  fresh30d,
  onToggleFilters,
  showFilters,
}: {
  lastUpdate: number | null | undefined;
  fresh30d: number | null;
  onToggleFilters: () => void;
  showFilters: boolean;
}) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-ink-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-sky-500 p-1.5 text-white">
            <Plane className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-ink-900">Flightpath</div>
            <div className="text-xs text-ink-400">
              {fresh30d !== null ? `${fresh30d} fresh in last 30 days` : "Fresh pilot jobs"}
              {lastUpdate ? ` · ${formatAgo(lastUpdate)}` : ""}
            </div>
          </div>
        </div>
        <button
          onClick={onToggleFilters}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            showFilters
              ? "border-sky-500 bg-sky-500 text-white"
              : "border-ink-200 bg-white text-ink-800 hover:border-ink-400"
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
      </div>
    </header>
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

function ListingCard({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
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
          {listing.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {listing.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatAgo(listing.postedAt)}
          </span>
          {listing.hoursRequired && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
              {listing.hoursRequired.toLocaleString()} hr min
            </span>
          )}
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
      </button>
    </li>
  );
}

function ListingDetail({ listing, onClose }: { listing: Listing; onClose: () => void }) {
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
