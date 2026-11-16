// @vitest-environment node
// Node env: jsdom's Blob cannot survive structuredClone in fake-indexeddb, Node's native Blob can.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBook,
  addBookmark,
  addSession,
  clearAllData,
  db,
  deleteBook,
  deleteBookmark,
  exportBackup,
  getBook,
  getContent,
  importBackup,
  listBookmarks,
  listBooks,
  listSessions,
  savePosition,
  updateBook,
} from './db';
import { DEFAULT_SETTINGS, useSettings } from './settings';
import type { ParsedBook } from './types';

const sample = (title = 'Sample'): ParsedBook => ({
  title,
  author: ' Jane Doe ',
  sections: [
    { title: 'One', text: 'Alpha beta gamma.\n\nDelta epsilon.' },
    { title: 'Two', text: 'Zeta eta theta iota.' },
  ],
});
const file = { name: 'sample.txt', size: 123, format: 'txt' as const };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  useSettings.getState().reset();
});

describe('books', () => {
  it('addBook writes book + content and counts words', async () => {
    const book = await addBook(sample(), file);
    expect(book.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(book).toMatchObject({
      title: 'Sample',
      author: 'Jane Doe',
      format: 'txt',
      fileName: 'sample.txt',
      fileSize: 123,
      wordCount: 9,
      position: 0,
      lastOpenedAt: null,
      finishedAt: null,
      favorite: false,
      tags: [],
    });
    expect(await getBook(book.id)).toEqual(book);
    const content = await getContent(book.id);
    expect(content?.sections).toHaveLength(2);
  });

  it('falls back to the file name when the title is empty and author to ""', async () => {
    const book = await addBook({ title: '  ', sections: [{ title: '', text: 'x' }] }, { name: 'my.book.epub', size: 1, format: 'epub' });
    expect(book.title).toBe('my.book');
    expect(book.author).toBe('');
  });

  it('listBooks returns newest first', async () => {
    const a = await addBook(sample('A'), file);
    await updateBook(a.id, { addedAt: 1000 });
    const b = await addBook(sample('B'), file);
    await updateBook(b.id, { addedAt: 2000 });
    expect((await listBooks()).map((x) => x.title)).toEqual(['B', 'A']);
  });

  it('updateBook patches fields', async () => {
    const book = await addBook(sample(), file);
    await updateBook(book.id, { favorite: true, tags: ['sci-fi'], title: 'Renamed' });
    expect(await getBook(book.id)).toMatchObject({ favorite: true, tags: ['sci-fi'], title: 'Renamed' });
  });

  it('savePosition sets lastOpenedAt and finishedAt, clamping the position', async () => {
    const book = await addBook(sample(), file);
    await savePosition(book.id, 4);
    let b = await getBook(book.id);
    expect(b?.position).toBe(4);
    expect(b?.lastOpenedAt).toBeTypeOf('number');
    expect(b?.finishedAt).toBeNull();

    await savePosition(book.id, 999);
    b = await getBook(book.id);
    expect(b?.position).toBe(9);
    expect(b?.finishedAt).toBeTypeOf('number');

    await savePosition(book.id, -5);
    b = await getBook(book.id);
    expect(b?.position).toBe(0);
    expect(b?.finishedAt).toBeNull();
  });

  it('savePosition on a missing book is a no-op', async () => {
    await expect(savePosition('nope', 3)).resolves.toBeUndefined();
  });

  it('deleteBook cascades content, bookmarks and sessions', async () => {
    const keep = await addBook(sample('Keep'), file);
    const gone = await addBook(sample('Gone'), file);
    await addBookmark({ bookId: gone.id, position: 1, excerpt: 'beta', note: '' });
    await addBookmark({ bookId: keep.id, position: 1, excerpt: 'beta', note: '' });
    await addSession({ bookId: gone.id, startedAt: 1, durationMs: 1000, wordsRead: 5, avgWpm: 300 });
    await addSession({ bookId: keep.id, startedAt: 2, durationMs: 1000, wordsRead: 5, avgWpm: 300 });

    await deleteBook(gone.id);
    expect(await getBook(gone.id)).toBeUndefined();
    expect(await getContent(gone.id)).toBeUndefined();
    expect(await listBookmarks(gone.id)).toEqual([]);
    expect((await listSessions()).map((s) => s.bookId)).toEqual([keep.id]);
    expect(await listBookmarks(keep.id)).toHaveLength(1);
    expect(await getContent(keep.id)).toBeDefined();
  });
});

describe('bookmarks', () => {
  it('adds, lists sorted by position and deletes', async () => {
    const book = await addBook(sample(), file);
    const b2 = await addBookmark({ bookId: book.id, position: 7, excerpt: 'theta', note: 'n' });
    const b1 = await addBookmark({ bookId: book.id, position: 2, excerpt: 'gamma', note: '' });
    expect(b1.id).not.toBe(b2.id);
    expect(b1.createdAt).toBeTypeOf('number');
    expect((await listBookmarks(book.id)).map((b) => b.position)).toEqual([2, 7]);
    await deleteBookmark(b1.id);
    expect((await listBookmarks(book.id)).map((b) => b.id)).toEqual([b2.id]);
  });
});

describe('sessions', () => {
  it('lists all sessions or those since a timestamp, oldest first', async () => {
    await addSession({ bookId: 'x', startedAt: 300, durationMs: 1, wordsRead: 1, avgWpm: 1 });
    await addSession({ bookId: 'x', startedAt: 100, durationMs: 1, wordsRead: 1, avgWpm: 1 });
    await addSession({ bookId: 'x', startedAt: 200, durationMs: 1, wordsRead: 1, avgWpm: 1 });
    expect((await listSessions()).map((s) => s.startedAt)).toEqual([100, 200, 300]);
    expect((await listSessions(200)).map((s) => s.startedAt)).toEqual([200, 300]);
  });
});

describe('backup', () => {
  it('round-trips books, contents, bookmarks, sessions, settings and covers', async () => {
    const cover = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2])], { type: 'image/png' });
    const book = await addBook({ ...sample(), cover }, file);
    await addBookmark({ bookId: book.id, position: 3, excerpt: 'delta', note: 'hi' });
    await addSession({ bookId: book.id, startedAt: 5, durationMs: 60000, wordsRead: 300, avgWpm: 300 });
    useSettings.getState().set({ wpm: 555, theme: 'sepia' });

    const blob = await exportBackup();
    const json = JSON.parse(await blob.text());
    expect(json.format).toBe('tempo-backup');
    expect(json.books[0].cover).toEqual({ type: 'image/png', base64: expect.any(String) });
    expect(json.settings.wpm).toBe(555);

    await Promise.all(db.tables.map((t) => t.clear()));
    useSettings.getState().reset();

    const result = await importBackup(blob);
    expect(result).toEqual({ books: 1 });
    const restored = await getBook(book.id);
    expect(restored?.title).toBe('Sample');
    expect(restored?.cover?.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await restored!.cover!.arrayBuffer()))).toEqual([137, 80, 78, 71, 0, 255, 1, 2]);
    expect((await getContent(book.id))?.sections).toHaveLength(2);
    expect(await listBookmarks(book.id)).toHaveLength(1);
    expect(await listSessions()).toHaveLength(1);
    expect(useSettings.getState().wpm).toBe(555);
    expect(useSettings.getState().theme).toBe('sepia');
  });

  it('merges by id without removing existing records', async () => {
    const a = await addBook(sample('A'), file);
    const backup = await exportBackup();
    await updateBook(a.id, { title: 'A changed' });
    const b = await addBook(sample('B'), file);
    await importBackup(backup);
    expect((await getBook(a.id))?.title).toBe('A');
    expect(await getBook(b.id)).toBeDefined();
  });

  it('rejects files that are not Tempo backups', async () => {
    await expect(importBackup(new Blob(['not json']))).rejects.toThrow(/JSON/);
    await expect(importBackup(new Blob([JSON.stringify({ hello: 1 })]))).rejects.toThrow(/Tempo backup/);
    expect(useSettings.getState().wpm).toBe(DEFAULT_SETTINGS.wpm);
  });
});

describe('clearAllData', () => {
  it('removes books, contents, bookmarks and all sessions, including orphans, and keeps settings', async () => {
    const a = await addBook(sample('A'), file);
    await addBook(sample('B'), file);
    await addBookmark({ bookId: a.id, position: 1, excerpt: 'x', note: '' });
    await addSession({ bookId: a.id, startedAt: 1, durationMs: 1000, wordsRead: 5, avgWpm: 300 });
    await addSession({ bookId: 'no-such-book', startedAt: 2, durationMs: 1000, wordsRead: 5, avgWpm: 300 });
    useSettings.getState().set({ wpm: 420 });
    await clearAllData();
    expect(await listBooks()).toEqual([]);
    expect(await db.contents.count()).toBe(0);
    expect(await db.bookmarks.count()).toBe(0);
    expect(await listSessions()).toEqual([]);
    expect(useSettings.getState().wpm).toBe(420);
  });
  it('is a no-op on an empty database', async () => {
    await expect(clearAllData()).resolves.toBeUndefined();
  });
});
