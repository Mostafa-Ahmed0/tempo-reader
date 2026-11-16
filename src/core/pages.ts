import type { Book } from './types';

/**
 * Words per page used when a book has no real pages (TXT, DOCX, EPUB without a page map, books imported
 * before page data existed). A conventional figure for a printed paperback page.
 */
export const WORDS_PER_PAGE_ESTIMATE = 275;

/** What page lookups need from a book. */
export type PageFields = Pick<Book, 'wordCount' | 'pageStarts'>;

/** Normalised page data of one book; build it once with `pageMapOf` and reuse it for lookups. */
export interface PageMap {
  /** true = real pages of the source file; false = estimate from WORDS_PER_PAGE_ESTIMATE */
  exact: boolean;
  total: number; // >= 1
  /** word index where each page begins (exact maps only) */
  starts: readonly number[] | null;
}

/**
 * Real page starts are usable when they are a non-empty, non-decreasing list of integers that begins at 0
 * and stays within 0..wordCount. Anything else (missing, damaged backup, ...) falls back to the estimate.
 */
export function isValidPageStarts(starts: unknown, wordCount: number): starts is number[] {
  if (!Array.isArray(starts) || starts.length === 0 || starts[0] !== 0) return false;
  let prev = 0;
  for (const s of starts) {
    if (!Number.isInteger(s) || s < prev || s > wordCount) return false;
    prev = s;
  }
  return true;
}

export function pageMapOf(book: PageFields): PageMap {
  const wordCount = Math.max(0, book.wordCount || 0);
  if (isValidPageStarts(book.pageStarts, wordCount)) return { exact: true, total: book.pageStarts.length, starts: book.pageStarts };
  return { exact: false, total: Math.max(1, Math.ceil(wordCount / WORDS_PER_PAGE_ESTIMATE)), starts: null };
}

/** 1-based page that contains word `position` (the end of the book counts as the last page). */
export function pageAt(map: PageMap, position: number): number {
  const pos = Math.max(0, Number.isFinite(position) ? position : 0);
  if (!map.starts) return Math.min(map.total, Math.floor(pos / WORDS_PER_PAGE_ESTIMATE) + 1);
  // last page whose start is <= pos; pages without text share the next page's start, so this picks the page with text
  const s = map.starts;
  let lo = 0;
  let hi = s.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans + 1;
}

/** Word index where 1-based `page` begins (clamped to 1..total). */
export function pageStartIndex(map: PageMap, page: number): number {
  const p = Math.min(map.total, Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)));
  return map.starts ? map.starts[p - 1] : (p - 1) * WORDS_PER_PAGE_ESTIMATE;
}

/**
 * Words [from, to) of 1-based `page` in a book of `wordCount` words (the reader's page view).
 * A page without text (real pages only) is empty: from === to.
 */
export function pageRange(map: PageMap, page: number, wordCount: number): [number, number] {
  const p = Math.min(map.total, Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)));
  const n = Math.max(0, wordCount);
  const from = Math.min(n, pageStartIndex(map, p));
  const to = p >= map.total ? n : Math.min(n, pageStartIndex(map, p + 1));
  return [from, Math.max(from, to)];
}

/** First word of the page before the one holding `position` (skipping pages without text), or null on the first page. */
export function prevPageStart(map: PageMap, position: number): number | null {
  const page = pageAt(map, position);
  const start = pageStartIndex(map, page);
  for (let p = page - 1; p >= 1; p--) {
    const s = pageStartIndex(map, p);
    if (s < start) return pageStartIndex(map, pageAt(map, s));
  }
  return null;
}

/** First word of the page after the one holding `position`, or null when there is none with text. */
export function nextPageStart(map: PageMap, position: number, wordCount: number): number | null {
  const page = pageAt(map, position);
  if (page >= map.total) return null;
  const s = pageStartIndex(map, page + 1);
  return s < wordCount ? s : null;
}

const nf = (n: number) => n.toLocaleString('en-US');

/** "Page 50 of 312" / "≈ page 14 of 120"; short: "p. 50 of 312" / "≈ p. 14 of 120". */
export function formatPageOf(map: PageMap, position: number, short = false): string {
  const page = pageAt(map, position);
  const word = short ? 'p.' : map.exact ? 'Page' : 'page';
  return `${map.exact ? '' : '≈ '}${word} ${nf(page)} of ${nf(map.total)}`;
}

/** Just the page: "p. 50" / "≈ p. 14" (bookmark and chapter lists). */
export function formatPage(map: PageMap, position: number): string {
  return `${map.exact ? '' : '≈ '}p. ${nf(pageAt(map, position))}`;
}

/** "312 pages" / "≈ 120 pages" / "1 page". */
export function formatPageCount(map: PageMap): string {
  return `${map.exact ? '' : '≈ '}${nf(map.total)} ${map.total === 1 ? 'page' : 'pages'}`;
}

/** Spoken form for screen readers ("about" instead of "≈"). */
export function pageAccessibleLabel(map: PageMap, position: number): string {
  return `${map.exact ? '' : 'about '}page ${pageAt(map, position)} of ${map.total}`;
}

/** Tooltip explaining an estimate. */
export const ESTIMATED_PAGES_HINT = `Estimated at ${WORDS_PER_PAGE_ESTIMATE} words per page; the file's own page numbers are not available`;
