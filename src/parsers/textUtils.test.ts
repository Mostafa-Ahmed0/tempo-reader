import { describe, expect, it } from 'vitest';
import { decodeBytes, guessSingleByte, sniffUtf16 } from './encoding';
import {
  headingKind,
  joinLines,
  plainParagraphsToBlocks,
  plainTextToSections,
  prettifyHeading,
  sectionsFromBlocks,
  splitPlainParagraphs,
  stripGutenberg,
  titleFromText,
} from './textUtils';

const lorem = (n: number, seed = 'word') => Array.from({ length: n }, (_, i) => `${seed}${i % 7}`).join(' ');

describe('encoding detection', () => {
  it('honours BOMs', () => {
    expect(decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toEqual({ text: 'hi', encoding: 'utf-8' });
    expect(decodeBytes(Uint8Array.from([0xff, 0xfe, 0x68, 0, 0x69, 0])).text).toBe('hi');
    expect(decodeBytes(Uint8Array.from([0xfe, 0xff, 0, 0x68, 0, 0x69])).text).toBe('hi');
  });
  it('accepts strict UTF-8', () => {
    expect(decodeBytes(new TextEncoder().encode('caf\u00E9 \u2014 na\u00EFve'))).toEqual({ text: 'caf\u00E9 \u2014 na\u00EFve', encoding: 'utf-8' });
  });
  it('detects UTF-16 without BOM', () => {
    const s = 'Hello world, this is UTF-16 text without a byte order mark.';
    const le = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) le[i * 2] = s.charCodeAt(i);
    expect(sniffUtf16(le)).toBe('utf-16le');
    expect(decodeBytes(le).text).toBe(s);
    const be = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) be[i * 2 + 1] = s.charCodeAt(i);
    expect(decodeBytes(be).text).toBe(s);
  });
  it('falls back to windows-1252 for invalid UTF-8', () => {
    // "caf\u00E9 \u201Cquoted\u201D" in cp1252
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94]);
    expect(decodeBytes(bytes)).toEqual({ text: 'caf\u00E9 \u201Cq\u201D', encoding: 'windows-1252' });
  });
  it('guesses windows-1251 for Cyrillic', () => {
    // "\u041F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440, \u044D\u0442\u043E \u0442\u0435\u0441\u0442" in cp1251
    const bytes = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0, 0x2c, 0x20, 0xfd, 0xf2, 0xee, 0x20, 0xf2, 0xe5, 0xf1, 0xf2]);
    expect(guessSingleByte(bytes)).toBe('windows-1251');
    expect(decodeBytes(bytes).text).toBe('\u041F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440, \u044D\u0442\u043E \u0442\u0435\u0441\u0442');
  });
  it('uses a charset hint', () => {
    const bytes = Uint8Array.from([0xcf, 0xf0, 0xe8]);
    expect(decodeBytes(bytes, 'windows-1251').text).toBe('\u041F\u0440\u0438');
  });
});

describe('heading detection', () => {
  it.each([
    ['Chapter 12', 'chapter'],
    ['CHAPTER XII.', 'chapter'],
    ['Chapter One: The Beginning', 'chapter'],
    ['Part Two', 'chapter'],
    ['BOOK III', 'chapter'],
    ['Prologue', 'special'],
    ['EPILOGUE', 'special'],
    ['XIV.', 'numeral'],
    ['12', 'numeral'],
  ])('%s -> %s', (line, kind) => expect(headingKind(line)).toBe(kind));
  it.each(['Chapter 3 was the best part of the whole book and everyone agreed on it.', 'part of the reason', 'The chapter ended.', ''])(
    'not a heading: %s',
    (line) => expect(headingKind(line)).toBeNull(),
  );
  it('prettifies all-caps headings', () => {
    expect(prettifyHeading('CHAPTER XII. THE STORM')).toBe('Chapter XII. The Storm');
    expect(prettifyHeading('Chapter 1: Mixed Case')).toBe('Chapter 1: Mixed Case');
    expect(prettifyHeading('IV')).toBe('IV');
  });
});

describe('plain-text paragraphs', () => {
  it('rejoins Gutenberg-style hard wraps and dehyphenates', () => {
    const text = 'It was a bright cold day in April, and the clocks were\nstriking thirteen. Winston Smith, his chin nuzzled into his\nbreast, slipped quickly through the glass doors of Vic-\ntory Mansions.\n\nThe hallway smelt of boiled cabbage and old rag mats. At\none end of it a coloured poster had been tacked.\n';
    expect(splitPlainParagraphs(text)).toEqual([
      'It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast, slipped quickly through the glass doors of Victory Mansions.',
      'The hallway smelt of boiled cabbage and old rag mats. At one end of it a coloured poster had been tacked.',
    ]);
  });
  it('splits on indentation when there are no blank lines', () => {
    const text =
      '    The first paragraph starts here and it goes on for quite a\nwhile across several wrapped lines of roughly equal length to\nlook like a typical book.\n    The second paragraph is indented as well and continues on\nthe next line too, just like the first one did before it.';
    const paras = splitPlainParagraphs(text);
    expect(paras).toHaveLength(2);
    expect(paras[1]).toMatch(/^The second paragraph/);
  });
  it('treats long unwrapped lines as paragraphs', () => {
    const a = lorem(60, 'alpha');
    const b = lorem(60, 'beta');
    expect(splitPlainParagraphs(`${a}\n${b}\n`)).toEqual([a, b]);
  });
  it('keeps Anglo-Saxon style hyphens', () => {
    expect(joinLines(['the Anglo-', 'Saxon kings'])).toBe('the Anglo-Saxon kings');
  });
  it('strips the Gutenberg header/footer and reads title/author', () => {
    const g = stripGutenberg(
      'The Project Gutenberg eBook of Moby Dick\n\nTitle: Moby Dick\nAuthor: Herman Melville\n\n*** START OF THE PROJECT GUTENBERG EBOOK MOBY DICK ***\n\nCall me Ishmael.\n\n*** END OF THE PROJECT GUTENBERG EBOOK MOBY DICK ***\nLicense text',
    );
    expect(g).toEqual({ text: '\n\nCall me Ishmael.\n\n', title: 'Moby Dick', author: 'Herman Melville' });
  });
});

describe('sections', () => {
  it('splits plain text at chapter headings and merges subtitle lines', () => {
    const text = `Some Book\n\nCHAPTER I.\n\nThe Boy Who Lived\n\n${lorem(80)}\n\n${lorem(30)}\n\nCHAPTER II.\n\nThe Vanishing Glass\n\n${lorem(80)}\n`;
    const s = plainTextToSections(text);
    expect(s.map((x) => x.title)).toEqual(['Chapter I: The Boy Who Lived', 'Chapter II: The Vanishing Glass']);
    expect(s[0].text.startsWith('Some Book\n\n')).toBe(true); // short front text kept in chapter 1
    expect(s[0].text.split('\n\n')).toHaveLength(3);
  });
  it('ignores a table of contents run of headings', () => {
    const toc = 'CONTENTS\n\nChapter 1\n\nChapter 2\n\nChapter 3\n\n';
    const body = `Chapter 1\n\n${lorem(60)}\n\nChapter 2\n\n${lorem(60)}\n\nChapter 3\n\n${lorem(60)}\n`;
    const s = plainTextToSections(toc + body);
    expect(s.map((x) => x.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(s[0].text).toMatch(/^Contents\n\nChapter 1\n\nChapter 2\n\nChapter 3\n\n/);
  });
  it('uses bare roman numerals only when there are several', () => {
    const blocks = plainParagraphsToBlocks(['I', lorem(50), 'II', lorem(50), 'III', lorem(50)]);
    expect(blocks.filter((b) => b.kind === 'h')).toHaveLength(3);
    expect(plainParagraphsToBlocks(['I', lorem(50)]).filter((b) => b.kind === 'h')).toHaveLength(0);
  });
  it('chooses the split level and treats a lone top heading as the title', () => {
    const s = sectionsFromBlocks([
      { kind: 'h', level: 1, text: 'My Book' },
      { kind: 'h', level: 2, text: 'One' },
      { kind: 'p', text: 'a' },
      { kind: 'h', level: 3, text: 'Sub' },
      { kind: 'p', text: 'b' },
      { kind: 'h', level: 2, text: 'Two' },
      { kind: 'p', text: 'c' },
    ]);
    expect(s).toEqual([
      { title: 'One', text: 'a\n\nSub\n\nb' },
      { title: 'Two', text: 'c' },
    ]);
  });
  it('splits long parts at chapters and combines part + chapter headings', () => {
    const long = lorem(4000);
    const s = sectionsFromBlocks([
      { kind: 'h', level: 1, text: 'Part One' },
      { kind: 'h', level: 2, text: 'Chapter 1' },
      { kind: 'p', text: long },
      { kind: 'h', level: 2, text: 'Chapter 2' },
      { kind: 'p', text: long },
      { kind: 'h', level: 1, text: 'Part Two' },
      { kind: 'h', level: 2, text: 'Chapter 3' },
      { kind: 'p', text: long },
      { kind: 'h', level: 2, text: 'Chapter 4' },
      { kind: 'p', text: long },
    ]);
    expect(s.map((x) => x.title)).toEqual(['Part One: Chapter 1', 'Chapter 2', 'Part Two: Chapter 3', 'Chapter 4']);
  });
  it('keeps short parts as sections (sub-headings stay in the text)', () => {
    const s = sectionsFromBlocks([
      { kind: 'h', level: 1, text: 'Intro' },
      { kind: 'p', text: 'x' },
      { kind: 'h', level: 2, text: 'Detail' },
      { kind: 'p', text: 'y' },
      { kind: 'h', level: 1, text: 'Next' },
      { kind: 'p', text: 'z' },
    ]);
    expect(s).toEqual([
      { title: 'Intro', text: 'x\n\nDetail\n\ny' },
      { title: 'Next', text: 'z' },
    ]);
  });
  it('title from text', () => {
    expect(titleFromText('Hello there\n\nMore')).toBe('Hello there');
    expect(titleFromText('one two three four five six seven eight')).toBe('one two three four five six\u2026');
  });
});
