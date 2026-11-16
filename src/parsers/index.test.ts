import { describe, expect, it } from 'vitest';
import { ACCEPT_ATTR, ParseError, detectFormat, parseFile, parsePastedText, SUPPORTED_EXTENSIONS, UnsupportedFormatError } from './index';

describe('parsers public API', () => {
  it('advertises extensions and MIME types', () => {
    for (const e of ['txt', 'md', 'pdf', 'epub', 'mobi', 'azw3', 'docx', 'doc', 'odt', 'rtf', 'fb2', 'html']) expect(SUPPORTED_EXTENSIONS).toContain(e);
    for (const a of ['.txt', '.pdf', '.epub', '.azw3', 'application/pdf', 'application/epub+zip', 'application/octet-stream', 'text/plain']) {
      expect(ACCEPT_ATTR.split(',')).toContain(a);
    }
  });

  it('detects formats by extension, then MIME type', () => {
    expect(detectFormat(new File(['x'], 'Book.TXT'))).toBe('txt');
    expect(detectFormat(new File(['x'], 'book.pdf'))).toBe('pdf');
    expect(detectFormat(new File(['x'], 'book.azw3'))).toBe('mobi');
    expect(detectFormat(new File(['x'], 'old.doc'))).toBe('docx');
    expect(detectFormat(new File(['x'], 'b.fb2.zip'))).toBe('fb2');
    expect(detectFormat(new File(['x'], 'page.xhtml'))).toBe('html');
    expect(detectFormat(new File(['x'], 'noext', { type: 'application/epub+zip' }))).toBe('epub');
    expect(detectFormat(new File(['x'], 'sheet.xlsx'))).toBeNull();
  });

  it('parses a txt file into one section with paragraphs', async () => {
    const progress: number[] = [];
    const book = await parseFile(new File(['Line one\r\n\r\n\r\nLine two'], 'my_story.txt', { type: 'text/plain' }), (f) => progress.push(f));
    expect(book.title).toBe('my story');
    expect(book.sections).toEqual([{ title: 'my story', text: 'Line one\n\nLine two' }]);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it('throws UnsupportedFormatError (a ParseError) for unknown binary formats', async () => {
    const err = await parseFile(new File([new Uint8Array([0, 1, 2, 0, 255])], 'a.xyz')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedFormatError);
    expect(err).toBeInstanceOf(ParseError);
    expect((err as Error).message).toMatch(/Supported:/);
  });

  it('parsePastedText derives a title', () => {
    expect(parsePastedText('Hello there\n\nMore').title).toBe('Hello there');
    expect(parsePastedText('x', 'Given').title).toBe('Given');
    expect(parsePastedText('   ').title).toBe('Pasted text');
  });
});
