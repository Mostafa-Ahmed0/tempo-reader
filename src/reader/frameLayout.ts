import type { HighlightMode } from '../core/settings';
import { focusIndexes } from '../core/text';

/**
 * Pure helpers for laying out one RSVP frame (no DOM).
 * All indexes returned here are CODE-POINT indexes into the full frame text (`Array.from(text)`).
 */

const RE_LETTER = /\p{L}/u;
const RE_RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;
const RE_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** 'rtl' if the first strong letter of `text` belongs to a right-to-left script. */
export function textDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RE_LETTER.test(ch)) return RE_RTL_LETTER.test(ch) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}

/** Dominant direction of a word list (majority vote over up to `sample` words that contain letters). */
export function dominantDirection(words: readonly string[], sample = 400): 'ltr' | 'rtl' {
  let rtl = 0;
  let total = 0;
  const step = Math.max(1, Math.floor(words.length / sample));
  for (let i = 0; i < words.length && total < sample; i += step) {
    const w = words[i];
    let strong = false;
    for (const ch of w) {
      if (RE_LETTER.test(ch)) {
        strong = true;
        if (RE_RTL_LETTER.test(ch)) rtl++;
        break;
      }
    }
    if (strong) total++;
  }
  return total > 0 && rtl * 2 > total ? 'rtl' : 'ltr';
}

function letterCount(word: string): number {
  let n = 0;
  for (const ch of word) if (RE_LETTER_OR_DIGIT.test(ch)) n++;
  return n;
}

export interface FrameFocus {
  /** Code-point index (into the whole text) that is placed on the anchor line. -1 for empty text. */
  anchor: number;
  /** Code-point indexes (into the whole text) drawn in the highlight colour. */
  highlight: number[];
}

/**
 * Which letter of a frame sits on the anchor line and which letters are highlighted.
 *
 * Single word: the focus letter from `focusIndexes` (for 'first-middle' the middle letter is the anchor;
 * for 'none' the ORP letter is still used as an invisible anchor so words don't jump around).
 *
 * Chunks (text with spaces) — one rule: the anchor word is the LONGEST word (letters/digits only),
 * ties going to the word closest to the centre of the chunk, then the earlier one. Only that word is highlighted.
 */
export function frameFocus(text: string, mode: HighlightMode): FrameFocus {
  if (!text) return { anchor: -1, highlight: [] };
  const parts = text.split(' ');
  let offset = 0;
  let best = -1;
  let bestOffset = 0;
  let bestLen = -1;
  let bestDist = Infinity;
  const centre = (parts.length - 1) / 2;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p) {
      const len = letterCount(p);
      const dist = Math.abs(i - centre);
      if (len > bestLen || (len === bestLen && dist < bestDist)) {
        best = i;
        bestLen = len;
        bestDist = dist;
        bestOffset = offset;
      }
    }
    offset += Array.from(p).length + 1;
  }
  if (best < 0) return { anchor: 0, highlight: [] };
  const word = parts[best];
  const hl = focusIndexes(word, mode);
  const anchorLocal = mode === 'none' || hl.length === 0 ? (focusIndexes(word, 'orp')[0] ?? 0) : hl[hl.length - 1];
  return { anchor: bestOffset + anchorLocal, highlight: hl.map((i) => bestOffset + i) };
}

/** UTF-16 [start, end) of the grapheme-ish cluster at code-point `cp` (base char + following combining marks). */
export function clusterRange(text: string, cp: number): [number, number] {
  let u = 0;
  let i = 0;
  const chars = Array.from(text);
  for (; i < cp && i < chars.length; i++) u += chars[i].length;
  if (i >= chars.length) return [text.length, text.length];
  const start = u;
  u += chars[i].length;
  i++;
  // keep combining marks (Arabic harakat, Hebrew points, Latin accents), ZWJ/ZWNJ and variation selectors with their base
  while (i < chars.length && /[\p{M}\u200C\u200D\uFE00-\uFE0F]/u.test(chars[i])) {
    u += chars[i].length;
    i++;
  }
  return [start, u];
}

/**
 * The focus letters of the frame [index, index+count) of `words`, as the word that carries them and
 * code-point indexes into that word. Same rule as the word view (`frameFocus`), so the page view
 * highlights exactly the letters the RSVP frame would. Null when nothing is highlighted ('none').
 */
export function frameFocusInWords(words: readonly string[], index: number, count: number, mode: HighlightMode): { word: number; letters: number[] } | null {
  const n = Math.max(0, Math.min(count, words.length - index));
  if (n <= 0 || index < 0) return null;
  const parts = words.slice(index, index + n);
  const { highlight } = frameFocus(parts.join(' '), mode);
  if (!highlight.length) return null;
  let offset = 0;
  for (let k = 0; k < parts.length; k++) {
    const len = Array.from(parts[k]).length;
    if (highlight[0] < offset + len) return { word: index + k, letters: highlight.map((cp) => cp - offset) };
    offset += len + 1;
  }
  return null;
}
