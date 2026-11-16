import type { ParsedSection, TokenizedBook } from './types';

/** Tokens longer than this (in code points) are split at break characters. */
export const MAX_TOKEN_LENGTH = 30;
/** CJK runs (no spaces) are cut into chunks of this many ideographs/kana. */
export const CJK_CHUNK_SIZE = 3;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const RE_CRLF = /\r\n?/g;
const RE_PARA_SEP = /\u2029/g;
const RE_LINE_SEP = /\u2028/g;
// Odd whitespace -> plain space: tabs, VT, FF, NBSP, en/em/thin/hair spaces, narrow NBSP, math space, ideographic space, other C0 controls.
const RE_ODD_SPACE = /[\t\u000B\u000C\u0000-\u0008\u000E-\u001F\u007F\u0085\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
// Soft hyphen at a line end: join the halves.
const RE_SOFT_HYPHEN_EOL = /\u00AD[ ]*\n[ ]*/g;
// Invisible characters removed outright: soft hyphen, zero-width space, word joiner, BOM, bidi marks/embeddings/isolates.
const RE_INVISIBLE = /[\u00AD\u200B\u2060\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// "exam-\nple" -> "example" (letter, hyphen, single line break, letter). Not across blank lines.
const RE_HYPHEN_EOL = /(\p{L})[-‐][ ]*\n[ ]*(\p{L})/gu;
const RE_UPPER = /\p{Lu}/u;
const RE_PARAGRAPH_SPLIT = /\n[ ]*\n/;
const RE_WS = /\s+/;

/** Normalise raw parser text. Exported for tests and for parsers that want it. */
export function normalizeText(text: string): string {
  return text
    .replace(RE_CRLF, '\n')
    .replace(RE_PARA_SEP, '\n\n')
    .replace(RE_LINE_SEP, '\n')
    .replace(RE_ODD_SPACE, ' ')
    .replace(RE_SOFT_HYPHEN_EOL, '')
    .replace(RE_INVISIBLE, '')
    .replace(RE_HYPHEN_EOL, (_m, a: string, b: string) =>
      // "Anglo-\nSaxon" keeps its hyphen; "exam-\nple" is a typographic break.
      RE_UPPER.test(b) ? `${a}-${b}` : a + b,
    );
}

// ---------------------------------------------------------------------------
// Token splitting
// ---------------------------------------------------------------------------

const RE_EM_DASH = /[—―]/;
const RE_EM_DASH_PIECES = /[^—―]+[—―]*|[—―]+/g;
const RE_DASH_ONLY = /^[—―]+$/;
const RE_LONE_DASH = /^[-‐-―]+$/;
const RE_CJK_TEST = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const RE_CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/u;
const RE_PUNCT = /[\p{P}\p{S}]/u;
const RE_OPENING = /[\p{Ps}\p{Pi}]/u;
/** Characters after which a long token may be broken. */
const BREAK_AFTER = new Set(['/', '\\', '-', '‐', '‑', '‒', '–', '_', '.', ',', ';', ':', '?', '&', '=', '|', '#', '+', '~', '!', ')', ']', '}']);

/** "word—word—word" -> ["word—", "word—", "word"]; a leading dash sticks to the following word. */
function splitEmDashes(token: string): string[] {
  const pieces = token.match(RE_EM_DASH_PIECES) ?? [token];
  if (pieces.length > 1 && RE_DASH_ONLY.test(pieces[0])) {
    // leading dash-only piece merges into the next one ("—word" stays one token)
    pieces.splice(0, 2, pieces[0] + pieces[1]);
  }
  return pieces;
}

/** Cut runs of CJK characters into short chunks; punctuation stays with its neighbour. */
function splitCjk(token: string, out: string[]): void {
  let cur = '';
  let curIsCjk: boolean | null = null;
  let cjkCount = 0;
  let prefix = ''; // opening punctuation waiting for the next segment
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
    curIsCjk = null;
    cjkCount = 0;
  };
  for (const ch of token) {
    if (RE_CJK_CHAR.test(ch)) {
      if (curIsCjk === false || cjkCount >= CJK_CHUNK_SIZE) flush();
      cur = cur + prefix + ch;
      prefix = '';
      curIsCjk = true;
      cjkCount++;
    } else if (RE_PUNCT.test(ch)) {
      if (RE_OPENING.test(ch) && curIsCjk === true) {
        flush();
        prefix += ch;
      } else if (cur) {
        cur += ch;
      } else {
        prefix += ch;
      }
    } else {
      if (curIsCjk === true) flush();
      cur = cur + prefix + ch;
      prefix = '';
      curIsCjk = false;
    }
  }
  if (prefix) cur += prefix;
  flush();
}

/** Split a token longer than MAX_TOKEN_LENGTH at sensible break characters (hard cut as a last resort). */
function splitLong(token: string, out: string[]): void {
  const chars = Array.from(token);
  if (chars.length <= MAX_TOKEN_LENGTH) {
    out.push(token);
    return;
  }
  const minPiece = 6;
  let start = 0;
  while (chars.length - start > MAX_TOKEN_LENGTH) {
    let cut = -1;
    for (let i = start + MAX_TOKEN_LENGTH - 1; i >= start + minPiece - 1; i--) {
      if (BREAK_AFTER.has(chars[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut === -1) cut = start + MAX_TOKEN_LENGTH;
    out.push(chars.slice(start, cut).join(''));
    start = cut;
  }
  if (start < chars.length) out.push(chars.slice(start).join(''));
}

/** Turn one whitespace-delimited raw token into display tokens, appended to `out`. */
function pushToken(raw: string, out: string[]): void {
  const pieces = RE_EM_DASH.test(raw) ? splitEmDashes(raw) : [raw];
  for (const piece of pieces) {
    if (RE_CJK_TEST.test(piece)) {
      const chunks: string[] = [];
      splitCjk(piece, chunks);
      for (const c of chunks) splitLong(c, out);
    } else if (piece.length > MAX_TOKEN_LENGTH) {
      splitLong(piece, out);
    } else {
      out.push(piece);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tokenize parsed sections into the reader's word stream.
 * - Sections that produce no tokens are skipped (no chapter entry), so chapter word indexes stay strictly increasing.
 * - A section with a blank title gets "Section N" (N = 1-based index among non-empty sections).
 * Linear in input size.
 */
export function tokenize(sections: ParsedSection[]): TokenizedBook {
  const words: string[] = [];
  const paragraphStarts: number[] = [];
  const chapters: { title: string; wordIndex: number }[] = [];

  for (const section of sections) {
    const sectionStart = words.length;
    const paragraphs = normalizeText(section.text ?? '').split(RE_PARAGRAPH_SPLIT);
    for (const para of paragraphs) {
      const paraStart = words.length;
      const raws = para.split(RE_WS);
      for (const raw of raws) {
        if (!raw) continue;
        // A dash standing alone ("word — word") belongs to the previous word of the paragraph.
        if (RE_LONE_DASH.test(raw) && words.length > paraStart) {
          words[words.length - 1] += raw;
          continue;
        }
        pushToken(raw, words);
      }
      if (words.length > paraStart) paragraphStarts.push(paraStart);
    }
    if (words.length > sectionStart) {
      const title = (section.title ?? '').trim() || `Section ${chapters.length + 1}`;
      chapters.push({ title, wordIndex: sectionStart });
    }
  }

  return { words, paragraphStarts, chapters };
}

/** Number of display tokens; always equals `tokenize(sections).words.length`. */
export function countWords(sections: ParsedSection[]): number {
  return tokenize(sections).words.length;
}
