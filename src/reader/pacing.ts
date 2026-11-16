import type { TokenizedBook } from '../core/types';

/**
 * Token analysis for pacing and navigation. Pure, linear in the number of tokens, no DOM.
 * Everything is stored in typed arrays so a 200k-word book costs a few hundred KB and ~tens of ms.
 */

export const F_SENTENCE_END = 1;
export const F_CLAUSE = 2;
export const F_PARA_END = 4;
export const F_PARA_START = 8;
export const F_CHAPTER_START = 16;
export const F_NUMERIC = 32; // numbers, acronyms, abbreviations: a touch longer

/** Raw multipliers (before normalisation). */
export const CLAUSE_FACTOR = 1.4;
export const NUMERIC_FACTOR = 1.2;
export const PARA_END_FACTOR = 1.5;
export const CHAPTER_START_FACTOR = 2.5;
/** Long words: +6 % per letter above 8, at most +60 %. */
export function lengthFactor(letters: number): number {
  return letters > 8 ? 1 + Math.min(0.6, (letters - 8) * 0.06) : 1;
}

/** Abbreviations whose trailing period does not end a sentence (lower-case, without the final dot). */
const ABBREVIATIONS = new Set(
  (
    'mr mrs ms mx dr prof sr jr st mt ft vs v cf viz e.g i.e al fig figs no nos vol vols pp p ch chap sec art ed eds rev gen col lt ' +
    'capt sgt cpl maj gov sen rep pres hon messrs mme mlle jan feb mar apr jun jul aug sep sept oct nov dec approx dept est inc ltd ' +
    'co corp bros ave blvd rd op ca c ibid ref refs eq eqs min max cca nr tel sc pl'
  ).split(' '),
);
/** Never sentence ends even before a capital (they introduce something). */
const NEVER_END = new Set(['e.g', 'i.e', 'cf', 'viz', 'vs', 'v']);

const RE_TRAILING_CLOSERS = /[\p{Pe}\p{Pf}"'’”»›*_]+$/u;
const RE_LEADING_OPENERS = /^[\p{Ps}\p{Pi}"'‘“«‹¿¡*_]+/u;
const RE_STRONG_END = /(?:[!?‽…؟。！？।॥]|\.\.\.)$/u;
const RE_CLAUSE_END = /[,;:—–―‒،؛、，；：]$/u;
const RE_SINGLE_INITIAL = /^\p{L}\.$/u;
const RE_DOTTED = /^(?:\p{L}{1,3}\.){2,}$/u; // U.S. e.g. i.e. Ph.D. a.m.
const RE_DIGIT = /\p{N}/u;
const RE_LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;
const RE_ACRONYM = /^\p{Lu}{2,}$/u;
const RE_FIRST_LETTER = /[\p{L}\p{N}]/u;
const RE_LOWER = /\p{Ll}/u;
const RE_PLAIN_WORD = /^[A-Za-z]+$/;
const RE_ALL_CAPS_ASCII = /^[A-Z]+$/;

/** First letter/digit of the next token, or '' */
function firstLetter(word: string | undefined): string {
  if (!word) return '';
  const m = RE_FIRST_LETTER.exec(word);
  return m ? m[0] : '';
}

export interface Ending {
  sentence: boolean;
  clause: boolean;
  abbreviation: boolean;
}

/**
 * Classify how a token ends, looking at the next token for context.
 * `paraEnd` = last token of a paragraph (always a hard stop for chunking, but only a sentence end if punctuated).
 */
export function classifyEnding(word: string, next: string | undefined, paraEnd: boolean): Ending {
  const core = word.replace(RE_TRAILING_CLOSERS, '').replace(RE_LEADING_OPENERS, '');
  const nextFirst = firstLetter(next);
  const nextLower = nextFirst !== '' && RE_LOWER.test(nextFirst);
  const out: Ending = { sentence: false, clause: false, abbreviation: false };
  if (!core) return out;

  if (RE_STRONG_END.test(core)) {
    // "and then… he left" / "Yahoo! is" → mid-sentence: clause pause only
    if (nextLower && !paraEnd) out.clause = true;
    else out.sentence = true;
    return out;
  }
  if (core.endsWith('.')) {
    const bare = core.slice(0, -1).toLowerCase();
    if (ABBREVIATIONS.has(bare)) {
      out.abbreviation = true;
      out.sentence = paraEnd && !NEVER_END.has(bare);
      return out;
    }
    if (RE_SINGLE_INITIAL.test(core)) {
      out.abbreviation = true;
      out.sentence = paraEnd;
      return out;
    }
    if (RE_DOTTED.test(core)) {
      out.abbreviation = true;
      out.sentence = paraEnd || (!NEVER_END.has(bare) && nextFirst !== '' && !nextLower && !RE_DIGIT.test(nextFirst));
      return out;
    }
    if (nextLower && !paraEnd) {
      // unknown abbreviation ("approx. five"): not a sentence end
      out.abbreviation = true;
      return out;
    }
    out.sentence = true;
    return out;
  }
  if (RE_CLAUSE_END.test(core)) out.clause = true;
  return out;
}

export interface TokenAnalysis {
  flags: Uint8Array;
  letters: Uint8Array;
  /** Sorted word indexes where a sentence begins (includes every paragraph start). */
  sentenceStarts: Int32Array;
  /** Sorted paragraph starts (copy of book.paragraphStarts, guaranteed to start with 0 when non-empty). */
  paragraphStarts: Int32Array;
  /** Sorted chapter word indexes. */
  chapterStarts: Int32Array;
}

export function analyzeTokens(book: Pick<TokenizedBook, 'words' | 'paragraphStarts' | 'chapters'>): TokenAnalysis {
  const { words } = book;
  const n = words.length;
  const flags = new Uint8Array(n);
  const letters = new Uint8Array(n);

  const paras = Array.from(new Set([0, ...book.paragraphStarts].filter((i) => i >= 0 && i < n))).sort((a, b) => a - b);
  if (n === 0) paras.length = 0;
  for (const p of paras) {
    flags[p] |= F_PARA_START;
    if (p > 0) flags[p - 1] |= F_PARA_END;
  }
  if (n > 0) flags[n - 1] |= F_PARA_END;
  const chapters = book.chapters.map((c) => c.wordIndex).filter((i) => i >= 0 && i < n);
  for (const c of chapters) {
    flags[c] |= F_CHAPTER_START | F_PARA_START;
    if (c > 0) flags[c - 1] |= F_PARA_END;
  }

  const sentenceStarts: number[] = [];
  for (let i = 0; i < n; i++) {
    const w = words[i];
    const f = flags[i];
    if (f & F_PARA_START || (i > 0 && flags[i - 1] & F_SENTENCE_END) || i === 0) sentenceStarts.push(i);
    if (RE_PLAIN_WORD.test(w)) {
      // fast path (most tokens): plain letters, no punctuation, no digits
      letters[i] = Math.min(255, w.length);
      if (w.length > 1 && RE_ALL_CAPS_ASCII.test(w)) flags[i] = f | F_NUMERIC;
      continue;
    }
    const m = w.match(RE_LETTER_OR_DIGIT);
    const count = m ? m.length : 0;
    letters[i] = Math.min(255, count);
    const end = classifyEnding(w, words[i + 1], (f & F_PARA_END) !== 0);
    let add = 0;
    if (end.sentence) add |= F_SENTENCE_END;
    else if (end.clause) add |= F_CLAUSE;
    const core = m ? m.join('') : '';
    if (end.abbreviation || RE_DIGIT.test(w) || RE_ACRONYM.test(core)) add |= F_NUMERIC;
    flags[i] = f | add;
  }

  return {
    flags,
    letters,
    sentenceStarts: Int32Array.from(sentenceStarts),
    paragraphStarts: Int32Array.from(paras),
    chapterStarts: Int32Array.from(chapters),
  };
}

/** Raw (un-normalised) smart-pacing multiplier of one token. */
export function rawMultiplier(flags: number, letters: number, punctuationPause: number): number {
  let m = 1;
  if (flags & F_SENTENCE_END) m *= punctuationPause;
  else if (flags & F_CLAUSE) m *= CLAUSE_FACTOR;
  m *= lengthFactor(letters);
  if (flags & F_NUMERIC) m *= NUMERIC_FACTOR;
  if (flags & F_PARA_END) m *= PARA_END_FACTOR;
  if (flags & F_CHAPTER_START) m *= CHAPTER_START_FACTOR;
  return m;
}

/**
 * Per-token time weights. With smart pacing on, raw multipliers are divided by their mean over a
 * window of NORMALISE_WINDOW tokens either side, so the average time per word stays at 60000 / wpm
 * for any stretch of a few hundred words: pauses are paid for by slightly quicker plain words instead
 * of silently lowering the real reading speed.
 */
export function computeWeights(a: TokenAnalysis, smartPacing: boolean, punctuationPause: number): Float32Array {
  const n = a.flags.length;
  const out = new Float32Array(n);
  if (!smartPacing || n === 0) {
    out.fill(1);
    return out;
  }
  // prefix sums of the raw multipliers, so each token can be divided by the mean of ITS neighbourhood
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const m = rawMultiplier(a.flags[i], a.letters[i], punctuationPause);
    out[i] = m;
    prefix[i + 1] = prefix[i] + m;
  }
  const W = NORMALISE_WINDOW;
  for (let i = 0; i < n; i++) {
    let lo = i - W;
    let hi = i + W + 1;
    // keep the window full-width at the ends of the book
    if (lo < 0) {
      hi = Math.min(n, hi - lo);
      lo = 0;
    }
    if (hi > n) {
      lo = Math.max(0, lo - (hi - n));
      hi = n;
    }
    out[i] /= (prefix[hi] - prefix[lo]) / (hi - lo);
  }
  return out;
}

/**
 * Half-width (tokens) of the window used to normalise smart-pacing multipliers. Normalising over a
 * ~400-word neighbourhood instead of the whole book keeps every stretch of reading (a short text,
 * the first minute of a session) close to the chosen WPM, not just the book as a whole.
 * Texts shorter than the window are normalised over their full length.
 */
export const NORMALISE_WINDOW = 200;

/** Number of tokens in the frame starting at `i`: up to `chunkSize`, never across a sentence end, clause break or paragraph. */
export function frameLength(a: TokenAnalysis, i: number, chunkSize: number): number {
  const n = a.flags.length;
  if (i >= n) return 0;
  const max = Math.min(chunkSize, n - i);
  for (let k = 0; k < max; k++) {
    const f = a.flags[i + k];
    if (k > 0 && f & F_PARA_START) return k;
    if (f & (F_SENTENCE_END | F_CLAUSE | F_PARA_END)) return k + 1;
  }
  return max;
}

/** Largest element of sorted `arr` that is <= x, or -1. */
export function floorIndex(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Value of the largest element <= x (or `fallback`). */
export function floorValue(arr: ArrayLike<number>, x: number, fallback = 0): number {
  const k = floorIndex(arr, x);
  return k >= 0 ? arr[k] : fallback;
}

/** Smallest element > x, or -1. */
export function nextValue(arr: ArrayLike<number>, x: number): number {
  const k = floorIndex(arr, x);
  return k + 1 < arr.length ? arr[k + 1] : -1;
}

// ---------------------------------------------------------------------------
// Public helpers for other screens (e.g. the Settings live preview). Stable API.
// ---------------------------------------------------------------------------

/** The settings that affect pacing. A full `Settings` object can be passed as-is. */
export interface PacingSettings {
  wpm: number;
  smartPacing: boolean;
  punctuationPause: number;
  /** Words per frame (default 1). Only used by `previewFrames`. */
  chunkSize?: number;
}

/**
 * Display time in ms for each token of a short word list, exactly as the reader paces it
 * (same sentence/clause/abbreviation rules and multipliers). The list is treated as one paragraph
 * (its last token gets the paragraph-end pause); multipliers are normalised over the list, so for lists
 * up to 2 × NORMALISE_WINDOW + 1 tokens the durations sum to `words.length * 60000 / wpm`. Soft start is not included.
 *
 * @example tokenDurations(['Hello,', 'world.'], useSettings.getState()) // → [ms, ms]
 */
export function tokenDurations(words: readonly string[], settings: PacingSettings): number[] {
  if (words.length === 0) return [];
  const wpm = Math.max(1, settings.wpm);
  const a = analyzeTokens({ words: words as string[], paragraphStarts: [0], chapters: [] });
  const w = computeWeights(a, settings.smartPacing, settings.punctuationPause);
  return Array.from(w, (x) => (60000 / wpm) * x);
}

/**
 * Like `tokenDurations`, but grouped into frames as the reader shows them with `settings.chunkSize`
 * (never across a sentence end, clause break or paragraph). Each frame's text is ready for `<WordDisplay text>`.
 */
export function previewFrames(words: readonly string[], settings: PacingSettings): { text: string; durationMs: number }[] {
  const per = tokenDurations(words, settings);
  if (!per.length) return [];
  const a = analyzeTokens({ words: words as string[], paragraphStarts: [0], chapters: [] });
  const size = Math.min(3, Math.max(1, Math.round(settings.chunkSize ?? 1)));
  const out: { text: string; durationMs: number }[] = [];
  for (let i = 0; i < words.length; ) {
    const n = Math.max(1, frameLength(a, i, size));
    let d = 0;
    for (let k = 0; k < n; k++) d += per[i + k];
    out.push({ text: words.slice(i, i + n).join(' '), durationMs: d });
    i += n;
  }
  return out;
}
