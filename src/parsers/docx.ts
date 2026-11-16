/** DOCX via mammoth (HTML output -> shared html->blocks), metadata from docProps/core.xml. */
import type { ParsedBook } from '../core/types';
import { corrupt, emptyBook } from './errors';
import { domToBlocks, firstByLocalName, parseMarkup, bodyOf, parseXml } from './html';
import { cleanInline, fillTitles, sectionsFromBlocks, titleFromFileName } from './textUtils';
import { openZip } from './zip';

const STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='heading 1'] => h1:fresh",
  "p[style-name='heading 2'] => h2:fresh",
  "p[style-name='Chapter Title'] => h1:fresh",
  "p[style-name='Chapter Heading'] => h1:fresh",
];

interface MammothLike {
  convertToHtml(input: { arrayBuffer: ArrayBuffer; buffer: Uint8Array }, options?: object): Promise<{ value: string }>;
  images: { imgElement(f: (img: unknown) => Promise<{ src: string }>): unknown };
}

export async function parseDocxBytes(bytes: Uint8Array, fileName: string): Promise<ParsedBook> {
  // openZip checks the archive limits (zip bombs) before mammoth inflates anything.
  const zip = await openZip(bytes, 'Word');
  if (!zip.has('word/document.xml') && !zip.names.some((n) => /^word\/document\d*\.xml$/i.test(n))) throw corrupt('Word');

  let title = '';
  let author: string | undefined;
  if (zip.has('docProps/core.xml')) {
    try {
      const core = parseXml(await zip.text('docProps/core.xml'));
      title = cleanInline(firstByLocalName(core, 'title')?.textContent ?? '');
      author = cleanInline(firstByLocalName(core, 'creator')?.textContent ?? '') || undefined;
    } catch {
      /* metadata is optional */
    }
  }

  const mod = (await import('mammoth')) as unknown as { default?: MammothLike } & MammothLike;
  const mammoth: MammothLike = mod.default ?? mod;
  let html: string;
  try {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = await mammoth.convertToHtml(
      { arrayBuffer: ab, buffer: bytes }, // browser build reads arrayBuffer, node build (tests) reads buffer
      {
        styleMap: STYLE_MAP,
        includeDefaultStyleMap: true,
        // Don't base64-encode images into the HTML: we only want text.
        convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
      },
    );
    html = res.value;
  } catch (e) {
    throw corrupt('Word', e);
  }

  const doc = parseMarkup(`<!DOCTYPE html><html><body>${html}</body></html>`, false);
  // Document "Title" style paragraph: use as book title, keep out of the text.
  const docTitle = doc.querySelector('h1.doc-title');
  if (docTitle) {
    if (!title || isJunkDocTitle(title)) title = cleanInline(docTitle.textContent ?? '');
    docTitle.remove();
  }
  // Footnotes/endnotes list that mammoth appends: keep (it's real text) but drop back-links.
  doc.querySelectorAll('a[href^="#footnote-ref"], a[href^="#endnote-ref"], sup > a[href^="#footnote"], sup > a[href^="#endnote"]').forEach((a) => a.remove());

  const blocks = domToBlocks(bodyOf(doc));
  if (!blocks.some((b) => b.text)) throw emptyBook('Word');
  if (!title || isJunkDocTitle(title)) title = titleFromFileName(fileName);
  return { title, author, sections: fillTitles(sectionsFromBlocks(blocks, { singleTitle: title })) };
}

/** Template leftovers in core.xml titles. */
export function isJunkDocTitle(t: string): boolean {
  return /^(?:untitled|document\d*|title|microsoft word.*|new document|doc\d*)$/i.test(t.trim()) || t.trim().length < 2;
}
