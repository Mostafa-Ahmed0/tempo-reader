import Dexie, { type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { isValidPageStarts } from './pages';
import { countWords } from './tokenizer';
import { pickSettings, sanitizeSettings, useSettings } from './settings';
import type { Book, BookContent, BookFormat, Bookmark, ParsedBook, ReadingSession } from './types';

export const DB_NAME = 'tempo';

export class TempoDB extends Dexie {
  books!: EntityTable<Book, 'id'>;
  contents!: EntityTable<BookContent, 'bookId'>;
  bookmarks!: EntityTable<Bookmark, 'id'>;
  sessions!: EntityTable<ReadingSession, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      books: 'id, lastOpenedAt, addedAt, title',
      contents: 'bookId',
      bookmarks: 'id, bookId',
      sessions: 'id, bookId, startedAt',
    });
  }
}

/** The app-wide database instance. Prefer the functions below over touching tables directly. */
export const db = new TempoDB();

const newId = (): string => crypto.randomUUID();

function stripExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/** Tokenizes for wordCount, writes book + content in one transaction. */
export async function addBook(parsed: ParsedBook, file: { name: string; size: number; format: BookFormat }): Promise<Book> {
  const sections = parsed.sections.length ? parsed.sections : [{ title: '', text: '' }];
  const wordCount = countWords(sections);
  const book: Book = {
    id: newId(),
    title: parsed.title?.trim() || stripExtension(file.name) || 'Untitled',
    author: parsed.author?.trim() ?? '',
    format: file.format,
    fileName: file.name,
    fileSize: file.size,
    wordCount,
    position: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
    finishedAt: null,
    favorite: false,
    tags: [],
    ...(parsed.cover ? { cover: parsed.cover } : {}),
    // real pages only when they fit this word stream; otherwise the reader estimates them
    ...(isValidPageStarts(parsed.pageStarts, wordCount) ? { pageStarts: parsed.pageStarts } : {}),
  };
  await db.transaction('rw', db.books, db.contents, async () => {
    await db.books.add(book);
    await db.contents.add({ bookId: book.id, sections });
  });
  return book;
}

/** All books, most recently added first. */
export async function listBooks(): Promise<Book[]> {
  return db.books.orderBy('addedAt').reverse().toArray();
}

export async function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id);
}

export async function getContent(bookId: string): Promise<BookContent | undefined> {
  return db.contents.get(bookId);
}

export async function updateBook(id: string, patch: Partial<Omit<Book, 'id'>>): Promise<void> {
  // never allow the primary key to be changed through a loosely-typed patch
  const { id: _ignored, ...rest } = patch as Partial<Book>;
  void _ignored;
  await db.books.update(id, rest);
}

/**
 * Store the reading position (clamped to 0..wordCount) and set lastOpenedAt = now.
 * Sets finishedAt (keeping an earlier value) when position >= wordCount, clears it otherwise.
 * No-op if the book does not exist.
 */
export async function savePosition(id: string, position: number): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(id);
    if (!book) return;
    const now = Date.now();
    const pos = Math.max(0, Math.min(book.wordCount, Math.floor(Number.isFinite(position) ? position : 0)));
    const finished = pos >= book.wordCount;
    await db.books.update(id, {
      position: pos,
      lastOpenedAt: now,
      finishedAt: finished ? (book.finishedAt ?? now) : null,
    });
  });
}

/** Deletes the book and cascades its content, bookmarks and sessions. */
export async function deleteBook(id: string): Promise<void> {
  await db.transaction('rw', [db.books, db.contents, db.bookmarks, db.sessions], async () => {
    await db.books.delete(id);
    await db.contents.delete(id);
    await db.bookmarks.where('bookId').equals(id).delete();
    await db.sessions.where('bookId').equals(id).delete();
  });
}

/**
 * Remove every book, content record, bookmark and reading session (including sessions whose book
 * no longer exists) in one transaction. Settings are not touched.
 */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.books, db.contents, db.bookmarks, db.sessions], async () => {
    await Promise.all([db.books.clear(), db.contents.clear(), db.bookmarks.clear(), db.sessions.clear()]);
  });
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export async function addBookmark(b: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark> {
  const bookmark: Bookmark = { ...b, id: newId(), createdAt: Date.now() };
  await db.bookmarks.add(bookmark);
  return bookmark;
}

/** Bookmarks of a book, sorted by position (then creation time). */
export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const list = await db.bookmarks.where('bookId').equals(bookId).toArray();
  return list.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}

// ---------------------------------------------------------------------------
// Reading sessions
// ---------------------------------------------------------------------------

export async function addSession(s: Omit<ReadingSession, 'id'>): Promise<void> {
  await db.sessions.add({ ...s, id: newId() });
}

/** Sessions with startedAt >= sinceMs (all if omitted), oldest first. */
export async function listSessions(sinceMs?: number): Promise<ReadingSession[]> {
  if (sinceMs === undefined) return db.sessions.orderBy('startedAt').toArray();
  return db.sessions.where('startedAt').aboveOrEqual(sinceMs).toArray();
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export const BACKUP_FORMAT = 'tempo-backup';
export const BACKUP_VERSION = 1;

type SerializedBook = Omit<Book, 'cover'> & { cover?: { type: string; base64: string } };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  settings: Record<string, unknown>;
  books: SerializedBook[];
  contents: BookContent[];
  bookmarks: Bookmark[];
  sessions: ReadingSession[];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** JSON blob with books, contents, bookmarks, sessions and settings; cover blobs as base64. */
export async function exportBackup(): Promise<Blob> {
  const [books, contents, bookmarks, sessions] = await db.transaction('r', [db.books, db.contents, db.bookmarks, db.sessions], () =>
    Promise.all([db.books.toArray(), db.contents.toArray(), db.bookmarks.toArray(), db.sessions.toArray()]),
  );
  const serializedBooks: SerializedBook[] = [];
  for (const { cover, ...rest } of books) {
    serializedBooks.push(cover ? { ...rest, cover: { type: cover.type, base64: await blobToBase64(cover) } } : rest);
  }
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: { ...pickSettings(useSettings.getState()) },
    books: serializedBooks,
    contents,
    bookmarks,
    sessions,
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/**
 * Merge a backup into the database by id (existing records with the same id are overwritten,
 * others are kept). Settings from the backup are applied over the current settings.
 * Throws an Error if the file is not a Tempo backup.
 */
export async function importBackup(file: Blob): Promise<{ books: number }> {
  let data: Partial<BackupFile>;
  try {
    data = JSON.parse(await file.text()) as Partial<BackupFile>;
  } catch {
    throw new Error('Backup file is not valid JSON');
  }
  if (!data || data.format !== BACKUP_FORMAT || typeof data.version !== 'number') {
    throw new Error('Not a Tempo backup file');
  }
  if (data.version > BACKUP_VERSION) throw new Error(`Backup version ${data.version} is newer than this app supports`);
  const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

  const books: Book[] = arr(data.books).map(({ cover, ...rest }) =>
    cover && typeof cover.base64 === 'string' ? { ...rest, cover: base64ToBlob(cover.base64, cover.type ?? '') } : rest,
  );
  await db.transaction('rw', [db.books, db.contents, db.bookmarks, db.sessions], async () => {
    await db.books.bulkPut(books);
    await db.contents.bulkPut(arr(data.contents));
    await db.bookmarks.bulkPut(arr(data.bookmarks));
    await db.sessions.bulkPut(arr(data.sessions));
  });
  if (data.settings) useSettings.getState().set(sanitizeSettings(data.settings));
  return { books: books.length };
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

/** Live list of books (same order as listBooks); undefined while the first query is loading. */
export function useLiveBooks(): Book[] | undefined {
  return useLiveQuery(() => listBooks(), []);
}
