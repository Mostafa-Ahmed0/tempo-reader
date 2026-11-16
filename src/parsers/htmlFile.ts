/** Stand-alone HTML / XHTML files. */
import type { ParsedBook } from '../core/types';
import { decodeBytes, latin1 } from './encoding';
import { emptyBook } from './errors';
import { bodyOf, declaredCharset, domToBlocks, parseMarkup } from './html';
import { cleanInline, fillTitles, sectionsFromBlocks, titleFromFileName } from './textUtils';

export function parseHtmlBytes(bytes: Uint8Array, fileName: string): ParsedBook {
  const head = latin1(bytes, 0, Math.min(bytes.length, 4096));
  const { text } = decodeBytes(bytes, declaredCharset(head));
  const isXhtml = /\.xhtml?$/i.test(fileName) || /^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?<html[^>]+xmlns=/i.test(text);
  const doc = parseMarkup(text, isXhtml);

  // Prefer the <main>/<article> element of a web page when there is exactly one.
  const mains = Array.from(doc.getElementsByTagName('main'));
  const articles = Array.from(doc.getElementsByTagName('article'));
  const root = mains.length === 1 ? mains[0] : articles.length === 1 ? articles[0] : bodyOf(doc);
  const blocks = domToBlocks(root, { dropChrome: root === bodyOf(doc) });
  if (!blocks.length) throw emptyBook('HTML');

  const meta = (name: string) =>
    cleanInline(doc.querySelector(`meta[name="${name}" i], meta[property="${name}" i]`)?.getAttribute('content') ?? '');
  const h1s = blocks.filter((b) => b.kind === 'h' && b.level === 1);
  const title =
    cleanInline(doc.getElementsByTagName('title')[0]?.textContent ?? '') ||
    meta('dc.title') ||
    meta('og:title') ||
    (h1s.length === 1 ? h1s[0].text : '') ||
    titleFromFileName(fileName);
  const author = meta('author') || meta('dc.creator') || undefined;
  return { title, author, sections: fillTitles(sectionsFromBlocks(blocks, { singleTitle: title })) };
}
