/**
 * PDF text-layout reconstruction, independent of pdf.js so it can be unit-tested on synthetic items.
 * Coordinates are PDF user space: origin bottom-left, y grows upwards.
 *
 * Pipeline: items -> line fragments (per baseline, split at big gaps) -> reading order (1 or 2 columns)
 * -> margin (header/footer/page number) removal across pages -> paragraphs/headings -> page joining.
 */
import { headingKind, joinFragments, cleanInline } from './textUtils';

export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** font size (em height) */
  size: number;
  /** pdf.js hasEOL */
  eol?: boolean;
}

export interface PdfPageInput {
  width: number;
  height: number;
  items: PdfItem[];
}

export interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  /** column index within the page (0 single/left, 1 right, -1 spanning) */
  col: number;
  /** characters (for weighting) */
  chars: number;
}

export interface PdfBlock {
  kind: 'p' | 'h';
  text: string;
  page: number; // 0-based
  y: number; // top line's baseline
  size: number;
  /** last line ended short of the right margin (for joining across pages) */
  lastLineShort?: boolean;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Weighted mode of rounded values. */
function mode(values: { v: number; w: number }[], round = 0.5): number {
  const m = new Map<number, number>();
  for (const { v, w } of values) {
    const k = Math.round(v / round) * round;
    m.set(k, (m.get(k) ?? 0) + w);
  }
  let best = 0;
  let bestW = -1;
  for (const [k, w] of m) if (w > bestW) [best, bestW] = [k, w];
  return best;
}

// ---------------------------------------------------------------------------
// Items -> line fragments
// ---------------------------------------------------------------------------

/** Group items into line fragments: same baseline, no large horizontal gap. */
export function itemsToLines(items: PdfItem[]): Line[] {
  const its = items.filter((it) => it.str && it.str.trim() && it.size > 0 && Number.isFinite(it.x) && Number.isFinite(it.y));
  // drop duplicates (fake bold = same string drawn twice with a tiny offset)
  const dedup: PdfItem[] = [];
  const seen = new Map<string, PdfItem[]>();
  for (const it of its) {
    const key = it.str;
    const list = seen.get(key) ?? [];
    if (list.some((o) => Math.abs(o.x - it.x) < 1.5 && Math.abs(o.y - it.y) < 1.5)) continue;
    list.push(it);
    seen.set(key, list);
    dedup.push(it);
  }
  dedup.sort((a, b) => b.y - a.y || a.x - b.x);

  // cluster by baseline
  const rows: PdfItem[][] = [];
  for (const it of dedup) {
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row[0];
      const tol = Math.max(ref.size, it.size) * 0.45;
      if (Math.abs(ref.y - it.y) <= tol) {
        row.push(it);
        continue;
      }
    }
    rows.push([it]);
  }

  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let cur: PdfItem[] = [];
    const emit = () => {
      if (!cur.length) return;
      // body size of the fragment = size with most characters (superscripts don't count)
      const size = mode(cur.map((c) => ({ v: c.size, w: c.str.length })), 0.25);
      let text = '';
      let prev: PdfItem | null = null;
      for (const c of cur) {
        if (prev) {
          const gap = c.x - (prev.x + prev.width);
          const needSpace = gap > Math.min(prev.size, c.size) * 0.12 && !/\s$/.test(text) && !/^\s/.test(c.str);
          if (needSpace) text += ' ';
        }
        text += c.str;
        prev = c;
      }
      const last = cur[cur.length - 1];
      const t = cleanInline(text);
      if (t)
        lines.push({
          text: t,
          x: cur[0].x,
          right: last.x + last.width,
          y: mode(cur.map((c) => ({ v: c.y, w: c.str.length })), 0.25),
          size,
          col: 0,
          chars: t.length,
        });
      cur = [];
    };
    for (const it of row) {
      const prev = cur[cur.length - 1];
      if (prev) {
        const gap = it.x - (prev.x + prev.width);
        if (gap > Math.max(prev.size, it.size) * 1.5) emit();
      }
      cur.push(it);
    }
    emit();
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Reading order
// ---------------------------------------------------------------------------

/** Find a vertical gutter for a two-column page; returns its x or null. */
export function findGutter(lines: Line[], pageWidth: number): number | null {
  const total = lines.reduce((s, l) => s + l.chars, 0);
  if (total < 200 || lines.length < 8) return null;
  let best: { x: number; cross: number } | null = null;
  for (let x = pageWidth * 0.3; x <= pageWidth * 0.7; x += 2) {
    let cross = 0;
    let left = 0;
    let right = 0;
    let rightLines = 0;
    let leftLines = 0;
    for (const l of lines) {
      if (l.right <= x) {
        left += l.chars;
        leftLines++;
      } else if (l.x >= x) {
        right += l.chars;
        rightLines++;
      } else cross += l.chars;
    }
    if (left < total * 0.2 || right < total * 0.2 || leftLines < 4 || rightLines < 4) continue;
    if (cross > total * 0.15) continue;
    if (!best || cross < best.cross) best = { x, cross };
  }
  if (!best) return null;
  // The right column must have a common left edge (not just ragged right-aligned bits).
  const rightStarts = lines.filter((l) => l.x >= best!.x).map((l) => l.x);
  const edge = median(rightStarts);
  const aligned = rightStarts.filter((x) => Math.abs(x - edge) < 15).length;
  return aligned >= rightStarts.length * 0.5 ? best.x : null;
}

/** Order lines for reading: spanning lines act as separators; within a band, left column then right. */
export function orderLines(lines: Line[], pageWidth: number): Line[] {
  const sorted = [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
  const gutter = findGutter(sorted, pageWidth);
  if (gutter === null) return mergeSameLine(sorted.map((l) => ({ ...l, col: 0 })));
  const out: Line[] = [];
  let left: Line[] = [];
  let right: Line[] = [];
  const flush = () => {
    out.push(...mergeSameLine(left), ...mergeSameLine(right));
    left = [];
    right = [];
  };
  for (const l of sorted) {
    if (l.right <= gutter) left.push({ ...l, col: 0 });
    else if (l.x >= gutter) right.push({ ...l, col: 1 });
    else {
      flush();
      out.push({ ...l, col: -1 });
    }
  }
  flush();
  return out;
}

/** Merge consecutive fragments on the same baseline (split earlier by wide justified gaps). */
function mergeSameLine(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    const p = out[out.length - 1];
    if (p && p.col === l.col && Math.abs(p.y - l.y) <= Math.max(p.size, l.size) * 0.45 && l.x >= p.right - 1) {
      out[out.length - 1] = { ...p, text: `${p.text} ${l.text}`, right: l.right, chars: p.chars + l.chars + 1 };
    } else out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Margins: running headers/footers and page numbers
// ---------------------------------------------------------------------------

const RE_PAGE_NUMBER = /^(?:[-\u2013\u2014[(]\s*)?(?:page\s+|p\.\s*|seite\s+)?(?:\d{1,4}|[ivxlcdm]{1,6})(?:\s*(?:of|\/|von)\s*\d{1,4})?(?:\s*[-\u2013\u2014\])])?$/i;

export function isPageNumber(text: string): boolean {
  return RE_PAGE_NUMBER.test(text.trim());
}

/** Running-header key: lowercase, page numbers at either end removed. */
function marginKey(text: string): string {
  // "Chapter 3" at the top of a page is a heading, not "Chapter" + page number.
  if (headingKind(text) === 'chapter') return text.toLowerCase().replace(/\s+/g, ' ').trim();
  return text
    .toLowerCase()
    .replace(/^\s*(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,6})\b[\s|.\u2022\u00B7-]*/i, '')
    .replace(/[\s|.\u2022\u00B7-]*\b(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,6})(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove running headers/footers and page numbers. Candidates are the top/bottom 2 lines of each page
 * lying within the outer 12% of the page. A candidate is dropped if it is a bare page number, or if
 * its text (minus page numbers) repeats near the same edge on enough pages.
 */
export function removeMargins(pages: { lines: Line[]; height: number }[], bodySize: number): Line[][] {
  const n = pages.length;
  type Cand = { page: number; idx: number; key: string; edge: 'top' | 'bottom'; line: Line };
  const cands: Cand[] = [];
  pages.forEach((p, pi) => {
    const byY = p.lines.map((l, idx) => ({ l, idx })).sort((a, b) => b.l.y - a.l.y);
    const top = byY.slice(0, 2).filter(({ l }) => l.y >= p.height * 0.88);
    const bottom = byY.slice(-2).filter(({ l }) => l.y <= p.height * 0.12);
    for (const { l, idx } of top) cands.push({ page: pi, idx, key: marginKey(l.text), edge: 'top', line: l });
    for (const { l, idx } of bottom) if (!top.some((t) => t.idx === idx)) cands.push({ page: pi, idx, key: marginKey(l.text), edge: 'bottom', line: l });
  });
  const counts = new Map<string, Set<number>>();
  for (const c of cands) {
    if (!c.key) continue;
    const k = `${c.edge}|${c.key}`;
    if (!counts.has(k)) counts.set(k, new Set());
    counts.get(k)!.add(c.page);
  }
  const minRepeat = n < 3 ? 2 : n < 8 ? Math.max(2, Math.ceil(n * 0.4)) : 3;
  const drop = new Set<string>();
  for (const c of cands) {
    const pagesWith = c.key ? (counts.get(`${c.edge}|${c.key}`)?.size ?? 0) : 0;
    const small = c.line.size <= bodySize * 1.1;
    // a big bare "IV" is a chapter heading; a body-size or smaller one is a page number
    const bare = (!c.key || isPageNumber(c.line.text)) && small;
    // big repeated lines (chapter titles used as running heads) need more evidence
    const repeated = small ? pagesWith >= minRepeat : pagesWith >= Math.max(3, minRepeat, n * 0.3);
    if (bare || repeated) drop.add(`${c.page}|${c.idx}`);
  }
  return pages.map((p, pi) => p.lines.filter((_l, idx) => !drop.has(`${pi}|${idx}`)));
}

// ---------------------------------------------------------------------------
// Lines -> blocks
// ---------------------------------------------------------------------------

export interface DocStats {
  bodySize: number;
  lineGap: number; // typical baseline distance for body text, in units of bodySize
}

export function computeStats(pages: Line[][]): DocStats {
  const sizes: { v: number; w: number }[] = [];
  for (const p of pages) for (const l of p) sizes.push({ v: l.size, w: l.chars });
  const bodySize = mode(sizes, 0.5) || 10;
  const gaps: number[] = [];
  for (const p of pages) {
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      if (a.col !== b.col) continue;
      if (Math.abs(a.size - bodySize) > bodySize * 0.1 || Math.abs(b.size - bodySize) > bodySize * 0.1) continue;
      const d = a.y - b.y;
      if (d > bodySize * 0.8 && d < bodySize * 3) gaps.push(d / bodySize);
    }
  }
  return { bodySize, lineGap: median(gaps) || 1.2 };
}

const RE_BULLET = /^(?:[\u2022\u25CF\u25AA\u25E6\u2023\u2043\u2013\u2014*-]\s|\(?\d{1,3}[.)]\s|\(?[a-z][.)]\s)/;
const RE_END = /[.!?:"\u201D\u2019)\u2026]$/;

/** Turn one page's ordered lines into blocks. */
export function pageToBlocks(lines: Line[], page: number, stats: DocStats): PdfBlock[] {
  const { bodySize, lineGap } = stats;
  const blocks: PdfBlock[] = [];
  // Per-column margins
  const colLeft = new Map<number, number>();
  const colRight = new Map<number, number>();
  for (const col of new Set(lines.map((l) => l.col))) {
    const ls = lines.filter((l) => l.col === col && Math.abs(l.size - bodySize) <= bodySize * 0.15);
    if (!ls.length) continue;
    colLeft.set(col, mode(ls.map((l) => ({ v: l.x, w: 1 })), 2));
    const rights = ls.map((l) => l.right).sort((a, b) => a - b);
    colRight.set(col, rights[Math.floor(rights.length * 0.9)] ?? rights[rights.length - 1]);
  }

  let cur: { lines: Line[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const ls = cur.lines;
    let text = '';
    for (const l of ls) text = joinFragments(text, l.text);
    const size = mode(ls.map((l) => ({ v: l.size, w: l.chars })), 0.25);
    const isHeading =
      (size >= bodySize * 1.15 && text.length <= 150 && ls.length <= 4 && /\p{L}/u.test(text)) ||
      (ls.length <= 2 && text.length <= 80 && headingKind(text) === 'chapter');
    const last = ls[ls.length - 1];
    const right = colRight.get(last.col) ?? last.right;
    blocks.push({
      kind: isHeading ? 'h' : 'p',
      text,
      page,
      y: ls[0].y,
      size,
      lastLineShort: last.right < right - Math.max(3 * bodySize, 0.12 * (right - (colLeft.get(last.col) ?? 0))),
    });
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const p = i > 0 ? lines[i - 1] : null;
    if (!cur || !p) {
      cur = { lines: [l] };
      continue;
    }
    let brk = false;
    const sizeChange = Math.abs(l.size - p.size) > Math.max(l.size, p.size) * 0.15;
    const left = colLeft.get(l.col) ?? l.x;
    const right = colRight.get(p.col) ?? p.right;
    const width = right - (colLeft.get(p.col) ?? p.x);
    const dy = p.y - l.y;
    if (l.col !== p.col) {
      // column/band change: continue the paragraph only if the previous line ran to the margin
      // (spanning lines such as titles always break)
      brk = p.col === -1 || l.col === -1 || sizeChange || (p.right < right - Math.max(3 * bodySize, 0.12 * width) && RE_END.test(p.text));
    } else if (dy < -bodySize) {
      brk = true; // jumped upwards within a column (figure text etc.)
    } else if (sizeChange) {
      brk = true;
    } else if (dy > l.size * lineGap * 1.45 + 0.5) {
      brk = true; // vertical gap
    } else if (RE_BULLET.test(l.text)) {
      brk = true;
    } else if (l.x > p.x + l.size * 0.7 && l.x < left + l.size * 8 && Math.abs(p.x - left) < l.size * 0.7) {
      brk = true; // first-line indent
    } else if (p.right < right - Math.max(3 * bodySize, 0.12 * width) && RE_END.test(p.text)) {
      brk = true; // previous line ended early with sentence punctuation
    }
    if (brk) {
      flush();
      cur = { lines: [l] };
    } else cur.lines.push(l);
  }
  flush();
  return blocks;
}

/** Drop small-font lines at the bottom of a page below the main text (footnotes). */
export function dropFootnotes(lines: Line[], stats: DocStats, pageHeight: number): Line[] {
  let lastBody = -1;
  lines.forEach((l, i) => {
    if (Math.abs(l.size - stats.bodySize) <= stats.bodySize * 0.1) lastBody = i;
  });
  if (lastBody < 0) return lines;
  return lines.filter((l, i) => !(i > lastBody && l.size < stats.bodySize * 0.85 && l.y < pageHeight * 0.4 && l.col !== -1));
}

/** Merge a paragraph broken across pages / columns. */
export function joinAcrossPages(blocks: PdfBlock[]): PdfBlock[] {
  const out: PdfBlock[] = [];
  for (const b of blocks) {
    const p = out[out.length - 1];
    if (
      p &&
      p.kind === 'p' &&
      b.kind === 'p' &&
      b.page === p.page + 1 &&
      Math.abs(b.size - p.size) <= p.size * 0.1 &&
      (!RE_END.test(p.text) || /^\p{Ll}/u.test(b.text)) &&
      !p.lastLineShort
    ) {
      out[out.length - 1] = { ...p, text: joinFragments(p.text, b.text), lastLineShort: b.lastLineShort };
    } else out.push(b);
  }
  return out;
}

/** Full layout pipeline for a document's pages (each page's items in PDF coordinates). */
export function layoutPages(pages: PdfPageInput[]): { blocks: PdfBlock[]; stats: DocStats } {
  return layoutLines(pages.map((p) => ({ lines: orderLines(itemsToLines(p.items), p.width), height: p.height })));
}

/** Second half of the pipeline, for pages already turned into ordered lines (keeps memory low). */
export function layoutLines(pages: { lines: Line[]; height: number }[]): { blocks: PdfBlock[]; stats: DocStats } {
  const pre = computeStats(pages.map((p) => p.lines));
  const cleaned = removeMargins(pages, pre.bodySize);
  const stats = computeStats(cleaned);
  const blocks: PdfBlock[] = [];
  cleaned.forEach((lines, i) => blocks.push(...pageToBlocks(dropFootnotes(lines, stats, pages[i].height), i, stats)));
  return { blocks: joinAcrossPages(blocks), stats };
}
