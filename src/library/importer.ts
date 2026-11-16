/**
 * Import queue (module-level zustand store, so an import keeps running and stays visible
 * if the user switches tabs). Files are processed one at a time; one failure never stops the rest.
 * The parsers module is loaded lazily the first time it is needed.
 */
import { create } from 'zustand';
import { addBook, listBooks } from '../core/db';
import type { Book } from '../core/types';
import { findDuplicate, formatList } from './logic';

type ParsersModule = typeof import('../parsers');
let parsersPromise: Promise<ParsersModule> | null = null;

/** Memoised dynamic import of src/parsers (safe to call on hover/focus to prefetch). */
export function loadParsers(): Promise<ParsersModule> {
  if (!parsersPromise) {
    parsersPromise = import('../parsers').catch((err) => {
      parsersPromise = null; // allow a retry after e.g. a network hiccup
      throw err;
    });
  }
  return parsersPromise;
}

export type ImportStatus = 'queued' | 'parsing' | 'saving' | 'done' | 'failed';

export interface ImportItem {
  id: number;
  name: string;
  size: number;
  status: ImportStatus;
  progress: number; // 0..1
  error?: string;
  warning?: string;
  bookId?: string;
  title?: string;
}

interface ImportState {
  items: ImportItem[];
  running: boolean;
  enqueue: (files: File[], onFinished?: (added: Book[]) => void) => void;
  clearFinished: () => void;
}

let nextId = 1;
const pending: { id: number; file: File; onFinished?: (added: Book[]) => void; batch: number }[] = [];
const batchAdded = new Map<number, Book[]>();
const batchRemaining = new Map<number, number>();
let nextBatch = 1;

/**
 * Message for a failed import: the parser's human-readable message as-is; for an 'unsupported'
 * ParseError the list of supported types is appended (unless the message already lists them).
 */
export function importErrorMessage(err: unknown, supported?: readonly string[]): string {
  let msg = 'Could not read this file.';
  if (err instanceof Error && err.message) msg = err.message;
  else if (typeof err === 'string' && err) msg = err;
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
  if (code === 'unsupported' && supported?.length && !/supported:/i.test(msg)) {
    msg = `${msg.replace(/\.?\s*$/, '.')} Supported: ${formatList(supported)}.`;
  }
  return msg;
}

export const useImports = create<ImportState>()((set, get) => {
  const patch = (id: number, p: Partial<ImportItem>) =>
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));

  async function run() {
    if (get().running) return;
    set({ running: true });
    try {
      while (pending.length) {
        const job = pending.shift()!;
        const { id, file, batch } = job;
        let parsers: ParsersModule | undefined;
        try {
          patch(id, { status: 'parsing', progress: 0 });
          parsers = await loadParsers();
          const existing = await listBooks();
          const dup = findDuplicate(file, existing);
          const warnings: string[] = [];
          if (dup) {
            warnings.push(`Possible duplicate of "${dup.title}" (same file name and size). Imported anyway.`);
            patch(id, { warning: warnings.join(' ') });
          }

          let last = 0;
          const parsed = await parsers.parseFile(file, (fraction) => {
            const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
            // throttle re-renders: only publish visible steps
            if (f === 1 || f - last >= 0.02) {
              last = f;
              patch(id, { progress: f });
            }
          });
          patch(id, { status: 'saving', progress: 1 });
          // parseFile sniffs the bytes itself; detect again (also by content) only to record the format,
          // so a PDF named "book.bin" or with no extension is stored as a PDF.
          const format = (await parsers.detectFormatAsync(file)) ?? parsers.detectFormat(file) ?? 'txt';
          const book = await addBook(parsed, { name: file.name, size: file.size, format });
          if (book.wordCount === 0) {
            warnings.push('No readable text was found in this file.');
            patch(id, { warning: warnings.join(' ') });
          }
          patch(id, { status: 'done', bookId: book.id, title: book.title });
          batchAdded.get(batch)?.push(book);
        } catch (err) {
          patch(id, { status: 'failed', error: importErrorMessage(err, parsers?.SUPPORTED_EXTENSIONS) });
        } finally {
          const left = (batchRemaining.get(batch) ?? 1) - 1;
          batchRemaining.set(batch, left);
          if (left <= 0) {
            const added = batchAdded.get(batch) ?? [];
            batchAdded.delete(batch);
            batchRemaining.delete(batch);
            job.onFinished?.(added);
          }
        }
      }
    } finally {
      set({ running: false });
    }
  }

  return {
    items: [],
    running: false,
    enqueue(files, onFinished) {
      if (!files.length) return;
      const batch = nextBatch++;
      batchAdded.set(batch, []);
      batchRemaining.set(batch, files.length);
      const fresh: ImportItem[] = files.map((f) => {
        const id = nextId++;
        pending.push({ id, file: f, onFinished, batch });
        return { id, name: f.name, size: f.size, status: 'queued', progress: 0 };
      });
      set((s) => ({ items: [...s.items, ...fresh] }));
      void run();
    },
    clearFinished() {
      set((s) => ({ items: s.items.filter((it) => it.status !== 'done' && it.status !== 'failed') }));
    },
  };
});

/** Test helper: reset module state. */
export function __resetImportsForTests(): void {
  pending.length = 0;
  batchAdded.clear();
  batchRemaining.clear();
  useImports.setState({ items: [], running: false });
}
