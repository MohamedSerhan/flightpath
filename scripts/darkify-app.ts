/**
 * One-shot bulk-add `dark:` variants to className strings in App.tsx.
 * Idempotent — safe to re-run; checks for the dark variant before adding.
 *
 * Run with: bun scripts/darkify-app.ts
 */

import { readFile, writeFile } from "node:fs/promises";

const FILE = "./src/web/App.tsx";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addDark(input: string, base: string, dark: string): string {
  // Match className="...base..." and append dark variants if not already there.
  const re = new RegExp(`(className="[^"]*\\b${escapeRegex(base)}\\b[^"]*?)(")`, "g");
  return input.replace(re, (full, p1, p2) => {
    const firstDarkClass = dark.split(" ")[0];
    if (p1.includes(firstDarkClass)) return full;
    return `${p1} ${dark}${p2}`;
  });
}

const rules: Array<[string, string]> = [
  // Backgrounds
  ["bg-white", "dark:bg-ink-800"],
  ["bg-ink-50", "dark:bg-ink-900"],
  ["bg-ink-100", "dark:bg-ink-700"],
  ["bg-white/80", "dark:bg-ink-900/80"],

  // Borders
  ["border-ink-100", "dark:border-ink-800"],
  ["border-ink-200", "dark:border-ink-800"],

  // Text
  ["text-ink-900", "dark:text-ink-50"],
  ["text-ink-800", "dark:text-ink-100"],
  ["text-ink-600", "dark:text-ink-200"],

  // Hover/interactive
  ["hover:border-ink-400", "dark:hover:border-ink-600"],
  ["hover:bg-ink-100", "dark:hover:bg-ink-700"],
  ["hover:text-ink-900", "dark:hover:text-ink-100"],

  // Sky chip
  ["bg-sky-500/10", "dark:bg-sky-500/20"],
  ["text-sky-600", "dark:text-sky-300"],

  // Status tones
  ["bg-amber-50", "dark:bg-amber-900/30"],
  ["text-amber-700", "dark:text-amber-200"],
  ["text-amber-800", "dark:text-amber-200"],
  ["border-amber-200", "dark:border-amber-800"],
  ["bg-amber-100", "dark:bg-amber-900/40"],
  ["ring-amber-200", "dark:ring-amber-800"],

  // Modal backdrop
  ["bg-ink-900/40", "dark:bg-black/60"],

  // Ring outlines
  ["ring-ink-100", "dark:ring-ink-700"],

  // Pipeline status colors
  ["bg-rose-100", "dark:bg-rose-900/40"],
  ["text-rose-700", "dark:text-rose-200"],
  ["ring-rose-200", "dark:ring-rose-800"],
  ["border-rose-200", "dark:border-rose-800"],
  ["hover:border-rose-400", "dark:hover:border-rose-600"],
  ["bg-emerald-100", "dark:bg-emerald-900/40"],
  ["text-emerald-800", "dark:text-emerald-200"],
  ["ring-emerald-200", "dark:ring-emerald-800"],
  ["bg-violet-100", "dark:bg-violet-900/40"],
  ["text-violet-800", "dark:text-violet-200"],
  ["ring-violet-200", "dark:ring-violet-800"],
  ["bg-sky-100", "dark:bg-sky-900/40"],
  ["text-sky-800", "dark:text-sky-200"],
  ["ring-sky-200", "dark:ring-sky-800"],

  // Misc
  ["text-ink-700", "dark:text-ink-200"],
  ["bg-ink-900", "dark:bg-ink-50"],
  ["text-ink-50", "dark:text-ink-900"],
];

const before = await readFile(FILE, "utf8");
let after = before;
let changes = 0;
for (const [base, dark] of rules) {
  const prev = after;
  after = addDark(after, base, dark);
  if (after !== prev) changes++;
}
await writeFile(FILE, after);
console.log(`darkify: ${changes} rules applied; file grew ${after.length - before.length} chars`);
