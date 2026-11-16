/** OpenDocument Text: zip -> content.xml (+ meta.xml). */
import type { ParsedBook } from '../core/types';
import { ParseError, corrupt, emptyBook } from './errors';
import { firstByLocalName, localName, parseXml } from './html';
import { type Block, cleanInline, fillTitles, sectionsFromBlocks, titleFromFileName } from './textUtils';
import { openZip } from './zip';

export async function parseOdtBytes(bytes: Uint8Array, fileName: string): Promise<ParsedBook> {
  const zip = await openZip(bytes, 'OpenDocument');
  if (!zip.has('content.xml')) throw corrupt('OpenDocument');
  if (zip.has('META-INF/manifest.xml')) {
    const manifest = await zip.text('META-INF/manifest.xml');
    if (/encryption-data/.test(manifest)) {
      throw new ParseError('password', 'This document is password-protected. Open it, remove the password, save it and try again.');
    }
  }
  let content: Document;
  try {
    content = parseXml(await zip.text('content.xml'));
  } catch (e) {
    throw corrupt('OpenDocument', e);
  }
  const body = firstByLocalName(content, 'text') ?? firstByLocalName(content, 'body');
  if (!body) throw emptyBook('OpenDocument');
  const blocks = odfToBlocks(body);
  if (!blocks.length) throw emptyBook('OpenDocument');

  let title = '';
  let author: string | undefined;
  if (zip.has('meta.xml')) {
    try {
      const meta = parseXml(await zip.text('meta.xml'));
      title = cleanInline(firstByLocalName(meta, 'title')?.textContent ?? '');
      author = cleanInline((firstByLocalName(meta, 'creator') ?? firstByLocalName(meta, 'initial-creator'))?.textContent ?? '') || undefined;
    } catch {
      /* optional */
    }
  }
  title ||= titleFromFileName(fileName);
  return { title, author, sections: fillTitles(sectionsFromBlocks(blocks, { singleTitle: title })) };
}

const SKIP = new Set(['tracked-changes', 'note-citation', 'annotation', 'sequence-decls', 'variable-decls', 'user-field-decls', 'table-of-content', 'bookmark-ref-start', 'forms', 'soft-page-break', 'change-start', 'change-end']);

/** ODF text body -> blocks. text:h with outline-level = heading, text:p = paragraph. */
export function odfToBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  const inline = (el: Node): string => {
    let s = '';
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) s += c.nodeValue ?? '';
      else if (c.nodeType === 1) {
        const e = c as Element;
        const n = localName(e);
        if (SKIP.has(n)) continue;
        if (n === 's') s += ' '.repeat(Math.min(100, Number(e.getAttribute('text:c') ?? 1) || 1));
        else if (n === 'tab' || n === 'line-break') s += ' ';
        else if (n === 'note') {
          // footnote body: drop from the running text (it would interrupt the sentence)
          continue;
        } else if (n === 'p' || n === 'h') continue; // nested paragraphs inside frames handled by walk()
        else s += inline(e);
      }
    }
    return s;
  };
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      const n = localName(c);
      if (SKIP.has(n)) continue;
      if (n === 'h') {
        const t = cleanInline(inline(c));
        const lvl = Number(c.getAttribute('text:outline-level') ?? 1) || 1;
        if (t) blocks.push({ kind: 'h', level: lvl, text: t });
      } else if (n === 'p') {
        const t = cleanInline(inline(c));
        if (t) blocks.push({ kind: 'p', text: t });
        // text frames anchored in paragraphs can contain more paragraphs
        for (const f of Array.from(c.getElementsByTagName('*')).filter((x) => localName(x) === 'text-box')) walk(f);
      } else {
        walk(c); // list, list-item, section, table, table-row, table-cell, ...
      }
    }
  };
  walk(root);
  return blocks;
}
