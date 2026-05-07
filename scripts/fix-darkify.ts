/**
 * Strip the wrong-direction dark variants my first darkify pass added.
 * The earlier script matched `text-ink-50` and added `dark:text-ink-900`,
 * but the elements that had `text-ink-50` only had it because I was
 * adding it as the dark variant for `text-ink-900` — so the result was
 * `text-ink-900 dark:text-ink-50 dark:text-ink-900`, two conflicting
 * dark variants where Tailwind takes the latter and renders dark on dark.
 */

import { readFile, writeFile } from "node:fs/promises";

const FILE = "./src/web/App.tsx";

const REMOVALS = [
  // Pattern: ` dark:bg-ink-50` only when it follows another dark variant.
  // The simplest robust fix: remove specific exact-substring occurrences.
  " dark:bg-ink-50",
  " dark:text-ink-900",
  " dark:bg-ink-50 ",
  " dark:text-ink-900 ",
];

const before = await readFile(FILE, "utf8");
let after = before;
for (const r of REMOVALS) {
  // Only inside className strings — but the substrings are specific enough
  // that we can do a global replace safely.
  while (after.includes(r)) after = after.replace(r, "");
}

// Also collapse any double-spaces inside className attributes that may
// have been introduced by removals.
after = after.replace(/className="([^"]*)"/g, (_, classes) => {
  return `className="${classes.replace(/\s+/g, " ").trim()}"`;
});

await writeFile(FILE, after);
console.log(`fix-darkify: removed wrong-direction variants; file shrunk ${before.length - after.length} chars`);
