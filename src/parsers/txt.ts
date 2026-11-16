/** Plain text, Markdown and pasted text. */
import type { ParsedBook } from '../core/types';
import { decodeBytes } from './encoding';
import { emptyBook } from './errors';
import {
  type Block,
  cleanInline,
  fillTitles,
  plainParagraphsToBlocks,
  sectionsFromBlocks,
  splitPlainParagraphs,
  stripGutenberg,
  titleFromFileName,
  titleFromText,
  wordCount,
} from './textUtils';

export function parseTxtBytes(bytes: Uint8Array, fileName: string): ParsedBook {
  const { text } = decodeBytes(bytes);
  const g = stripGutenberg(text);
  const blocks = plainParagraphsToBlocks(splitPlainParagraphs(g.text));
  if (!blocks.some((b) => b.text)) throw emptyBook('text');
  const title = g.title || titleFromFileName(fileName);
  const sections = fillTitles(sectionsFromBlocks(blocks, { singleTitle: title }));
  return { title, author: g.author || undefined, sections };
}

export function parsePasted(text: string, title?: string): ParsedBook {
  const blocks = plainParagraphsToBlocks(splitPlainParagraphs(text));
  const finalTitle = title?.trim() || titleFromText(text) || 'Pasted text';
  const sections = fillTitles(sectionsFromBlocks(blocks, { singleTitle: finalTitle }));
  return { title: finalTitle, sections };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Strip inline markdown: links, images, emphasis, code spans, html tags, escapes. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '') // images
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // inline links
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // reference links
    .replace(/\[\^[^\]]+\]/g, '') // footnote refs
    .replace(/<\/?[a-zA-Z][^>]*>/g, '') // inline html tags
    .replace(/<(https?:[^>]+)>/g, '$1') // autolinks
    .replace(/(`+)(.+?)\1/g, '$2') // code spans
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2') // bold
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2') // italics
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1') // escapes
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/** Markdown -> blocks: ATX/setext headings, lists, quotes, code fences, tables, front matter. */
export function markdownToBlocks(md: string): { blocks: Block[]; title?: string; author?: string } {
  let text = md.replace(/\r\n?/g, '\n');
  let title: string | undefined;
  let author: string | undefined;
  const fm = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\n/.exec(text);
  if (fm) {
    title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1];
    author = /^author:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1];
    text = text.slice(fm[0].length);
  }
  // Drop HTML comments and reference-style link definitions.
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/^ {0,3}\[[^\]]+\]:\s+\S+.*$/gm, '');

  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      // Reuse the plain-text joiner (dehyphenation, whitespace), then strip inline syntax.
      const joined = splitPlainParagraphs(para.join('\n')).join(' ');
      const t = cleanInline(stripInlineMarkdown(joined));
      if (t) blocks.push({ kind: 'p', text: t });
    }
    para = [];
  };
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence !== null) {
      if (line.trim().startsWith(fence)) {
        fence = null;
        continue;
      }
      const t = cleanInline(line);
      if (t) blocks.push({ kind: 'p', text: t });
      continue;
    }
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      flush();
      fence = f[1];
      continue;
    }
    const atx = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) {
      flush();
      const t = cleanInline(stripInlineMarkdown(atx[2]));
      if (t) blocks.push({ kind: 'h', level: atx[1].length, text: t });
      continue;
    }
    const next = lines[i + 1];
    if (line.trim() && para.length === 0 && next !== undefined && /^\s{0,3}(=+|-+)\s*$/.test(next) && !/^\s*[-*+]\s/.test(line)) {
      // setext heading
      flush();
      const t = cleanInline(stripInlineMarkdown(line));
      if (t) blocks.push({ kind: 'h', level: next.trim().startsWith('=') ? 1 : 2, text: t });
      i++;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush(); // horizontal rule
      continue;
    }
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue; // table separator
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => cleanInline(stripInlineMarkdown(c))).filter(Boolean);
      if (cells.length) blocks.push({ kind: 'p', text: cells.join(' \u2013 ') });
      continue;
    }
    const list = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (list) {
      flush();
      para.push(list[1]);
      continue;
    }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      if (!quote[1].trim()) flush();
      else para.push(quote[1]);
      continue;
    }
    para.push(line);
  }
  flush();
  return { blocks, title, author };
}

export function parseMarkdownBytes(bytes: Uint8Array, fileName: string): ParsedBook {
  const { text } = decodeBytes(bytes);
  const { blocks, title: fmTitle, author } = markdownToBlocks(text);
  if (!blocks.some((b) => b.text)) throw emptyBook('Markdown');
  // A single "# Title" at the very top is the book title.
  let title = fmTitle?.trim();
  const h1s = blocks.filter((b) => b.kind === 'h' && b.level === 1);
  if (!title && h1s.length === 1 && blocks[0] === h1s[0]) title = h1s[0].text;
  title ||= titleFromFileName(fileName);
  let sections = sectionsFromBlocks(blocks, { singleTitle: title });
  // Too fine-grained (e.g. every ### is a section of a few words)? Fall back to one section.
  if (sections.length > 1 && sections.every((s) => wordCount(s.text) < 30)) {
    sections = [{ title, text: sections.map((s) => (s.title ? `${s.title}\n\n${s.text}` : s.text)).join('\n\n') }];
  }
  return { title, author: author?.trim() || undefined, sections: fillTitles(sections) };
}
