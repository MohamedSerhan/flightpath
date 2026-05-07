import type { RawListing, SourceAdapter } from "../types.ts";
import { ATS_SOURCES } from "../ats/sources.ts";
import { fetchAtsSource } from "../ats/fetchers.ts";

export const atsAdapter: SourceAdapter = {
  id: "ats",
  name: "ATS aggregator (Greenhouse / Lever / Ashby / Workable / Breezy / Recruitee / SmartRecruiters)",
  async fetch(): Promise<RawListing[]> {
    const out: RawListing[] = [];
    const seen = new Set<string>();
    let ok = 0;
    let fail = 0;

    const limit = 6;
    let i = 0;

    async function worker() {
      while (i < ATS_SOURCES.length) {
        const idx = i++;
        const src = ATS_SOURCES[idx];
        try {
          const items = await fetchAtsSource(src);
          if (items.length > 0) {
            console.log(`[ats:${src.kind}:${src.slug}] +${items.length} pilot/CFI roles`);
            ok++;
          }
          for (const it of items) {
            if (seen.has(it.externalId)) continue;
            seen.add(it.externalId);
            out.push(it);
          }
        } catch (err) {
          fail++;
          const msg = err instanceof Error ? err.message : String(err);
          if (msg !== "404") {
            console.warn(`[ats:${src.kind}:${src.slug}] failed: ${msg}`);
          }
        }
      }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()));
    console.log(`[ats] ok=${ok} fail=${fail} total_listings=${out.length}`);
    return out;
  },
};
