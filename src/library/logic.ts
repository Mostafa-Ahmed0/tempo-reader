/** Pure library helpers: status, search, sort, filter, duplicates, generated-cover colours. */
import type { Book, BookFormat } from '../core/types';

export type SortKey = 'recent-read' | 'recent-added' | 'title' | 'author' | 'progress';
export type BuiltinFilter = 'all' | 'reading' | 'not-started' | 'finished' | 'favorites';
/** A built-in filter or `tag:<name>`. */
export type FilterKey = BuiltinFilter | `tag:${string}`;

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent-read', label: 'Recently read' },
  { value: 'recent-added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'progress', label: 'Progress' },
];

export const BUILTIN_FILTERS: { value: BuiltinFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'reading', label: 'Reading' },
  { value: 'not-started', label: 'Not started' },
  { value: 'finished', label: 'Finished' },
  { value: 'favorites', label: 'Favourites' },
];

export type BookStatus = 'reading' | 'not-started' | 'finished';

type StatusFields = Pick<Book, 'position' | 'wordCount' | 'finishedAt'>;

export function bookStatus(b: StatusFields): BookStatus {
  if (b.finishedAt != null) return 'finished';
  return b.position > 0 ? 'reading' : 'not-started';
}

/** 0..1 */
export function bookProgress(b: StatusFields): number {
  if (b.finishedAt != null) return 1;
  if (b.wordCount <= 0) return 0;
  return Math.max(0, Math.min(1, b.position / b.wordCount));
}

export function wordsLeft(b: StatusFields): number {
  if (b.finishedAt != null) return 0;
  return Math.max(0, b.wordCount - b.position);
}

/** Lower-case, accents stripped, whitespace collapsed. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every whitespace-separated term of the query must occur in the title or the author. */
export function matchesSearch(b: Pick<Book, 'title' | 'author'>, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  const hay = normalizeText(`${b.title} ${b.author}`);
  return q.split(' ').every((term) => hay.includes(term));
}

export function matchesFilter(b: Book, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'reading':
    case 'not-started':
    case 'finished':
      return bookStatus(b) === filter;
    case 'favorites':
      return b.favorite;
    default:
      return b.tags.includes(filter.slice(4));
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Leading English articles are ignored when sorting by title ("The Hobbit" sorts under H). */
export function titleSortKey(title: string): string {
  return title.trim().replace(/^(the|a|an)\s+/i, '');
}

export function compareBooks(a: Book, b: Book, sort: SortKey): number {
  const byTitle = () => collator.compare(titleSortKey(a.title), titleSortKey(b.title));
  switch (sort) {
    case 'recent-read': {
      // opened books first (newest open first), never-opened ones after, newest added first
      const la = a.lastOpenedAt ?? -Infinity;
      const lb = b.lastOpenedAt ?? -Infinity;
      if (la !== lb) return lb > la ? 1 : -1;
      return b.addedAt - a.addedAt;
    }
    case 'recent-added':
      return b.addedAt - a.addedAt || byTitle();
    case 'title':
      return byTitle() || b.addedAt - a.addedAt;
    case 'author': {
      // books without an author go last
      if (!a.author !== !b.author) return a.author ? -1 : 1;
      return collator.compare(a.author, b.author) || byTitle();
    }
    case 'progress':
      return bookProgress(b) - bookProgress(a) || (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || byTitle();
  }
}

/** Search + filter + sort in one pass. Does not mutate `books`. */
export function selectBooks(books: readonly Book[], opts: { query: string; filter: FilterKey; sort: SortKey }): Book[] {
  return books
    .filter((b) => matchesFilter(b, opts.filter) && matchesSearch(b, opts.query))
    .sort((a, b) => compareBooks(a, b, opts.sort));
}

/** All tags in use, sorted case-insensitively, unique. */
export function allTags(books: readonly Pick<Book, 'tags'>[]): string[] {
  const set = new Set<string>();
  for (const b of books) for (const t of b.tags) if (t.trim()) set.add(t);
  return [...set].sort((a, b) => collator.compare(a, b));
}

/** Trim, collapse whitespace, cap length. Returns '' for unusable input. */
export function cleanTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Add a tag unless an equal one (case-insensitive) is present; returns a new array. */
export function addTag(tags: readonly string[], raw: string): string[] {
  const t = cleanTag(raw);
  if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return [...tags];
  return [...tags, t];
}

/** The most recently opened unfinished book, or undefined. */
export function continueReading(books: readonly Book[]): Book | undefined {
  let best: Book | undefined;
  for (const b of books) {
    if (b.finishedAt != null || b.lastOpenedAt == null || b.wordCount === 0) continue;
    if (!best || b.lastOpenedAt > (best.lastOpenedAt ?? 0)) best = b;
  }
  return best;
}

/** A library book with the same file name (case-insensitive) and size, if any. Pasted texts never count. */
export function findDuplicate(
  file: { name: string; size: number },
  books: readonly Pick<Book, 'fileName' | 'fileSize' | 'format' | 'title' | 'id'>[],
): Pick<Book, 'fileName' | 'fileSize' | 'format' | 'title' | 'id'> | undefined {
  const name = file.name.trim().toLowerCase();
  if (!name) return undefined;
  return books.find((b) => b.format !== 'paste' && b.fileSize === file.size && b.fileName.trim().toLowerCase() === name);
}

/** "PDF, EPUB, MOBI and TXT" */
export function formatList(exts: readonly string[]): string {
  const up = exts.map((e) => e.toUpperCase());
  if (up.length <= 1) return up.join('');
  return `${up.slice(0, -1).join(', ')} and ${up[up.length - 1]}`;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

export function formatLabel(format: BookFormat): string {
  return format === 'paste' ? 'Text' : format.toUpperCase();
}

/**
 * Badge text for a book: the real file extension (".doc" stays DOC even though it is stored as
 * 'docx', ".azw3" stays AZW3 rather than MOBI). Falls back to the stored format for pasted texts,
 * files without an extension, and mis-named files (a PDF called "book.bin" shows PDF).
 */
const FORMAT_EXTS: Partial<Record<BookFormat, string[]>> = {
  docx: ['docx', 'doc'],
  mobi: ['mobi', 'azw', 'azw3', 'kf8', 'prc', 'pdb'],
  txt: ['txt', 'text'],
  md: ['md', 'markdown'],
  html: ['html', 'htm', 'xhtml', 'xht'],
};
export function formatBadge(b: Pick<Book, 'fileName' | 'format'>): string {
  if (b.format === 'paste') return 'Text';
  if (b.format === 'fb2') return 'FB2'; // also for .fb2.zip
  const ext = extensionOf(b.fileName);
  const allowed = FORMAT_EXTS[b.format] ?? [b.format];
  return ext && allowed.includes(ext) ? ext.toUpperCase() : formatLabel(b.format);
}

// ---------------------------------------------------------------------------
// Generated covers
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a hash of a string (stable across sessions and platforms). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface CoverPalette {
  hue: number; // 0..359
  /** Two stops of the background gradient + ink colour for the title. */
  from: string;
  to: string;
  ink: string;
  rule: string;
  /** Which of the few cover layouts to use (0..2). */
  pattern: number;
}

/**
 * Deterministic cover colours from a stable seed (the book id, so editing the title keeps the look). Muted, deep tones (book-cloth look) that keep light ink
 * readable (contrast stays well above 4.5:1 since lightness is capped at 34%) and look calm on every theme.
 */
export function coverPalette(seed: string): CoverPalette {
  const h = hashString(normalizeText(seed) || 'untitled');
  const hue = h % 360;
  const sat = 28 + ((h >>> 9) % 22); // 28..49 %
  const light = 22 + ((h >>> 17) % 10); // 22..31 %
  const shift = 18 + ((h >>> 23) % 20); // gradient hue shift
  return {
    hue,
    from: `hsl(${hue} ${sat}% ${light + 3}%)`,
    to: `hsl(${(hue + shift) % 360} ${Math.min(60, sat + 6)}% ${light - 6}%)`,
    ink: `hsl(${hue} 30% 94%)`,
    rule: `hsl(${hue} 40% 70% / 0.55)`,
    pattern: (h >>> 5) % 3,
  };
}
