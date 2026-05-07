# Flightpath

Fresh CFI and low-time pilot job listings, aggregated from sources that don't suck.

Built for the 200–1500 hour CFI cohort that the major aggregators have abandoned. Defaults to listings from the **last 30 days**.

## Quick start

```bash
bun install          # install deps
bun run db:migrate   # create the SQLite database
bun run scrape       # pull fresh listings from all adapters
bun run dev          # start API (:3001) and web (:5173) together
```

Open http://localhost:5173.

## Architecture

```
src/
  server/      Hono API on Bun (port 3001)
  web/         Vite + React + Tailwind UI (port 5173)
  scrapers/    Per-source adapters → normalized Listing
  db/          Drizzle ORM + bun:sqlite
  shared/      Types shared between server, scrapers, and web
```

### Adding a new source

Create `src/scrapers/adapters/<name>.ts` exporting a `SourceAdapter`:

```ts
import type { SourceAdapter } from "../types.ts";

export const myAdapter: SourceAdapter = {
  id: "my-source",
  name: "My Source",
  async fetch() {
    // return RawListing[]
  },
};
```

Register it in `src/scrapers/registry.ts`. The shared dedup/normalization layer handles the rest.

## Status

v0.1 — JSfirm RSS only. Roadmap in `research/00-synthesis.md`.

## Research

- [Synthesis](research/00-synthesis.md)
- [Pilot pain points](research/01-pain-points.md)
- [Data sources](research/02-data-sources.md)
- [Competitive scan](research/03-competitive-scan.md)
