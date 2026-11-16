import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, listBooks } from '../core/db';
import type { Book } from '../core/types';
import { __resetImportsForTests, importErrorMessage, useImports } from './importer';

// Parser contract mock (mirrors src/parsers): parseFile sniffs content itself; errors carry a `code`.
const { MockParseError, isPdf } = vi.hoisted(() => {
  class MockParseError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  const isPdf = async (f: File) => (await f.slice(0, 5).text()) === '%PDF-';
  return { MockParseError, isPdf };
});
vi.mock('../parsers', () => ({
  SUPPORTED_EXTENSIONS: ['txt', 'pdf'],
  ACCEPT_ATTR: '.txt,.pdf',
  // extension-only (the old, too-strict check): knows nothing about "book.bin"
  detectFormat: (f: File) => (f.name.endsWith('.txt') ? 'txt' : f.name.endsWith('.pdf') ? 'pdf' : null),
  detectFormatAsync: async (f: File) => ((await isPdf(f)) ? 'pdf' : f.name.endsWith('.txt') || f.name.endsWith('.bad') ? 'txt' : null),
  parseFile: async (f: File, onProgress?: (x: number) => void) => {
    onProgress?.(0.5);
    if (f.name.endsWith('.bad')) throw new MockParseError('corrupt', 'This file is damaged.');
    if (f.name.endsWith('.locked')) throw new MockParseError('drm', 'This book is copy-protected (DRM).');
    if (!(await isPdf(f)) && !f.name.endsWith('.txt')) throw new MockParseError('unsupported', `Tempo can't read this kind of file (${f.name})`);
    onProgress?.(1);
    return { title: f.name.replace(/\.\w+$/, ''), sections: [{ title: '', text: 'one two three' }] };
  },
  parsePastedText: (text: string, title?: string) => ({ title: title ?? 'Pasted', sections: [{ title: '', text }] }),
}));

function waitForBatch(files: File[]): Promise<Book[]> {
  return new Promise((resolve) => useImports.getState().enqueue(files, resolve));
}

beforeEach(async () => {
  __resetImportsForTests();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('import queue', () => {
  it('keeps going after a failure and reports each file with the parser message', async () => {
    const files = [
      new File(['x'], 'first.txt', { type: 'text/plain' }),
      new File(['x'], 'broken.bad'),
      new File(['x'], 'photo.png', { type: 'image/png' }),
      new File(['x'], 'shop.locked'),
      new File(['x'], 'last.txt', { type: 'text/plain' }),
    ];
    const added = await waitForBatch(files);
    expect(added.map((b) => b.title)).toEqual(['first', 'last']);
    const items = useImports.getState().items;
    expect(items.map((i) => i.status)).toEqual(['done', 'failed', 'failed', 'failed', 'done']);
    expect(items[1].error).toBe('This file is damaged.');
    // 'unsupported' gets the supported list appended
    expect(items[2].error).toBe("Tempo can't read this kind of file (photo.png). Supported: TXT and PDF.");
    // other codes are shown as-is
    expect(items[3].error).toBe('This book is copy-protected (DRM).');
    expect((await listBooks()).length).toBe(2);
    expect(useImports.getState().running).toBe(false);
  });

  it('imports a mis-named PDF and records the sniffed format', async () => {
    const [book] = await waitForBatch([new File(['%PDF-1.7 ...'], 'book.bin')]);
    expect(book.format).toBe('pdf');
    const [noExt] = await waitForBatch([new File(['%PDF-1.4'], 'scan')]);
    expect(noExt.format).toBe('pdf');
  });

  it('warns about a likely duplicate but still imports it', async () => {
    await waitForBatch([new File(['abc'], 'same.txt')]);
    await waitForBatch([new File(['abc'], 'same.txt')]);
    const items = useImports.getState().items;
    expect(items[0].warning).toBeUndefined();
    expect(items[1].status).toBe('done');
    expect(items[1].warning).toMatch(/duplicate of "same"/);
    expect((await listBooks()).length).toBe(2);
  });

  it('clearFinished removes finished rows', async () => {
    await waitForBatch([new File(['abc'], 'a.txt')]);
    useImports.getState().clearFinished();
    expect(useImports.getState().items).toEqual([]);
  });
});

describe('importErrorMessage', () => {
  it('does not append the list twice', () => {
    const e = Object.assign(new Error("Can't read this. Supported: PDF, EPUB."), { code: 'unsupported' });
    expect(importErrorMessage(e, ['pdf'])).toBe("Can't read this. Supported: PDF, EPUB.");
  });
  it('falls back for non-errors', () => {
    expect(importErrorMessage(undefined)).toBe('Could not read this file.');
    expect(importErrorMessage('boom')).toBe('boom');
  });
});
