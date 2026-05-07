/**
 * Theme switching — class-strategy Tailwind dark mode.
 *
 * Dark is the default for first-time users (the meta theme-color in
 * index.html already matches), but a user's explicit toggle wins over
 * everything and is remembered.
 *
 * Order of precedence on load:
 *   1. localStorage["flightpath:theme"] if "dark" or "light"
 *   2. matchMedia('prefers-color-scheme: light') → light
 *   3. dark (default)
 */

const STORAGE_KEY = "flightpath:theme";

export type Theme = "dark" | "light";

export function readTheme(): Theme {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function writeTheme(t: Theme): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }
}

export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (t === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  // Sync the iOS / Android browser chrome bar to match.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#0d1320" : "#f5f7fa");
}
