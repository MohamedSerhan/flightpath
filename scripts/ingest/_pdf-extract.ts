/**
 * Shared PDF text extractor for the FAA reference library ingest scripts.
 *
 * Wraps pdfjs-dist. Reads a local PDF file, returns an array of pages
 * each with its raw text lines. Per-doc chunkers consume this output
 * and group lines into sections via heading regex.
 *
 * Build-time only — never imported by the client bundle.
 */

import { readFile } from "node:fs/promises";

export type PdfPage = {
  page: number;
  lines: string[];
};

export async function extractPdfText(pdfPath: string): Promise<PdfPage[]> {
  // pdfjs-dist's legacy build is the Node-friendly entry — the modern
  // ESM build wants browser globals we don't have under Bun.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const pages: PdfPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    // Group items by y-position to recover line structure. pdfjs returns
    // text "items" with x/y coords; same-line items have ~equal y.
    const byY = new Map<number, string[]>();
    for (const item of textContent.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push(item.str);
    }
    const lines: string[] = [];
    const sortedYs = [...byY.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const line = byY.get(y)!.join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
    pages.push({ page: i, lines });
  }
  return pages;
}
