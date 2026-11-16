import { describe, expect, it } from 'vitest';
import { countWords, MAX_TOKEN_LENGTH, normalizeText, tokenize } from './tokenizer';
import type { ParsedSection } from './types';

const one = (text: string, title = 'One'): ParsedSection[] => [{ title, text }];
const words = (text: string) => tokenize(one(text)).words;
const len = (s: string) => Array.from(s).length;

describe('tokenize: basics', () => {
  it('splits on whitespace and keeps punctuation attached', () => {
    expect(words('Hello, world! "Quoted" (paren) end.')).toEqual(['Hello,', 'world!', '"Quoted"', '(paren)', 'end.']);
  });

  it('collapses runs of whitespace, tabs and single newlines', () => {
    expect(words('  a\t\tb \n c   d  ')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns empty structures for empty input', () => {
    expect(tokenize([])).toEqual({ words: [], paragraphStarts: [], chapters: [] });
    expect(tokenize(one('   \n\n  '))).toEqual({ words: [], paragraphStarts: [], chapters: [] });
  });

  it('records paragraph starts at blank lines (first is 0)', () => {
    const t = tokenize(one('one two\n\nthree\n  \nfour five six\n\n\n\nseven'));
    expect(t.words).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    expect(t.paragraphStarts).toEqual([0, 2, 3, 6]);
  });

  it('handles CRLF and \\r line endings for paragraphs', () => {
    const t = tokenize(one('a b\r\n\r\nc\r\rd'));
    expect(t.words).toEqual(['a', 'b', 'c', 'd']);
    expect(t.paragraphStarts).toEqual([0, 2, 3]);
  });

  it('treats U+2029 as a paragraph separator', () => {
    expect(tokenize(one('a\u2029b')).paragraphStarts).toEqual([0, 1]);
  });
});

describe('tokenize: chapters', () => {
  it('creates one chapter per non-empty section with correct word indexes', () => {
    const t = tokenize([
      { title: 'Intro', text: 'a b c' },
      { title: 'Empty', text: '  \n\n ' },
      { title: 'Two', text: 'd e' },
      { title: '', text: 'f' },
      { title: 'Also empty', text: '' },
    ]);
    expect(t.words).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(t.chapters).toEqual([
      { title: 'Intro', wordIndex: 0 },
      { title: 'Two', wordIndex: 3 },
      { title: 'Section 3', wordIndex: 5 },
    ]);
    expect(t.paragraphStarts).toEqual([0, 3, 5]);
  });

  it('section boundaries are paragraph boundaries even without blank lines', () => {
    const t = tokenize([
      { title: 'A', text: 'x y' },
      { title: 'B', text: 'z' },
    ]);
    expect(t.paragraphStarts).toEqual([0, 2]);
  });

  it('keeps chapters and paragraphs sorted and strictly increasing', () => {
    const sections = Array.from({ length: 50 }, (_, i) => ({ title: `C${i}`, text: i % 3 === 0 ? '' : 'w '.repeat(i) + '\n\n' + 'v '.repeat(i % 5) }));
    const t = tokenize(sections);
    for (let i = 1; i < t.chapters.length; i++) expect(t.chapters[i].wordIndex).toBeGreaterThan(t.chapters[i - 1].wordIndex);
    for (let i = 1; i < t.paragraphStarts.length; i++) expect(t.paragraphStarts[i]).toBeGreaterThan(t.paragraphStarts[i - 1]);
    for (const c of t.chapters) expect(t.paragraphStarts).toContain(c.wordIndex);
  });
});

describe('tokenize: normalisation', () => {
  it('removes zero-width characters, BOM and soft hyphens', () => {
    expect(words('\uFEFFhel\u00ADlo wo\u200Brld \u2060x')).toEqual(['hello', 'world', 'x']);
  });

  it('treats NBSP, thin, em and ideographic spaces as whitespace', () => {
    expect(words('a\u00A0b\u2009c\u2003d\u3000e\u202Ff')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('rejoins words hyphenated across line ends', () => {
    expect(words('an exam-\nple of hyphen-\n  ation')).toEqual(['an', 'example', 'of', 'hyphenation']);
    expect(words('exam-\r\nple')).toEqual(['example']);
    expect(words('soft\u00AD\nhyphen')).toEqual(['softhyphen']);
  });

  it('keeps the hyphen when the continuation is capitalised', () => {
    expect(words('the Anglo-\nSaxon era')).toEqual(['the', 'Anglo-Saxon', 'era']);
  });

  it('does not rejoin across paragraph breaks or for real hyphenated words on one line', () => {
    expect(words('end-\n\nstart')).toEqual(['end-', 'start']);
    expect(words('well-known fact')).toEqual(['well-known', 'fact']);
  });

  it('normalizeText is idempotent', () => {
    const s = 'a\r\nb-\nc\u00A0d\u200B\n\ne';
    expect(normalizeText(normalizeText(s))).toBe(normalizeText(s));
  });
});

describe('tokenize: dashes', () => {
  it('splits em-dash-joined words, keeping the dash on the left word', () => {
    expect(words('word—word—word')).toEqual(['word—', 'word—', 'word']);
    expect(words('wait―what')).toEqual(['wait―', 'what']);
  });

  it('keeps a leading dash attached to the following word', () => {
    expect(words('—Yes, he said')).toEqual(['—Yes,', 'he', 'said']);
  });

  it('attaches a free-standing dash to the previous word', () => {
    expect(words('this — that')).toEqual(['this—', 'that']);
    expect(words('this -- that')).toEqual(['this--', 'that']);
  });

  it('keeps a free-standing dash at paragraph start as its own token', () => {
    expect(words('—')).toEqual(['—']);
  });

  it('keeps en-dash ranges together', () => {
    expect(words('1990–2000')).toEqual(['1990–2000']);
  });
});

describe('tokenize: long tokens', () => {
  it('splits URLs at break characters so no token exceeds the limit', () => {
    const url = 'https://example.com/some/very/long/path/to/a/resource?query=value&other=thing';
    const t = words(url);
    expect(t.length).toBeGreaterThan(1);
    expect(t.join('')).toBe(url);
    for (const w of t) expect(len(w)).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
  });

  it('hard-splits long tokens without break characters', () => {
    const s = 'a'.repeat(75);
    const t = words(s);
    expect(t).toEqual(['a'.repeat(30), 'a'.repeat(30), 'a'.repeat(15)]);
  });

  it('does not touch tokens at the limit', () => {
    const s = 'b'.repeat(MAX_TOKEN_LENGTH);
    expect(words(s)).toEqual([s]);
  });

  it('long em-dash chains become separate words', () => {
    const t = words('supercalifragilistic—expialidocious—again—and—again');
    expect(t).toEqual(['supercalifragilistic—', 'expialidocious—', 'again—', 'and—', 'again']);
  });

  it('does not split surrogate pairs', () => {
    const s = '😀'.repeat(40);
    const t = words(s);
    expect(t.join('')).toBe(s);
    for (const w of t) {
      expect(len(w)).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
      expect(w).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });
});

describe('tokenize: non-Latin text', () => {
  it('handles German umlauts and ß', () => {
    expect(words('Über die Brücke gehen Mädchen, Jungen und Großväter.')).toEqual([
      'Über',
      'die',
      'Brücke',
      'gehen',
      'Mädchen,',
      'Jungen',
      'und',
      'Großväter.',
    ]);
  });

  it('rejoins German hyphenation across lines', () => {
    expect(words('Donaudampf-\nschifffahrt')).toEqual(['Donaudampfschifffahrt']);
  });

  it('handles Arabic (with diacritics and RTL marks)', () => {
    expect(words('\u200Fمرحبا بالعالم، كيف حالك؟')).toEqual(['مرحبا', 'بالعالم،', 'كيف', 'حالك؟']);
    expect(words('بِسْمِ اللَّهِ')).toEqual(['بِسْمِ', 'اللَّهِ']);
  });

  it('chunks Chinese text without spaces', () => {
    const t = words('我爱自然语言处理技术。');
    expect(t.join('')).toBe('我爱自然语言处理技术。');
    expect(t).toEqual(['我爱自', '然语言', '处理技', '术。']);
  });

  it('keeps CJK punctuation with its neighbours', () => {
    const t = words('「こんにちは」と言った。');
    expect(t.join('')).toBe('「こんにちは」と言った。');
    expect(t[0].startsWith('「')).toBe(true);
    expect(t.some((w) => /^[」。、]/.test(w))).toBe(false);
    for (const w of t) expect(len(w)).toBeLessThanOrEqual(6);
  });

  it('separates Latin and CJK runs in a mixed token', () => {
    expect(words('iPhone的价格是999元')).toEqual(['iPhone', '的价格', '是', '999', '元']);
  });

  it('leaves Korean (space-delimited) alone', () => {
    expect(words('안녕하세요 세계')).toEqual(['안녕하세요', '세계']);
  });

  it('handles Cyrillic and Greek', () => {
    expect(words('Привет, мир! Γειά σου κόσμε')).toEqual(['Привет,', 'мир!', 'Γειά', 'σου', 'κόσμε']);
  });
});

describe('countWords', () => {
  it('equals tokenize().words.length across tricky inputs', () => {
    const inputs: ParsedSection[][] = [
      [],
      one(''),
      one('simple words here'),
      one('exam-\nple word—word —lead 1990–2000 https://example.com/a/b/c/d/e/f/g/h/i/j/k/l/m/n'),
      one('我爱自然语言处理技术。「こんにちは」'),
      [
        { title: 'a', text: 'x\n\ny' },
        { title: 'b', text: '' },
        { title: 'c', text: 'مرحبا بالعالم' },
      ],
    ];
    for (const s of inputs) expect(countWords(s)).toBe(tokenize(s).words.length);
  });
});

describe('performance', () => {
  it('tokenizes a 300k-word book well under a second', () => {
    const vocab = ['the', 'quick,', 'brown', 'fox—jumps', 'over', 'lazy', 'dog.', 'Über', 'مرحبا', 'exam-\nple', '“quoted”'];
    const sections: ParsedSection[] = [];
    for (let s = 0; s < 60; s++) {
      const parts: string[] = [];
      for (let i = 0; i < 5000; i++) {
        parts.push(vocab[(i * 7 + s) % vocab.length]);
        if (i % 120 === 119) parts.push('\n\n');
      }
      sections.push({ title: `Chapter ${s + 1}`, text: parts.join(' ') });
    }
    const t0 = performance.now();
    const t = tokenize(sections);
    const elapsed = performance.now() - t0;
    expect(t.words.length).toBeGreaterThan(300_000);
    expect(t.chapters).toHaveLength(60);
    expect(elapsed).toBeLessThan(1000);
  });
});
