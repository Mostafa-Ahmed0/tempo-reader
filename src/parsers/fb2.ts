/** FictionBook 2 (.fb2 and .fb2.zip). */
import type { ParsedBook, ParsedSection } from '../core/types';
import { decodeBytes, latin1 } from './encoding';
import { corrupt, emptyBook, ParseError } from './errors';
import { childrenByLocalName, declaredCharset, firstByLocalName, localName, parseXml } from './html';
import { cleanInline, titleFromFileName, wordCount } from './textUtils';
import { openZip } from './zip';

export async function parseFb2ZipBytes(bytes: Uint8Array, fileName: string): Promise<ParsedBook> {
  const zip = await openZip(bytes, 'FB2');
  const entry = zip.names.find((n) => /\.fb2$/i.test(n)) ?? zip.names.find((n) => /\.xml$/i.test(n));
  if (!entry) throw new ParseError('corrupt', 'This zip archive does not contain an .fb2 book.');
  return parseFb2Bytes(await zip.bytes(entry), fileName);
}

export function parseFb2Bytes(bytes: Uint8Array, fileName: string): ParsedBook {
  const head = latin1(bytes, 0, Math.min(bytes.length, 1024));
  const { text } = decodeBytes(bytes, declaredCharset(head));
  let doc: Document;
  try {
    // DOMParser re-reads the encoding from the declaration only for bytes; for strings it's ignored.
    doc = parseXml(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw corrupt('FB2', e);
  }
  const root = doc.documentElement;
  if (!root || localName(root) !== 'FictionBook') throw corrupt('FB2');

  const titleInfo = firstByLocalName(root, 'title-info');
  const title = cleanInline(titleInfo ? (firstByLocalName(titleInfo, 'book-title')?.textContent ?? '') : '') || titleFromFileName(fileName);
  const authors = titleInfo
    ? childrenByLocalName(titleInfo, 'author')
        .map((a) => {
          const part = (n: string) => cleanInline(childrenByLocalName(a, n)[0]?.textContent ?? '');
          return cleanInline([part('first-name'), part('middle-name'), part('last-name')].filter(Boolean).join(' ')) || part('nickname');
        })
        .filter(Boolean)
    : [];

  // Main body = first <body> without name="notes"/"comments"
  const bodies = childrenByLocalName(root, 'body');
  const main = bodies.find((b) => !/notes|comments|footnotes/i.test(b.getAttribute('name') ?? '')) ?? bodies[0];
  if (!main) throw emptyBook('FB2');

  // Chapter level: top-level sections; if there's a single wrapper section, use its children.
  let top = childrenByLocalName(main, 'section');
  while (top.length === 1 && childrenByLocalName(top[0], 'section').length > 1 && wordCount(directText(top[0])) < 200) {
    top = childrenByLocalName(top[0], 'section');
  }
  const sections: ParsedSection[] = [];
  const preface = paragraphsOf(main, true); // epigraphs / text directly in body (excluding sections)
  if (top.length === 0) {
    if (preface.length) sections.push({ title, text: preface.join('\n\n') });
  } else {
    if (wordCount(preface.join(' ')) >= 40) sections.push({ title: 'Front matter', text: preface.join('\n\n') });
    let n = 0;
    for (const s of top) {
      n++;
      const t = cleanInline(childrenByLocalName(s, 'title')[0]?.textContent ?? '');
      const paras = paragraphsOf(s, false);
      if (!paras.length) continue;
      sections.push({ title: t || `Section ${n}`, text: paras.join('\n\n') });
    }
  }
  if (!sections.length) throw emptyBook('FB2');
  if (top.length && preface.length && wordCount(preface.join(' ')) < 40) {
    // short epigraph / title lines before chapter 1: keep them at the start of the first section
    sections[0] = { title: sections[0].title, text: `${preface.join('\n\n')}\n\n${sections[0].text}` };
  }

  return { title, author: authors.slice(0, 3).join(', ') || undefined, cover: findCover(root, titleInfo), sections };
}

const PARA = new Set(['p', 'v', 'subtitle', 'text-author']);

/** Text of all paragraphs in `el`, in document order. Sub-section titles become their own paragraphs. */
function paragraphsOf(el: Element, skipSections: boolean): string[] {
  const out: string[] = [];
  const walk = (e: Element, isTop: boolean) => {
    for (const c of Array.from(e.children)) {
      const n = localName(c);
      if (n === 'binary' || n === 'image') continue;
      if (n === 'section' && skipSections && isTop) continue;
      if (n === 'title' && isTop && e === el && !skipSections) continue; // the chapter's own title
      if (PARA.has(n)) {
        const t = cleanInline(inlineText(c));
        if (t) out.push(t);
      } else if (n === 'empty-line') {
        continue;
      } else walk(c, false);
    }
  };
  walk(el, true);
  return out;
}

function inlineText(e: Element): string {
  let s = '';
  for (let c = e.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) s += c.nodeValue ?? '';
    else if (c.nodeType === 1) {
      const el = c as Element;
      // footnote links: <a l:href="#n1" type="note">1</a>
      if (localName(el) === 'a' && el.getAttribute('type') === 'note') continue;
      s += inlineText(el);
    }
  }
  return s;
}

function directText(e: Element): string {
  return paragraphsOf(e, true).join(' ');
}

function findCover(root: Element, titleInfo: Element | null): Blob | undefined {
  const cp = titleInfo ? firstByLocalName(titleInfo, 'coverpage') : null;
  const img = cp ? firstByLocalName(cp, 'image') : null;
  const href = img?.getAttribute('l:href') ?? img?.getAttribute('xlink:href') ?? img?.getAttribute('href') ?? (img ? attrEndingWith(img, 'href') : null);
  if (!href?.startsWith('#')) return undefined;
  const id = href.slice(1);
  const bin = childrenByLocalName(root, 'binary').find((b) => b.getAttribute('id') === id);
  if (!bin) return undefined;
  try {
    const raw = atob((bin.textContent ?? '').replace(/\s+/g, ''));
    const data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
    return new Blob([data], { type: bin.getAttribute('content-type') ?? 'image/jpeg' });
  } catch {
    return undefined;
  }
}

function attrEndingWith(el: Element, suffix: string): string | null {
  for (const a of Array.from(el.attributes)) if (a.name.endsWith(suffix)) return a.value;
  return null;
}
