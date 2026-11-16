/**
 * Format-independent text helpers: blocks (paragraphs/headings), sectioning, plain-text paragraphing
 * and chapter-heading detection. Everything here is pure and synchronous.
 */
import type { ParsedSection } from '../core/types';
import { tooLarge } from './errors';

/** A paragraph or heading produced by any format reader. */
export interface Block {
  kind: 'p' | 'h';
  text: string;
  /** Heading level, 1 = top. Only for kind 'h'. */
  level?: number;
}

/** Hard cap on produced text (characters). ~8 million words; beyond that something is wrong. */
export const MAX_TEXT_CHARS = 50_000_000;

const RE_WS_RUN = /[\s\u00A0]+/g;

/** Collapse all whitespace (incl. newlines, NBSP) into single spaces and trim. */
export function cleanInline(s: string): string {
  return s.replace(RE_WS_RUN, ' ').trim();
}

const RE_TRAIL_HYPHEN = /(\p{L})[-\u00AD\u2010]$/u;
const RE_LEAD_LOWER = /^\p{Ll}/u;

/** Join two text fragments that were on consecutive lines, removing typographic hyphenation. */
export function joinFragments(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith('\u00AD')) return a.slice(0, -1) + b;
  if (RE_TRAIL_HYPHEN.test(a)) {
    // "exam-" + "ple" -> "example"; "Anglo-" + "Saxon" keeps the hyphen (no space either way)
    return RE_LEAD_LOWER.test(b) ? a.slice(0, -1) + b : a + b;
  }
  return `${a} ${b}`;
}

/** Join wrapped lines into one paragraph string. */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const l = cleanInline(raw);
    if (l) out = joinFragments(out, l);
  }
  return out;
}

export function wordCount(s: string): number {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// Chapter heading detection (plain text)
// ---------------------------------------------------------------------------

const NUM_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|final';
const ROMAN = '[ivxlcdm]+';
const NUMBER = `(?:\\d{1,4}|${ROMAN}|(?:${NUM_WORDS})(?:[- ](?:${NUM_WORDS}))*)`;
const RE_CHAPTER = new RegExp(
  `^(?:chapter|chap\\.|part|book|section|volume|vol\\.|act|scene|canto|letter|kapitel|chapitre|cap[i\u00ED]tulo|capitolo|teil|parte|livre|buch|\u0433\u043B\u0430\u0432\u0430|\u0447\u0430\u0441\u0442\u044C)\\s+${NUMBER}\\b\\.?(?:\\s*[-:.\\u2013\\u2014]\\s*|\\s+)?(.{0,80})$`,
  'iu',
);
const RE_SPECIAL = /^(?:prologue|epilogue|introduction|preface|foreword|afterword|acknowledg(?:e)?ments|appendix(?:\s+[a-z0-9]+)?|interlude|postscript|author'?s note|conclusion|glossary|dedication|contents|table of contents)\.?$/i;
const RE_ROMAN_ALONE = /^(?=[ivxlcdm]{1,7}\.?$)(m{0,3})(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})\.?$/i;
const RE_NUMBER_ALONE = /^\d{1,3}\.?$/;

export type HeadingKind = 'chapter' | 'special' | 'numeral';

/** Is this single line a chapter-like heading? Returns its kind, or null. */
export function headingKind(line: string): HeadingKind | null {
  const s = line.trim();
  if (!s || s.length > 100) return null;
  const m = RE_CHAPTER.exec(s);
  if (m) {
    // "Chapter 3 was the best part" is a sentence, not a heading.
    const rest = m[1] ?? '';
    if (/[a-z].*[.!?,;]$/.test(rest) && rest.split(/\s+/).length > 8) return null;
    // "Part of the reason ..." is caught by NUMBER needing a number; still reject lowercase starts of prose
    if (/^(part|section|book|act|scene|letter|volume)\s/i.test(s) && /^[a-z]/.test(s)) return null;
    return 'chapter';
  }
  if (RE_SPECIAL.test(s)) return 'special';
  if (RE_ROMAN_ALONE.test(s) && s.replace('.', '').length > 0) return 'numeral';
  if (RE_NUMBER_ALONE.test(s)) return 'numeral';
  return null;
}

/** Title-case an ALL CAPS heading ("CHAPTER XII. THE STORM" -> "Chapter XII. The Storm"). Mixed case is kept. */
export function prettifyHeading(s: string): string {
  const t = cleanInline(s);
  if (!/\p{Lu}/u.test(t) || /\p{Ll}/u.test(t)) return t;
  const cased = t
    .toLowerCase()
    .replace(/(^|[\s"'(\[\u201C\u2018-])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  // Roman numerals stay upper case right after a chapter keyword, or when they are the whole heading.
  if (RE_ROMAN_ALONE.test(t)) return t.toUpperCase();
  return cased.replace(
    /^((?:Chapter|Chap\.|Part|Book|Section|Volume|Vol\.|Act|Scene|Canto|Letter|Appendix)\s+)([ivxlcdm]+)\b/i,
    (_m, kw: string, num: string) => kw + num.toUpperCase(),
  );
}

// ---------------------------------------------------------------------------
// Sectioning from blocks
// ---------------------------------------------------------------------------

export interface SectionOptions {
  /** Title for text that precedes the first heading. */
  frontTitle?: string;
  /** Title for a book without any headings. */
  singleTitle?: string;
}

/**
 * Turn blocks into sections. The split level is the highest heading level that occurs at least twice
 * (a single top-level heading at the very start is treated as the book title). Headings of a higher
 * (more important) level also split. Lower-level headings stay in the text as their own paragraphs.
 */
export function sectionsFromBlocks(blocks: Block[], opts: SectionOptions = {}): ParsedSection[] {
  const headings = blocks.filter((b) => b.kind === 'h' && b.text);
  const counts = new Map<number, number>();
  for (const h of headings) counts.set(h.level ?? 1, (counts.get(h.level ?? 1) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  let splitLevel: number | null = null;
  for (const l of levels) {
    if ((counts.get(l) ?? 0) >= 2) {
      splitLevel = l;
      break;
    }
  }
  if (splitLevel === null && headings.length === 1) splitLevel = headings[0].level ?? 1;
  // Very long sections at this level (Parts made of Chapters)? Split one level deeper instead.
  if (splitLevel !== null) {
    const totalWords = blocks.reduce((n, b) => n + (b.kind === 'p' ? wordCount(b.text) : 0), 0);
    const here = counts.get(splitLevel) ?? 1;
    const deeper = levels.find((l) => l > splitLevel!);
    if (deeper !== undefined && totalWords / here > 6000 && (counts.get(deeper) ?? 0) >= 2 * here) splitLevel = deeper;
  }
  // A lone, more important heading at the very top is the book's title, not a part.
  const firstIdx = blocks.findIndex((b) => b.text);
  const first = blocks[firstIdx];
  const skipIdx =
    first && first.kind === 'h' && splitLevel !== null && (first.level ?? 1) < splitLevel && counts.get(first.level ?? 1) === 1
      ? firstIdx
      : -1;

  const sections: { title: string; paras: string[] }[] = [];
  let cur: { title: string; paras: string[] } | null = null;
  const front: string[] = [];
  let totalChars = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.text || i === skipIdx) continue;
    totalChars += b.text.length;
    if (totalChars > MAX_TEXT_CHARS) throw tooLarge('This book has more text than Tempo can handle.');
    const isSplit = b.kind === 'h' && splitLevel !== null && (b.level ?? 1) <= splitLevel;
    if (isSplit) {
      const title = prettifyHeading(b.text);
      if (cur && cur.paras.length === 0) {
        // Heading directly followed by another heading ("Part One" / "Chapter 1"): combine titles.
        cur.title = cur.title ? `${cur.title}: ${title}` : title;
      } else {
        cur = { title, paras: [] };
        sections.push(cur);
      }
    } else if (cur) {
      cur.paras.push(b.text);
    } else {
      front.push(b.text);
    }
  }

  if (sections.length === 0) {
    return [{ title: opts.singleTitle ?? '', text: front.join('\n\n') }];
  }
  // A heading without any text (e.g. last heading in the file) folds into nothing: drop empty sections,
  // but keep at least one.
  const nonEmpty = sections.filter((s) => s.paras.length > 0);
  const out: ParsedSection[] = (nonEmpty.length ? nonEmpty : sections.slice(0, 1)).map((s) => ({
    title: s.title,
    text: s.paras.join('\n\n'),
  }));
  if (front.length) {
    const frontText = front.join('\n\n');
    if (wordCount(frontText) < 40) {
      // A few stray words (book title, author line) before chapter 1: keep them in the first section.
      out[0] = { title: out[0].title, text: out[0].text ? `${frontText}\n\n${out[0].text}` : frontText };
    } else {
      out.unshift({ title: opts.frontTitle ?? 'Front matter', text: frontText });
    }
  }
  return out;
}

/** Numbered fallback titles for blank section titles. */
export function fillTitles(sections: ParsedSection[], prefix = 'Section'): ParsedSection[] {
  let n = 0;
  return sections.map((s) => {
    n++;
    return s.title.trim() ? s : { ...s, title: `${prefix} ${n}` };
  });
}

// ---------------------------------------------------------------------------
// Plain text -> blocks
// ---------------------------------------------------------------------------

const RE_LIST_ITEM = /^\s*(?:[-*\u2022\u25CF\u25AA\u2013]\s+|\d{1,3}[.)]\s+)/;
const RE_SENTENCE_END = /[.!?:;"'\u201D\u2019)\]\u2026]$/;
const RE_SEPARATOR = /^\s*(?:[*\u2022~#=_-]\s*){3,}$/;

/**
 * Split raw plain text into paragraphs, undoing hard wraps.
 * - If blank lines are used between paragraphs, each blank-line block is a paragraph (lines joined).
 * - Otherwise, a new paragraph starts at an indented line, a list item, or after a line that is
 *   clearly shorter than the wrap width and ends a sentence. Long-line files are one paragraph per line.
 */
export function splitPlainParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n').split('\n');
  const nonBlank = lines.filter((l) => l.trim()).length;
  if (nonBlank === 0) return [];
  let blankRuns = 0;
  // blank-line runs *between* text lines (a trailing newline doesn't count)
  let lastText = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (lastText >= 0 && i - lastText > 1) blankRuns++;
    lastText = i;
  }

  const lengths = lines.map((l) => l.trimEnd().length).filter((n) => n > 0).sort((a, b) => a - b);
  const p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 0;
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  // Hard-wrapped if most lines are of similar, moderate length.
  const hardWrapped = p90 > 0 && p90 <= 120 && median >= p90 * 0.6;

  const paragraphs: string[] = [];
  const flush = (buf: string[]) => {
    if (buf.length === 0) return;
    const joined = joinLines(buf);
    if (joined) paragraphs.push(joined);
    buf.length = 0;
  };

  const blankMode = blankRuns >= Math.max(1, nonBlank * 0.04);
  const buf: string[] = [];
  let prevLine = '';
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    if (!line.trim()) {
      if (blankMode) flush(buf);
      prevLine = '';
      continue;
    }
    if (RE_SEPARATOR.test(line)) {
      flush(buf);
      prevLine = '';
      continue;
    }
    let breakBefore = false;
    if (buf.length > 0) {
      if (!hardWrapped && !blankMode) breakBefore = true; // one paragraph per line
      else if (RE_LIST_ITEM.test(line)) breakBefore = true;
      else if (headingKind(line) || headingKind(prevLine)) breakBefore = true;
      else if (!blankMode) {
        const indented = /^\s{2,}\S/.test(line) && !/^\s{2,}/.test(prevLine);
        const shortPrev = prevLine.trimEnd().length < p90 * 0.75 && RE_SENTENCE_END.test(prevLine.trimEnd());
        breakBefore = indented || shortPrev;
      } else if (/^\s{2,}\S/.test(line) && !/^\s{2,}/.test(prevLine) && prevLine.trimEnd().length < p90 * 0.9) {
        // blank-line mode but this block also uses first-line indents after a short line
        breakBefore = RE_SENTENCE_END.test(prevLine.trimEnd());
      }
    }
    if (breakBefore) flush(buf);
    buf.push(line);
    prevLine = line;
  }
  flush(buf);
  return paragraphs;
}

/** Strip a Project Gutenberg header/footer; returns the body plus title/author found in the header. */
export function stripGutenberg(text: string): { text: string; title?: string; author?: string } {
  const start = /^\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG E(?:BOOK|TEXT)[^\n]*\*{3}[^\n]*$/im.exec(text);
  if (!start) return { text };
  const header = text.slice(0, start.index);
  let body = text.slice(start.index + start[0].length);
  const end = /^\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG E(?:BOOK|TEXT)[^\n]*$/im.exec(body);
  if (end) body = body.slice(0, end.index);
  // Producer credits right after the start marker.
  body = body.replace(/^\s*(?:Produced by|E-?text prepared by|Transcribed (?:from|by))[^\n]*(?:\n[^\n]+)*\n\s*\n/i, '');
  const title = /^Title:\s*(.+)$/im.exec(header)?.[1]?.trim();
  const author = /^Author:\s*(.+)$/im.exec(header)?.[1]?.trim();
  return { text: body, title, author };
}

/**
 * Plain-text paragraphs -> blocks, marking chapter headings. A chapter heading followed by a short
 * title-like paragraph ("CHAPTER I." / "The Boy Who Lived") becomes one heading. Runs of headings
 * without text in between (a table of contents) are not treated as headings.
 */
export function plainParagraphsToBlocks(paragraphs: string[]): Block[] {
  const kinds = paragraphs.map((p) => headingKind(p));
  // Bare numerals ("IV", "12") count only when there are several of them.
  const numerals = kinds.filter((k) => k === 'numeral').length;
  const chapters = kinds.filter((k) => k === 'chapter').length;
  const useNumerals = numerals >= 3 && chapters < 2;

  const blocks: Block[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const k = kinds[i];
    const isHeading = k === 'chapter' || k === 'special' || (k === 'numeral' && useNumerals);
    if (!isHeading) {
      blocks.push({ kind: 'p', text: paragraphs[i] });
      continue;
    }
    let title = prettifyHeading(paragraphs[i]);
    const next = paragraphs[i + 1];
    if (
      next !== undefined &&
      kinds[i + 1] === null &&
      next.length <= 70 &&
      !RE_SENTENCE_END.test(next.replace(/[.]$/, 'X')) && // a trailing period is ok, ?! "" are not
      /^[\p{Lu}\p{N}"'\u201C\u2018]/u.test(next) &&
      wordCount(next) <= 12 &&
      !/[.!?]\s/.test(next)
    ) {
      title = `${title.replace(/[.:]\s*$/, '')}: ${next.replace(/\.$/, '')}`;
      i++;
    }
    blocks.push({ kind: 'h', level: k === 'chapter' && /^(part|book|volume|vol\.)/i.test(title) ? 1 : 2, text: title });
  }
  return dropTocRuns(blocks);
}

/** Headings with (almost) no text between them are a table of contents: demote them to paragraphs. */
export function dropTocRuns(blocks: Block[]): Block[] {
  const headIdx: number[] = [];
  blocks.forEach((b, i) => b.kind === 'h' && headIdx.push(i));
  if (headIdx.length < 3) return blocks;
  const gapWords = (from: number, to: number) => {
    let n = 0;
    for (let i = from + 1; i < to; i++) n += wordCount(blocks[i].text);
    return n;
  };
  // gaps[j] = words between heading j and the next heading (or the end)
  const gaps = headIdx.map((h, j) => gapWords(h, j + 1 < headIdx.length ? headIdx[j + 1] : blocks.length));
  const demote = new Set<number>();
  for (let j = 0; j + 1 < headIdx.length; j++) {
    // Part of a run: nothing after it, and nothing before it or nothing after the next one.
    // ("Part One" directly followed by "Chapter 1" + text is not a run.)
    const prevGap = j > 0 ? gaps[j - 1] : Infinity;
    if (gaps[j] < 15 && (prevGap < 15 || gaps[j + 1] < 15)) demote.add(headIdx[j]);
  }
  if (demote.size === 0) return blocks;
  return blocks.map((b, i) => (demote.has(i) ? { kind: 'p' as const, text: b.text } : b));
}

/** Whole pipeline for plain text: paragraphs, chapter detection, sections. */
export function plainTextToSections(text: string, opts: SectionOptions = {}): ParsedSection[] {
  const blocks = plainParagraphsToBlocks(splitPlainParagraphs(text));
  return sectionsFromBlocks(blocks, opts);
}

/** First few words of a text, for a default title. */
export function titleFromText(text: string, maxWords = 6, maxLen = 60): string {
  const firstLine = text.trim().split('\n', 1)[0] ?? '';
  const words = cleanInline(firstLine).split(' ').filter(Boolean);
  let t = words.slice(0, maxWords).join(' ');
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).trimEnd();
  if (!t) return '';
  return words.length > maxWords || t.length < cleanInline(firstLine).length ? `${t.replace(/[,;:.\s]+$/, '')}\u2026` : t;
}

/** Title from a file name: drop extension(s), turn _ and . separators into spaces. */
export function titleFromFileName(name: string): string {
  let base = name.replace(/^.*[\\/]/, '');
  base = base.replace(/\.(fb2\.zip|[a-z0-9]{1,5})$/i, '');
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

/** Let the UI breathe during long synchronous loops. */
export function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
