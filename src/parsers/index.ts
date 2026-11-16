/**
 * Public parser API. The library screen codes against these names/signatures.
 * Heavy format readers (pdf.js, jszip, mammoth, ...) are loaded with dynamic import() per format.
 */
import type { BookFormat, ParsedBook, ParsedSection } from '../core/types';
import { latin1, looksBinary } from './encoding';
import { ParseError, UnsupportedFormatError, tooLarge } from './errors';
import { parseMarkdownBytes, parsePasted, parseTxtBytes } from './txt';
import { listZipEntries } from './zip';

export { ParseError, UnsupportedFormatError } from './errors';
export type { ParseErrorCode } from './errors';

/** Internal routing: more specific than BookFormat (.doc vs .docx, .fb2.zip vs .fb2). */
export type ParserKind = 'txt' | 'md' | 'pdf' | 'epub' | 'mobi' | 'docx' | 'doc' | 'odt' | 'rtf' | 'fb2' | 'fb2zip' | 'html';

const EXT_KIND: Record<string, ParserKind> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  pdf: 'pdf',
  epub: 'epub',
  mobi: 'mobi',
  azw: 'mobi',
  azw3: 'mobi',
  kf8: 'mobi',
  prc: 'mobi',
  pdb: 'mobi',
  docx: 'docx',
  doc: 'doc',
  odt: 'odt',
  rtf: 'rtf',
  fb2: 'fb2',
  'fb2.zip': 'fb2zip',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  xht: 'html',
};

const KIND_FORMAT: Record<ParserKind, BookFormat> = {
  txt: 'txt',
  md: 'md',
  pdf: 'pdf',
  epub: 'epub',
  mobi: 'mobi',
  docx: 'docx',
  doc: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  fb2: 'fb2',
  fb2zip: 'fb2',
  html: 'html',
};

/** Lower-case extensions without the dot. */
export const SUPPORTED_EXTENSIONS: string[] = Object.keys(EXT_KIND);

const MIME_KIND: Record<string, ParserKind> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'mobi',
  'application/vnd.amazon.mobi8-ebook': 'mobi',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/x-fictionbook+xml': 'fb2',
  'application/x-fictionbook': 'fb2',
  'text/fb2+xml': 'fb2',
  'application/x-zip-compressed-fb2': 'fb2zip',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
};

/**
 * For <input type="file" accept={ACCEPT_ATTR}>. Extensions for desktop pickers plus MIME types for
 * Android's picker. application/octet-stream and application/zip are included on purpose: Android
 * reports .mobi/.azw3/.fb2 (no registered MIME type) as octet-stream and .fb2.zip as zip, and would
 * grey them out otherwise. Wrong files picked that way get a clear error from parseFile.
 */
export const ACCEPT_ATTR: string = [
  ...SUPPORTED_EXTENSIONS.map((e) => `.${e}`),
  ...Object.keys(MIME_KIND),
  'application/zip',
  'application/octet-stream',
].join(',');

/** Largest file we try to open at all (phones). */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Largest plain-text-like file (txt/md/html/rtf/fb2). */
export const MAX_TEXT_FILE_BYTES = 128 * 1024 * 1024;

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.fb2.zip')) return 'fb2.zip';
  const i = lower.lastIndexOf('.');
  return i >= 0 ? lower.slice(i + 1) : '';
}

function kindFromName(file: { name: string; type?: string }): ParserKind | null {
  const ext = extensionOf(file.name);
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  const mime = (file.type ?? '').toLowerCase().split(';')[0].trim();
  return MIME_KIND[mime] ?? null;
}

/** Format from extension (falling back to MIME type), or null if not supported. Synchronous: no content sniffing. */
export function detectFormat(file: File): BookFormat | null {
  const k = kindFromName(file);
  return k ? KIND_FORMAT[k] : null;
}

/**
 * Content sniffing from the first/last bytes. Returns the kind when the bytes clearly identify a
 * binary format, 'zip' for other archives, or null (text, or unknown).
 */
export function sniffKind(bytes: Uint8Array): ParserKind | 'zip' | 'ole-other' | null {
  const head = latin1(bytes, 0, Math.min(bytes.length, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (/^(?:\uFEFF|\u00EF\u00BB\u00BF)?\s*\{\\rtf/.test(head)) return 'rtf';
  if (bytes.length >= 68) {
    const tc = latin1(bytes, 60, 68);
    if (tc === 'BOOKMOBI' || tc === 'TEXtREAd') return 'mobi';
  }
  if (head.startsWith('\u00EADRMION\u00EE') || head.startsWith('CONT')) return 'mobi'; // KFX: mobi parser reports it
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'doc';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) {
    // EPUB/ODT: first entry "mimetype", stored uncompressed.
    if (latin1(bytes, 30, 38) === 'mimetype') {
      const mt = latin1(bytes, 38, Math.min(bytes.length, 38 + 80));
      if (mt.startsWith('application/epub+zip')) return 'epub';
      if (mt.startsWith('application/vnd.oasis.opendocument.text')) return 'odt';
    }
    let names: string[] = [];
    try {
      names = (listZipEntries(bytes) ?? []).map((e) => e.name);
    } catch {
      names = [];
    }
    const has = (re: RegExp) => names.some((n) => re.test(n));
    if (has(/^META-INF\/container\.xml$/i) || has(/\.opf$/i)) return 'epub';
    if (has(/^word\/document\d*\.xml$/i)) return 'docx';
    if (has(/^content\.xml$/) && has(/^meta\.xml$|^styles\.xml$/)) return 'odt';
    if (has(/\.fb2$/i)) return 'fb2zip';
    return 'zip';
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  // Text-based formats, recognisable from the first KB (also UTF-16: strip NULs).
  const text = head.replace(/\u0000/g, '');
  if (/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00FF\u00FE|\u00FE\u00FF)?\s*(?:<\?xml[^>]*>\s*)?<FictionBook\b/i.test(text)) return 'fb2';
  return null;
}

function kindFromText(bytes: Uint8Array): ParserKind {
  const head = latin1(bytes, 0, Math.min(bytes.length, 1024)).replace(/\u0000/g, '');
  if (/<FictionBook\b/i.test(head)) return 'fb2';
  if (/^\s*(?:\u00EF\u00BB\u00BF)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+html|<html\b)/i.test(head)) return 'html';
  return 'txt';
}

const BINARY_KINDS = new Set<ParserKind>(['pdf', 'epub', 'mobi', 'docx', 'doc', 'odt', 'fb2zip']);
const NAMES: Record<ParserKind, string> = {
  txt: 'text',
  md: 'Markdown',
  pdf: 'PDF',
  epub: 'EPUB',
  mobi: 'Kindle',
  docx: 'Word',
  doc: 'Word',
  odt: 'OpenDocument',
  rtf: 'RTF',
  fb2: 'FB2',
  fb2zip: 'FB2',
  html: 'HTML',
};

/** Decide which reader to use: magic bytes win over the extension (mis-named files). */
export function resolveKind(file: { name: string; type?: string }, bytes: Uint8Array): ParserKind {
  const byName = kindFromName(file);
  const sniffed = sniffKind(bytes);
  if (sniffed === 'ole-other') throw new UnsupportedFormatError('This Office file type is not supported. Save it as .docx, PDF or plain text.');
  if (sniffed === 'zip') {
    if (byName === 'epub' || byName === 'docx' || byName === 'odt' || byName === 'fb2zip') return byName; // parser explains
    throw new UnsupportedFormatError('This is a zip archive Tempo cannot read. Unzip it and open the book inside.');
  }
  if (sniffed) {
    // A .md/.txt that happens to start with "{\rtf" etc. is still that format; trust the bytes.
    return sniffed;
  }
  if (byName && BINARY_KINDS.has(byName)) return byName; // e.g. truncated PDF: the PDF reader reports it
  if (looksBinary(bytes)) {
    throw new UnsupportedFormatError(`Tempo can't read this kind of file (${file.name}). Supported: PDF, EPUB, MOBI/AZW3, DOCX, DOC, ODT, RTF, FB2, HTML, TXT, Markdown.`);
  }
  if (byName) return byName;
  return kindFromText(bytes);
}

/** Like detectFormat, but also looks at the file's bytes (magic numbers), so mis-named files are recognised. */
export async function detectFormatAsync(file: File): Promise<BookFormat | null> {
  const headBytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  let bytes = headBytes;
  if (headBytes[0] === 0x50 && headBytes[1] === 0x4b) bytes = new Uint8Array(await file.arrayBuffer()); // zip: need the central directory
  try {
    return KIND_FORMAT[resolveKind(file, bytes)];
  } catch {
    return null;
  }
}

async function dispatch(kind: ParserKind, bytes: Uint8Array, name: string, onProgress?: (f: number) => void): Promise<ParsedBook> {
  switch (kind) {
    case 'txt':
      return parseTxtBytes(bytes, name);
    case 'md':
      return parseMarkdownBytes(bytes, name);
    case 'pdf':
      return (await import('./pdf')).parsePdfBytes(bytes, name, onProgress);
    case 'epub':
      return (await import('./epub')).parseEpubBytes(bytes, name, onProgress);
    case 'mobi':
      return (await import('./mobi')).parseMobiBytes(bytes, name, onProgress);
    case 'docx':
      return (await import('./docx')).parseDocxBytes(bytes, name);
    case 'doc':
      return (await import('./doc')).parseDocBytes(bytes, name);
    case 'odt':
      return (await import('./odt')).parseOdtBytes(bytes, name);
    case 'rtf':
      return (await import('./rtf')).parseRtfBytes(bytes, name);
    case 'fb2':
      return (await import('./fb2')).parseFb2Bytes(bytes, name);
    case 'fb2zip':
      return (await import('./fb2')).parseFb2ZipBytes(bytes, name);
    case 'html':
      return (await import('./htmlFile')).parseHtmlBytes(bytes, name);
  }
}

/** Final clean-up: trimmed text, no empty sections, at least one section, non-empty titles. */
function finalize(book: ParsedBook, kind: ParserKind): ParsedBook {
  const sections: ParsedSection[] = book.sections
    .map((s) => ({ title: s.title.replace(/\s+/g, ' ').trim(), text: s.text.replace(/\n{3,}/g, '\n\n').trim() }))
    .filter((s) => s.text);
  if (!sections.length) throw new ParseError('empty', `No readable text was found in this ${NAMES[kind]} file.`);
  sections.forEach((s, i) => {
    if (!s.title) s.title = sections.length === 1 ? book.title : `Section ${i + 1}`;
  });
  return {
    title: book.title.replace(/\s+/g, ' ').trim() || 'Untitled',
    author: book.author?.replace(/\s+/g, ' ').trim() || undefined,
    cover: book.cover,
    sections,
    // trimming and dropping empty sections does not change the token stream, so page starts stay valid
    ...(book.pageStarts ? { pageStarts: book.pageStarts } : {}),
  };
}

/** Parse a file into plain-text sections. Throws ParseError (UnsupportedFormatError for unknown formats). */
export async function parseFile(file: File, onProgress?: (fraction: number) => void): Promise<ParsedBook> {
  onProgress?.(0);
  if (file.size === 0) throw new ParseError('empty', 'This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw tooLarge(`This file is ${Math.round(file.size / 1048576)} MB, too large to open on this device.`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    throw new ParseError('corrupt', 'The file could not be read. Check that it is still available and try again.', { cause: e });
  }
  const kind = resolveKind(file, bytes);
  if (!BINARY_KINDS.has(kind) && bytes.length > MAX_TEXT_FILE_BYTES) throw tooLarge('This text file is too large to open.');
  let book: ParsedBook;
  try {
    book = await dispatch(kind, bytes, file.name, onProgress ? (f) => onProgress(Math.min(0.99, Math.max(0, f))) : undefined);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    if (e instanceof RangeError && /memory|allocation|Array buffer/i.test(e.message)) {
      throw tooLarge('This book is too large for the memory available.');
    }
    throw new ParseError('corrupt', `This ${NAMES[kind]} file could not be read; it may be damaged. Try re-downloading or re-exporting it.`, { cause: e });
  }
  const out = finalize(book, kind);
  onProgress?.(1);
  return out;
}

/** Wrap pasted text as a book (same paragraph/chapter logic as .txt). Title defaults to the first few words. */
export function parsePastedText(text: string, title?: string): ParsedBook {
  const book = parsePasted(text, title);
  const sections = book.sections
    .map((s) => ({ title: s.title, text: s.text.trim() }))
    .filter((s, i, all) => s.text || (i === 0 && all.every((x) => !x.text.trim())));
  return { title: book.title, sections: sections.length ? sections : [{ title: book.title, text: '' }] };
}
