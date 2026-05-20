/**
 * One-time bootstrap: scrape the Google My Maps KML behind
 * lowtimepilot.com/company-map to produce data/lowtimepilot-companies.json —
 * a seed list of aviation employers (aerial survey, skydiving, banner tow,
 * pipeline patrol, etc.) with their websites and operation categories.
 *
 * Discovery (commit 90f3685's --probe mode) found that lowtimepilot embeds
 * a Google My Maps; the map's full dataset is fetchable as KML XML directly
 * from Google with no auth. We drop Playwright entirely and parse XML.
 *
 * Used by src/scrapers/adapters/lowtimepilot.ts to probe each company's
 * careers page for active hiring signals.
 *
 * Run manually when refreshing the seed:
 *   bun src/scrapers/bootstrap-lowtimepilot.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { JobCategory } from "../shared/types.ts";

const KML_URL =
  "https://www.google.com/maps/d/kml?mid=1ij8TXrDVNEHg25itX_CnXoV-YdGev-s&forcekml=1";
const OUTPUT = "data/lowtimepilot-companies.json";

/** `"time_building"` is a seed-only category — it's NOT in the public
 *  JobCategory union because time-building programs are pay-to-play, not
 *  job postings, and we don't want them showing up in the listings UI.
 *  The adapter filters these out before probing. Keeping the label in
 *  the seed lets us preserve the data without polluting the listings DB. */
export type LowtimepilotCompany = {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
  category: JobCategory | "time_building";
};

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI","GU",
]);

const STATE_NAMES_TO_ABBR: Record<string, string> = {
  alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA",
  colorado:"CO", connecticut:"CT", delaware:"DE", florida:"FL", georgia:"GA",
  hawaii:"HI", idaho:"ID", illinois:"IL", indiana:"IN", iowa:"IA",
  kansas:"KS", kentucky:"KY", louisiana:"LA", maine:"ME", maryland:"MD",
  massachusetts:"MA", michigan:"MI", minnesota:"MN", mississippi:"MS", missouri:"MO",
  montana:"MT", nebraska:"NE", nevada:"NV", "new hampshire":"NH", "new jersey":"NJ",
  "new mexico":"NM", "new york":"NY", "north carolina":"NC", "north dakota":"ND", ohio:"OH",
  oklahoma:"OK", oregon:"OR", pennsylvania:"PA", "rhode island":"RI", "south carolina":"SC",
  "south dakota":"SD", tennessee:"TN", texas:"TX", utah:"UT", vermont:"VT",
  virginia:"VA", washington:"WA", "west virginia":"WV", wisconsin:"WI", wyoming:"WY",
  "district of columbia":"DC",
};

const CATEGORY_MAP: Record<string, JobCategory | "time_building"> = {
  // Real labels from KML — folder names and Type values
  "part 141 flight schools": "cfi",
  "141 school": "cfi",
  "skydiving": "skydiving",
  "skydive": "skydiving",
  "jump pilot": "skydiving",
  "banner towing": "banner_tow",
  "banner tow": "banner_tow",
  "pipeline patrol": "pipeline_patrol",
  "powerline patrol": "pipeline_patrol",
  "aerial survey": "aerial_survey",
  "isr defense contractors": "part91",
  "isr": "part91",
  "air ambulance": "air_ambulance",
  "hems": "air_ambulance",
  "medevac": "air_ambulance",
  "fedex/ ups feeder": "part135",
  "fedex/ ups feeders": "part135",
  "flight sim centers": "other",
  "flight simulator center": "other",
  "air tour operators": "part91",
  "air tour operators - map data - apr 2026": "part91",
  "air tours": "part91",
  // Generic fallbacks that may appear if upstream relabels
  "charter": "part135",
  "part 135": "part135",
  "airline": "airline",
  "traffic watch": "traffic_watch",
  "eng": "traffic_watch",
  // Seed-only — adapter filters these out before probing. Pay-to-play
  // programs aren't real job postings; we keep the data but never
  // emit listings.
  "time building": "time_building",
  "time-building": "time_building",
};

function mapCategory(label: string): JobCategory | "time_building" {
  const k = label.toLowerCase().trim();
  if (CATEGORY_MAP[k]) return CATEGORY_MAP[k];
  console.log(`[lowtimepilot] unmapped category: "${label}" — defaulting to part91`);
  return "part91";
}

/** Pull a value from the placemark's ExtendedData by Data[name]. Returns
 *  the inner value, or "" if not present. */
function ed(placemark: any, fieldName: string): string {
  const data = placemark?.ExtendedData?.Data;
  if (!data) return "";
  const arr = Array.isArray(data) ? data : [data];
  for (const d of arr) {
    if (d?.["@_name"] === fieldName) {
      const v = d.value;
      return typeof v === "string" ? v : v == null ? "" : String(v);
    }
  }
  return "";
}

function normalizeState(value: string): string {
  const t = value.trim();
  if (!t) return "";
  // Already a 2-letter code?
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  // Full name?
  return STATE_NAMES_TO_ABBR[t.toLowerCase()] ?? "";
}

function stateFromAddress(address: string): string {
  // Match patterns like "..., Florida 33125, USA" or "..., FL 33125".
  const m = address.match(/,\s*([A-Za-z][A-Za-z\s]{1,18}?)\s+\d{5}/);
  if (m) {
    const norm = normalizeState(m[1]);
    if (norm) return norm;
  }
  const m2 = address.match(/,\s*([A-Z]{2})\b/);
  if (m2) return m2[1];
  return "";
}

function cleanCity(raw: string): string {
  // Strip trailing commas / whitespace.
  let city = raw.replace(/,\s*$/, "").trim();
  // Reject "City, ST" leakage from the splitter — the upstream
  // ExtendedData City field is the primary source, so returning ""
  // here just means the address-derived fallback didn't yield a
  // usable city for this record.
  if (/,\s*[A-Z]{2}$/.test(city)) return "";
  return city;
}

function cityFromAddress(address: string): string {
  // The address is typically "Street, City, State Zip, Country".
  // Split by commas and pick the city as the segment before the
  // "State Zip" segment.
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Za-z\s]+\s+\d{5}/.test(parts[i]) || /^[A-Z]{2}\s+\d{5}/.test(parts[i])) {
      if (i - 1 >= 0) return cleanCity(parts[i - 1]);
    }
  }
  // Fallback: second-to-last part.
  if (parts.length >= 2) return cleanCity(parts[parts.length - 2]);
  return "";
}

async function main() {
  console.log(`[lowtimepilot] fetching KML…`);
  const res = await fetch(KML_URL);
  if (!res.ok) {
    console.error(`[lowtimepilot] KML fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const xml = await res.text();
  console.log(`[lowtimepilot] received ${xml.length} bytes`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (tag) => tag === "Folder" || tag === "Placemark" || tag === "Data",
  });
  const doc = parser.parse(xml);

  // KML structure: kml > Document > Folder[] > Placemark[]
  const folders: any[] = doc?.kml?.Document?.Folder ?? [];
  if (folders.length === 0) {
    console.error("[lowtimepilot] no Folder elements parsed — KML structure may have changed");
    process.exit(1);
  }

  const results: LowtimepilotCompany[] = [];
  let totalPlacemarks = 0;
  let droppedNonUS = 0;
  let droppedNoName = 0;

  for (const folder of folders) {
    const folderName = folder?.name ?? "";
    const placemarks: any[] = folder?.Placemark ?? [];
    for (const p of placemarks) {
      totalPlacemarks++;
      const name = (p?.name ?? "").toString().trim();
      if (!name) { droppedNoName++; continue; }

      const address = (p?.address ?? "").toString().trim();
      const stateFromED = normalizeState(ed(p, "State"));
      const state = stateFromED || stateFromAddress(address);
      if (!US_STATES.has(state)) { droppedNonUS++; continue; }

      const cityFromED = cleanCity(ed(p, "City").trim());
      const city = cityFromED || cityFromAddress(address);

      const homepage = ed(p, "Homepage URL").trim();
      const careerPage = ed(p, "Career page").trim();
      let website: string | null = homepage || careerPage || null;
      if (website) {
        // Some KML entries put free-text notes after the URL
        // (e.g. "elpasoskydive.com/ – CLOSED"). Keep only the first
        // whitespace-delimited token.
        website = website.split(/\s/)[0] || "";
        if (!website) {
          website = null;
        } else {
          if (!/^https?:\/\//i.test(website)) {
            website = `https://${website}`;
          }
          // Validate. If the result isn't a parseable URL, drop it.
          try {
            new URL(website);
          } catch {
            website = null;
          }
        }
      }

      // Prefer the Type field's value (more specific) over Folder name.
      const typeLabel = ed(p, "Type").trim();
      const categoryLabel = typeLabel || folderName;
      const category = mapCategory(categoryLabel);

      // Stable id: slug of name + city + state to keep deterministic
      // re-runs producing the same JSON.
      const slug = `${name}-${city}-${state}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const id = slug || `${results.length + 1}`;

      results.push({ id, name, city, state, website, category });
    }
  }

  // Dedup pass: the same physical company often appears in multiple
  // folders (e.g. a flight school that also runs aerial-survey work),
  // or as case-variant duplicates. Merge by id, preferring records
  // with a website, mixed-case names, and more specific categories.
  const merged = new Map<string, LowtimepilotCompany>();
  let dupCount = 0;
  for (const r of results) {
    const existing = merged.get(r.id);
    if (!existing) {
      merged.set(r.id, r);
      continue;
    }
    dupCount++;
    merged.set(r.id, mergeDup(existing, r));
  }
  const deduped = Array.from(merged.values());
  console.log(`[lowtimepilot] dedup merged ${dupCount} duplicate id(s)`);

  deduped.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

  const withSite = deduped.filter((s) => s.website).length;
  const byCategory: Record<string, number> = {};
  for (const r of deduped) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

  console.log(`[lowtimepilot] parsed ${totalPlacemarks} placemarks total`);
  console.log(`[lowtimepilot] dropped ${droppedNonUS} non-US, ${droppedNoName} no-name`);
  console.log(`[lowtimepilot] kept ${deduped.length} US companies (${withSite} with websites)`);
  console.log(`[lowtimepilot] category breakdown:`, byCategory);

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(deduped, null, 2));
  console.log(`[lowtimepilot] wrote ${OUTPUT}`);
}

/** Merge two records that share the same id. Picks the better website,
 *  the better-cased name, and the more specific category. */
function mergeDup(
  a: LowtimepilotCompany,
  b: LowtimepilotCompany,
): LowtimepilotCompany {
  // Website: keep the non-null one. If both have one, keep a's.
  const website = a.website ?? b.website;

  // Name: prefer mixed-case when one is all-caps and the other isn't.
  const aAllCaps = a.name === a.name.toUpperCase();
  const bAllCaps = b.name === b.name.toUpperCase();
  let name = a.name;
  if (aAllCaps && !bAllCaps) name = b.name;
  else if (!aAllCaps && bAllCaps) name = a.name;

  // Category: prefer the more specific one. `part91` and `other` are the
  // generic buckets; anything else beats them. If both are specific and
  // differ, keep a (and log so we notice if this happens often).
  const generic = new Set(["part91", "other"]);
  let category = a.category;
  if (generic.has(a.category) && !generic.has(b.category)) {
    category = b.category;
  } else if (!generic.has(a.category) && generic.has(b.category)) {
    category = a.category;
  } else if (a.category !== b.category) {
    console.log(
      `[lowtimepilot] dedup: conflicting categories for ${a.id} — kept "${a.category}", dropped "${b.category}"`,
    );
  }

  return { id: a.id, name, city: a.city || b.city, state: a.state, website, category };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
