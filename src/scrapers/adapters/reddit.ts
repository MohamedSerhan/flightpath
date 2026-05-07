import type { RawListing, SourceAdapter } from "../types.ts";

const FEEDS = [
  // r/flying [Hiring] tag — the convention pilots use to flag job offers in the sub
  "https://www.reddit.com/r/flying/search.json?q=flair%3AHiring&restrict_sr=on&sort=new&t=month&limit=100",
  "https://www.reddit.com/r/flying/search.json?q=%5BHiring%5D+CFI&restrict_sr=on&sort=new&t=month&limit=50",
  "https://www.reddit.com/r/flying/search.json?q=%5BHiring%5D+flight+instructor&restrict_sr=on&sort=new&t=month&limit=50",
  // r/aviation — broader sub, smaller signal but worth pulling
  "https://www.reddit.com/r/aviation/search.json?q=%5BHiring%5D+pilot&restrict_sr=on&sort=new&t=month&limit=25",
];

const UA =
  "Flightpath/0.1 (https://github.com/flightpath; pilot-job aggregator; contact via repo)";

const PILOT_TITLE_RE =
  /\b(cfi|cfii|mei|flight\s+instructor|certified\s+flight\s+instructor|instructor|pilot|first\s+officer|captain|sic\b|pic\b|line\s+check)\b/i;

const SPAM_RE =
  /\b(resume\s+review|how\s+to|advice|question|looking\s+for\s+work|seeking\s+job|i\s+(am|need)|wtb|trade)\b/i;

type RedditListing = {
  data: {
    children: Array<{
      data: {
        id: string;
        name: string;
        title: string;
        permalink: string;
        url?: string;
        selftext?: string;
        subreddit?: string;
        author?: string;
        link_flair_text?: string | null;
        created_utc?: number;
      };
    }>;
  };
};

async function fetchFeed(url: string): Promise<RawListing[]> {
  // Reddit 403s GitHub Actions IP ranges. We swap to the .json endpoint
  // (we already use it) and add a one-shot retry; if both fail we just
  // return [] and the source goes silent for this run. That's fine —
  // future runs from a different runner IP will succeed.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as RedditListing;
  const items = json?.data?.children ?? [];
  return items
    .map((c) => c.data)
    .filter(
      (p) =>
        p &&
        p.title &&
        p.permalink &&
        // Strict: [Hiring] tag in title text, OR flair text starts with "Hiring"
        // (excludes "Hire Me" flairs which are pilots LOOKING for jobs).
        (/\[hiring\]/i.test(p.title) ||
          /^hiring(\s|$|:)/i.test((p.link_flair_text ?? "").trim())),
    )
    .filter((p) => PILOT_TITLE_RE.test(p.title) || PILOT_TITLE_RE.test(p.selftext ?? ""))
    .filter((p) => !SPAM_RE.test(p.title))
    .map((p): RawListing => {
      const cleanTitle = p.title.replace(/^\s*\[?Hiring\]?\s*[:\-—]?\s*/i, "").trim() || p.title;
      const postedAt = p.created_utc ? p.created_utc * 1000 : Date.now();
      return {
        externalId: `reddit-${p.name}`,
        title: cleanTitle,
        url: `https://www.reddit.com${p.permalink}`,
        description: p.selftext?.trim() || null,
        employer: p.author ? `Reddit · u/${p.author}` : "Reddit",
        location: null,
        postedAt,
      };
    });
}

export const redditAdapter: SourceAdapter = {
  id: "reddit",
  name: "Reddit r/flying [Hiring]",
  async fetch(): Promise<RawListing[]> {
    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (const url of FEEDS) {
      try {
        const items = await fetchFeed(url);
        for (const it of items) {
          if (seen.has(it.externalId)) continue;
          seen.add(it.externalId);
          out.push(it);
        }
      } catch (err) {
        console.warn(`[reddit] feed failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  },
};
