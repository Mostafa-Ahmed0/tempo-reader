/**
 * The one list of file types Tempo reads. The parser routing (src/parsers/index.ts: extension table,
 * file-picker accept list, "Supported: ..." error text) and the library's "supported file types"
 * display are all derived from FORMAT_FAMILIES. Tiny and dependency-free on purpose, so the library
 * can show it without loading the parsers chunk.
 */

/** Internal routing: more specific than BookFormat (.doc vs .docx, .fb2.zip vs .fb2). */
export type ParserKind = 'txt' | 'md' | 'pdf' | 'epub' | 'mobi' | 'docx' | 'doc' | 'odt' | 'rtf' | 'fb2' | 'fb2zip' | 'html';

export interface FormatFamily {
  /** Human name shown to people, e.g. "Word". */
  label: string;
  /** Lower-case extensions (no dot) and the reader each one is routed to. */
  extensions: Readonly<Record<string, ParserKind>>;
  /** Optional detail after the label, e.g. "DOCX, DOC". */
  detail?: string;
}

export const FORMAT_FAMILIES: readonly FormatFamily[] = [
  { label: 'PDF', extensions: { pdf: 'pdf' } },
  { label: 'EPUB', extensions: { epub: 'epub' } },
  { label: 'MOBI/AZW3', extensions: { mobi: 'mobi', azw: 'mobi', azw3: 'mobi', kf8: 'mobi', prc: 'mobi', pdb: 'mobi' } },
  { label: 'Word', detail: 'DOCX, DOC', extensions: { docx: 'docx', doc: 'doc' } },
  { label: 'ODT', extensions: { odt: 'odt' } },
  { label: 'RTF', extensions: { rtf: 'rtf' } },
  { label: 'FB2', extensions: { fb2: 'fb2', 'fb2.zip': 'fb2zip' } },
  { label: 'HTML', extensions: { html: 'html', htm: 'html', xhtml: 'html', xht: 'html' } },
  { label: 'Markdown', extensions: { md: 'md', markdown: 'md' } },
  { label: 'plain text', extensions: { txt: 'txt', text: 'txt' } },
];

/** Extension (lower case, no dot) → reader. */
export const EXT_KIND: Readonly<Record<string, ParserKind>> = Object.freeze(
  Object.assign({}, ...FORMAT_FAMILIES.map((f) => f.extensions)) as Record<string, ParserKind>,
);

/** "Word (DOCX, DOC)" */
export function familyName(f: FormatFamily): string {
  return f.detail ? `${f.label} (${f.detail})` : f.label;
}

/** "PDF, EPUB, MOBI/AZW3, Word (DOCX, DOC), ODT, RTF, FB2, HTML, Markdown and plain text" */
export function supportedFormatsText(): string {
  const names = FORMAT_FAMILIES.map(familyName);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Short limits line shown next to the list. */
export const FORMAT_CAVEAT = 'Scanned PDFs (images of pages) and DRM-protected books cannot be read.';
