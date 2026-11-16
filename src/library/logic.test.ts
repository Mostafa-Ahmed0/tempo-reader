import { describe, expect, it } from 'vitest';
import type { Book } from '../core/types';
import {
  addTag,
  allTags,
  bookProgress,
  bookStatus,
  compareBooks,
  continueReading,
  coverPalette,
  findDuplicate,
  formatBadge,
  formatList,
  hashString,
  matchesFilter,
  matchesSearch,
  selectBooks,
} from './logic';

let n = 0;
function book(p: Partial<Book> = {}): Book {
  n++;
  return {
    id: `b${n}`,
    title: `Book ${n}`,
    author: '',
    format: 'txt',
    fileName: `book${n}.txt`,
    fileSize: 100 * n,
    wordCount: 1000,
    position: 0,
    addedAt: n * 1000,
    lastOpenedAt: null,
    finishedAt: null,
    favorite: false,
    tags: [],
    ...p,
  };
}

describe('status and progress', () => {
  it('classifies books', () => {
    expect(bookStatus(book())).toBe('not-started');
    expect(bookStatus(book({ position: 1 }))).toBe('reading');
    expect(bookStatus(book({ position: 1000, finishedAt: 5 }))).toBe('finished');
    // finishedAt wins even if the position was reset by hand
    expect(bookStatus(book({ position: 0, finishedAt: 5 }))).toBe('finished');
  });
  it('progress is clamped and safe for empty books', () => {
    expect(bookProgress(book({ position: 250 }))).toBe(0.25);
    expect(bookProgress(book({ position: 5000 }))).toBe(1);
    expect(bookProgress(book({ wordCount: 0 }))).toBe(0);
    expect(bookProgress(book({ finishedAt: 1, position: 3 }))).toBe(1);
  });
});

describe('search', () => {
  const b = book({ title: 'Les Misérables', author: 'Victor Hugo' });
  it('matches title or author, case and accent insensitive', () => {
    expect(matchesSearch(b, 'miserables')).toBe(true);
    expect(matchesSearch(b, 'HUGO')).toBe(true);
    expect(matchesSearch(b, '  ')).toBe(true);
  });
  it('requires every term', () => {
    expect(matchesSearch(b, 'hugo les')).toBe(true);
    expect(matchesSearch(b, 'hugo dumas')).toBe(false);
  });
});

describe('filters', () => {
  const reading = book({ position: 10 });
  const fresh = book();
  const done = book({ finishedAt: 1, position: 1000, favorite: true, tags: ['Work'] });
  it('built-in filters', () => {
    expect(matchesFilter(reading, 'reading')).toBe(true);
    expect(matchesFilter(fresh, 'reading')).toBe(false);
    expect(matchesFilter(fresh, 'not-started')).toBe(true);
    expect(matchesFilter(done, 'finished')).toBe(true);
    expect(matchesFilter(done, 'favorites')).toBe(true);
    expect(matchesFilter(reading, 'favorites')).toBe(false);
    expect(matchesFilter(reading, 'all')).toBe(true);
  });
  it('tag filters match exactly', () => {
    expect(matchesFilter(done, 'tag:Work')).toBe(true);
    expect(matchesFilter(done, 'tag:work')).toBe(false);
    expect(matchesFilter(reading, 'tag:Work')).toBe(false);
  });
});

describe('sorting', () => {
  it('recently read puts opened books first, newest open first, then by added date', () => {
    const a = book({ lastOpenedAt: 10, addedAt: 1 });
    const b = book({ lastOpenedAt: 20, addedAt: 2 });
    const c = book({ lastOpenedAt: null, addedAt: 3 });
    const d = book({ lastOpenedAt: null, addedAt: 4 });
    const ids = [a, b, c, d].sort((x, y) => compareBooks(x, y, 'recent-read')).map((x) => x.id);
    expect(ids).toEqual([b.id, a.id, d.id, c.id]);
  });
  it('title ignores leading articles and sorts numerically', () => {
    const list = [book({ title: 'The Zebra' }), book({ title: 'apple' }), book({ title: 'Part 10' }), book({ title: 'Part 2' })];
    expect(list.sort((x, y) => compareBooks(x, y, 'title')).map((x) => x.title)).toEqual(['apple', 'Part 2', 'Part 10', 'The Zebra']);
  });
  it('author sorts unknown authors last', () => {
    const list = [book({ author: '' , title: 'X'}), book({ author: 'Zola' }), book({ author: 'austen' })];
    expect(list.sort((x, y) => compareBooks(x, y, 'author')).map((x) => x.author)).toEqual(['austen', 'Zola', '']);
  });
  it('progress sorts most-read first', () => {
    const list = [book({ position: 100 }), book({ finishedAt: 1 }), book({ position: 500 })];
    expect(list.sort((x, y) => compareBooks(x, y, 'progress')).map((x) => bookProgress(x))).toEqual([1, 0.5, 0.1]);
  });
  it('selectBooks filters, searches, sorts and does not mutate', () => {
    const input = [book({ title: 'Bee dog', position: 3 }), book({ title: 'Ant dog', position: 3 }), book({ title: 'C cat', position: 3 }), book({ title: 'D dog' })];
    const copy = [...input];
    const out = selectBooks(input, { query: 'dog', filter: 'reading', sort: 'title' });
    expect(out.map((b) => b.title)).toEqual(['Ant dog', 'Bee dog']);
    expect(input).toEqual(copy);
  });
});

describe('tags', () => {
  it('collects unique sorted tags', () => {
    expect(allTags([{ tags: ['b', 'A'] }, { tags: ['A', ' '] }])).toEqual(['A', 'b']);
  });
  it('adds cleaned tags without case-insensitive duplicates', () => {
    expect(addTag(['Work'], '  work ')).toEqual(['Work']);
    expect(addTag(['Work'], '  To   read ')).toEqual(['Work', 'To read']);
    expect(addTag([], '   ')).toEqual([]);
  });
});

describe('continueReading', () => {
  it('picks the most recently opened unfinished book', () => {
    const a = book({ lastOpenedAt: 50, position: 3 });
    const b = book({ lastOpenedAt: 90, finishedAt: 90, position: 1000 });
    const c = book({ lastOpenedAt: 70, position: 9 });
    const d = book({ lastOpenedAt: null });
    expect(continueReading([a, b, c, d])?.id).toBe(c.id);
    expect(continueReading([b, d])).toBeUndefined();
    expect(continueReading([])).toBeUndefined();
  });
});

describe('duplicate detection', () => {
  const existing = [book({ fileName: 'Moby-Dick.txt', fileSize: 1234, title: 'Moby Dick' }), book({ format: 'paste', fileName: 'Note', fileSize: 10 })];
  it('matches same name (case-insensitive) and size', () => {
    expect(findDuplicate({ name: 'moby-dick.TXT', size: 1234 }, existing)?.title).toBe('Moby Dick');
  });
  it('does not match a different size or name', () => {
    expect(findDuplicate({ name: 'Moby-Dick.txt', size: 1235 }, existing)).toBeUndefined();
    expect(findDuplicate({ name: 'Moby.txt', size: 1234 }, existing)).toBeUndefined();
  });
  it('ignores pasted texts and empty names', () => {
    expect(findDuplicate({ name: 'Note', size: 10 }, existing)).toBeUndefined();
    expect(findDuplicate({ name: '', size: 0 }, [book({ fileName: '', fileSize: 0 })])).toBeUndefined();
  });
});

describe('generated cover colours', () => {
  it('hash is stable (FNV-1a reference values)', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
  });
  it('palette is deterministic per seed (the book id)', () => {
    const id = '3f0c2b9e-8f5d-4c1a-9a57-0d7e4b2c6a11';
    expect(coverPalette(id)).toEqual(coverPalette(id));
    expect(coverPalette(id)).not.toEqual(coverPalette('9b1d7a40-2c3e-4f6a-8b5c-1e2d3f4a5b6c'));
  });
  it('different ids spread over hues and stay dark enough for light ink', () => {
    const hues = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const p = coverPalette(`${i.toString(16).padStart(8, '0')}-8f5d-4c1a-9a57-0d7e4b2c6a11`);
      hues.add(Math.floor(p.hue / 30));
      expect(p.hue).toBeGreaterThanOrEqual(0);
      expect(p.hue).toBeLessThan(360);
      const lights = [p.from, p.to].map((c) => Number(/(\d+)%\)$/.exec(c)![1]));
      for (const l of lights) expect(l).toBeLessThanOrEqual(34);
      expect(p.pattern).toBeGreaterThanOrEqual(0);
      expect(p.pattern).toBeLessThan(3);
    }
    expect(hues.size).toBe(12); // every 30° band used
  });
  it('handles an empty seed', () => {
    expect(coverPalette('')).toEqual(coverPalette('untitled'));
  });
});

describe('formatBadge', () => {
  it('shows the real extension when it belongs to the stored format', () => {
    expect(formatBadge({ fileName: 'Report.doc', format: 'docx' })).toBe('DOC');
    expect(formatBadge({ fileName: 'novel.azw3', format: 'mobi' })).toBe('AZW3');
    expect(formatBadge({ fileName: 'a.prc', format: 'mobi' })).toBe('PRC');
    expect(formatBadge({ fileName: 'x.epub', format: 'epub' })).toBe('EPUB');
  });
  it('falls back to the format for mis-named, extension-less and pasted books', () => {
    expect(formatBadge({ fileName: 'book.bin', format: 'pdf' })).toBe('PDF');
    expect(formatBadge({ fileName: 'scan', format: 'pdf' })).toBe('PDF');
    expect(formatBadge({ fileName: 'Vol. 2 final', format: 'epub' })).toBe('EPUB');
    expect(formatBadge({ fileName: 'tale.fb2.zip', format: 'fb2' })).toBe('FB2');
    expect(formatBadge({ fileName: 'Note', format: 'paste' })).toBe('Text');
  });
});

describe('formatList', () => {
  it('joins extensions for messages', () => {
    expect(formatList(['txt'])).toBe('TXT');
    expect(formatList(['pdf', 'epub', 'txt'])).toBe('PDF, EPUB and TXT');
    expect(formatList([])).toBe('');
  });
});
