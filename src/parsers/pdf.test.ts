// @vitest-environment node
// pdf.js runs in Node (fake worker), so the PDF path is tested end to end on hand-built PDFs.
// Cover rendering needs a DOM canvas and is NOT covered here.
import { describe, expect, it } from 'vitest';
import { pageAt, pageMapOf } from '../core/pages';
import { tokenize } from '../core/tokenizer';
import { buildPdf, fileOf, textPages } from './__fixtures__/builders';
import { ParseError, parseFile } from './index';
import { pageStartsFromBlocks, pickAuthor, pickTitle } from './pdf';
import { type PdfBlock, type PdfItem, findGutter, isPageNumber, itemsToLines, layoutPages, orderLines } from './pdfLayout';

const W = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i % 9}`).join(' ');
/** Item with a width estimate of 0.5em per char. */
const it_ = (str: string, x: number, y: number, size = 10): PdfItem => ({ str, x, y, size, width: str.length * size * 0.5 });

describe('pdf layout (synthetic items)', () => {
  it('joins items on a baseline, inserting spaces from gaps', () => {
    const lines = itemsToLines([it_('Hello', 72, 700), it_('world', 72 + 25 + 3, 700.4), it_('next', 72, 686)]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'next']);
  });
  it('paragraphs from y-gaps and first-line indents; dehyphenation', () => {
    const page = {
      width: 612,
      height: 792,
      items: [
        it_('The first paragraph runs across the whole line and', 72, 700),
        it_('continues here with a hyphen- ated word in it, and still', 72, 688),
        it_('ends short.', 72, 676),
        it_('A new paragraph after a vertical gap, which goes on to', 72, 650),
        it_('fill the line nicely until the right margin of the pa-', 72, 638),
        it_('ge.', 72, 626),
        it_('Indented paragraph starts here and also fills the line', 90, 614),
        it_('to the right margin of the text block for sure, yes.', 72, 602),
      ],
    };
    const { blocks } = layoutPages([page]);
    expect(blocks.map((b) => b.text)).toEqual([
      'The first paragraph runs across the whole line and continues here with a hyphen- ated word in it, and still ends short.',
      'A new paragraph after a vertical gap, which goes on to fill the line nicely until the right margin of the page.',
      'Indented paragraph starts here and also fills the line to the right margin of the text block for sure, yes.',
    ]);
  });
  it('detects two columns and reads left column before right', () => {
    const items: PdfItem[] = [it_('A Title Spanning Both Columns Of The Page Here', 150, 740, 14)];
    for (let i = 0; i < 20; i++) {
      items.push(it_(`left ${String(i).padStart(2, '0')} lorem ipsum dolor sit amet ok`, 50, 700 - i * 12));
      items.push(it_(`right ${String(i).padStart(2, '0')} lorem ipsum dolor sit amet`, 320, 700 - i * 12));
    }
    const lines = orderLines(itemsToLines(items), 612);
    expect(findGutter(itemsToLines(items), 612)).not.toBeNull();
    const texts = lines.map((l) => l.text);
    expect(texts[0]).toMatch(/^A Title/);
    expect(texts.indexOf('left 19 lorem ipsum dolor sit amet ok')).toBeLessThan(texts.indexOf('right 00 lorem ipsum dolor sit amet'));
    // single column page: no gutter
    const single = Array.from({ length: 20 }, (_, i) => it_(W(14), 72, 700 - i * 12));
    expect(findGutter(itemsToLines(single), 612)).toBeNull();
  });
  it('drops running headers, page numbers, and joins paragraphs across pages', () => {
    const pages = [0, 1, 2, 3].map((p) => ({
      width: 612,
      height: 792,
      items: [
        it_('The Running Header', 250, 760, 9),
        it_(p === 0 ? 'Start of a sentence that runs over the full width and' : 'Body text line that is long enough to fill the measure ok', 72, 700),
        it_(p === 0 ? 'continues until the bottom of the page without a stop' : 'Second line of the body text that also fills the measure.', 72, 688),
        it_(String(p + 1), 300, 30, 9),
      ],
    }));
    pages[1].items[1] = it_('and ends on the next page, after which comes the fill', 72, 700);
    const { blocks } = layoutPages(pages);
    const all = blocks.map((b) => b.text).join('\n');
    expect(all).not.toMatch(/Running Header/);
    expect(all).not.toMatch(/^\d+$/m);
    expect(blocks[0].text).toMatch(/without a stop and ends on the next page/);
  });
  it('marks large-font lines as headings', () => {
    const { blocks } = layoutPages([
      { width: 612, height: 792, items: [it_('Chapter Heading', 72, 720, 20), ...Array.from({ length: 6 }, (_, i) => it_(W(10), 72, 690 - i * 12))] },
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'h', text: 'Chapter Heading' });
    expect(blocks[1].kind).toBe('p');
  });
  it('page numbers and metadata junk', () => {
    for (const s of ['12', '- 12 -', 'Page 3', 'page 3 of 10', 'xiv', '[7]']) expect(isPageNumber(s)).toBe(true);
    expect(isPageNumber('12 Angry Men')).toBe(false);
    expect(pickTitle(['Microsoft Word - thesis_final.docx', 'Real Title'])).toBe('Real Title');
    expect(pickTitle(['untitled', 'report.pdf', '  '])).toBe('');
    expect(pickAuthor(['Administrator', 'Jane Doe'])).toBe('Jane Doe');
  });
});

const para = (n: number, w: string) => {
  // wrap n words into ~11-word lines
  const words = W(n, w).split(' ');
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 11) lines.push(words.slice(i, i + 11).join(' '));
  lines[lines.length - 1] += '.';
  return lines;
};

describe('PDF end to end (pdf.js in Node)', () => {
  it('extracts paragraphs, drops headers/page numbers, uses the outline and metadata', async () => {
    const pages = textPages([para(120, 'alpha'), para(60, 'beta'), para(150, 'gamma'), para(80, 'delta')], { header: 'My Running Header', pageNumbers: true, linesPerPage: 12 });
    const pdf = buildPdf({
      pages,
      info: { Title: 'Microsoft Word - draft.docx', Author: 'P. Author' },
      outline: [
        { title: 'Opening', page: 0 },
        { title: 'Later Part', page: 2 },
      ],
    });
    const progress: number[] = [];
    const book = await parseFile(fileOf(pdf, 'real_title.pdf'), (f) => progress.push(f));
    expect(book.title).toBe('real title'); // junk metadata title ignored
    expect(book.author).toBe('P. Author');
    expect(book.sections.map((s) => s.title)).toEqual(['Opening', 'Later Part']);
    const all = book.sections.map((s) => s.text).join('\n\n');
    expect(all).not.toMatch(/Running Header/);
    expect(all.split('\n\n').every((p) => !/^\d+$/.test(p))).toBe(true);
    expect(all).toMatch(/^alpha0 alpha1/);
    expect(progress.length).toBeGreaterThan(pages.length);
    expect(progress.at(-1)).toBe(1);
    // paragraphs survive (4 source paragraphs; some may span pages but must be re-joined)
    expect(all.split('\n\n').filter((p) => /^(alpha|beta|gamma|delta)0/.test(p))).toHaveLength(4);
  });
  it('without an outline, splits on chapter headings', async () => {
    const pages = [
      { texts: [{ x: 72, y: 720, size: 20, text: 'Chapter 1' }, ...para(160, 'one').map((t, i) => ({ x: 72, y: 690 - i * 14, text: t }))] },
      { texts: [{ x: 72, y: 720, size: 20, text: 'Chapter 2' }, ...para(160, 'two').map((t, i) => ({ x: 72, y: 690 - i * 14, text: t }))] },
    ];
    const book = await parseFile(fileOf(buildPdf({ pages, info: { Title: 'Heading Book' } }), 'h.pdf'));
    expect(book.title).toBe('Heading Book');
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(book.sections[1].text).toMatch(/^two0/);
  });
  it('long PDFs without structure are split into page ranges', async () => {
    const pages = Array.from({ length: 45 }, (_, p) => ({ texts: para(40, `p${p}w`).map((t, i) => ({ x: 72, y: 700 - i * 14, text: t })) }));
    const book = await parseFile(fileOf(buildPdf({ pages }), 'long.pdf'));
    expect(book.sections.map((s) => s.title)).toEqual(['Pages 1–20', 'Pages 21–40', 'Pages 41–45']);
  });
  it('scanned PDF (no text layer) -> clear error', async () => {
    const pdf = buildPdf({ pages: [{ texts: [], rect: true }, { texts: [], rect: true }] });
    const err = await parseFile(fileOf(pdf, 'scan.pdf')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).code).toBe('scanned');
    expect((err as Error).message).toMatch(/OCR/);
  });
  it('password-protected PDF -> clear error', async () => {
    const pdf = buildPdf({ pages: [{ texts: [{ x: 72, y: 700, text: 'secret' }] }], encrypted: true });
    const err = await parseFile(fileOf(pdf, 'locked.pdf')).catch((e: unknown) => e);
    expect((err as ParseError).code).toBe('password');
  });
  it('mis-named PDF is detected by magic bytes', async () => {
    const pdf = buildPdf({ pages: [{ texts: para(30, 'x').map((t, i) => ({ x: 72, y: 700 - i * 14, text: t })) }] });
    const book = await parseFile(fileOf(pdf, 'download.txt'));
    expect(book.sections[0].text).toMatch(/^x0 x1/);
  });
});

const lines = (ls: string[], y0 = 700) => ls.map((t, i) => ({ x: 72, y: y0 - i * 14, text: t }));
/** First word of each page, as the reader would show it at that page's start. */
const firstWords = (words: string[], starts: number[]) => starts.map((s) => words[s]);

describe('PDF pages', () => {
  it('records one start per page, in the reader word space; blank pages still count', async () => {
    const pages = Array.from({ length: 12 }, (_, p) => (p === 4 || p === 5 ? { texts: [], rect: true } : { texts: lines(para(40, `p${p}w`)) }));
    const book = await parseFile(fileOf(buildPdf({ pages }), 'pages.pdf'));
    const words = tokenize(book.sections).words;
    expect(book.pageStarts).toHaveLength(12);
    const starts = book.pageStarts!;
    expect(starts[0]).toBe(0);
    for (let p = 1; p < 12; p++) expect(starts[p]).toBeGreaterThanOrEqual(starts[p - 1]);
    for (const p of [0, 1, 2, 3, 6, 7, 11]) expect(words[starts[p]]).toBe(`p${p}w0`);
    // the blank pages 5 and 6 (index 4, 5) begin where page 7 begins, so no word is ever "on" them...
    expect(starts[4]).toBe(starts[6]);
    expect(starts[5]).toBe(starts[6]);
    // ...and every word of page 7 is reported as page 7 (1-based), exactly like the PDF
    const map = pageMapOf({ wordCount: words.length, pageStarts: starts });
    expect(map).toMatchObject({ exact: true, total: 12 });
    expect(pageAt(map, starts[6])).toBe(7);
    expect(pageAt(map, starts[6] - 1)).toBe(4);
    expect(pageAt(map, words.length)).toBe(12);
  });
  it('a page that starts mid-paragraph starts at its first word, also after a hyphenated join', async () => {
    const full = (w: string, n = 11) => Array.from({ length: n }, (_, i) => `${w}${i % 9}`).join(' ');
    const pages = [
      { texts: lines([full('aa'), full('aa'), full('aa'), `${full('aa', 10)} exam-`]) },
      { texts: lines([`ple ${full('bb', 10)}`, full('bb'), full('bb'), full('bb')]) },
      { texts: lines([full('cc'), full('cc'), full('cc'), `${full('cc', 10)} end.`]) },
    ];
    // page 2 continues page 1's paragraph (hyphenated word split across the break)
    const book = await parseFile(fileOf(buildPdf({ pages }), 'join.pdf'));
    const words = tokenize(book.sections).words;
    expect(book.sections.map((s) => s.text).join('\n\n').split('\n\n')[0]).toMatch(/aa0 example bb0 .* bb1$/); // one joined paragraph
    expect(words).toContain('example');
    // "example" began on page 1, so page 2 starts at the word after it
    expect(firstWords(words, book.pageStarts!)).toEqual(['aa0', 'bb0', 'cc0']);
    expect(words[book.pageStarts![1] - 1]).toBe('example');
  });
  it('headings used as chapter titles are skipped when locating pages', async () => {
    const pages = [
      { texts: [{ x: 72, y: 720, size: 20, text: 'Chapter 1' }, ...lines(para(160, 'one'), 690)] },
      { texts: [{ x: 72, y: 720, size: 20, text: 'Chapter 2' }, ...lines(para(160, 'two'), 690)] },
    ];
    const book = await parseFile(fileOf(buildPdf({ pages }), 'h.pdf'));
    const words = tokenize(book.sections).words;
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(firstWords(words, book.pageStarts!)).toEqual(['one0', 'two0']);
  });
  it('with an outline, headers and page numbers', async () => {
    const pages = textPages([para(120, 'alpha'), para(60, 'beta'), para(150, 'gamma'), para(80, 'delta')], { header: 'My Running Header', pageNumbers: true, linesPerPage: 12 });
    const pdf = buildPdf({ pages, outline: [{ title: 'Opening', page: 0 }, { title: 'Later Part', page: 2 }] });
    const book = await parseFile(fileOf(pdf, 'o.pdf'));
    const words = tokenize(book.sections).words;
    expect(book.pageStarts).toHaveLength(pages.length);
    // the first word of each page in the source file
    const expected = pages.map((p) => p.texts.find((t) => t.x === 72)!.text.split(' ')[0].replace(/\.$/, ''));
    expect(firstWords(words, book.pageStarts!).map((w) => w.replace(/\.$/, ''))).toEqual(expected);
  });
  it('pageStartsFromBlocks resyncs after a block that is not in the text', () => {
    const blk = (text: string, page: number, kind: 'p' | 'h' = 'p'): PdfBlock => ({ kind, text, page, y: 700, size: 10 });
    // "Intro" is a title (not in the text) that also appears as a word further on
    const blocks = [blk('Intro', 0, 'h'), blk('first page words here', 0), blk('more Intro text', 0), blk('second page', 1)];
    const sections = [{ title: 'Intro', text: 'first page words here\n\nmore Intro text\n\nsecond page' }];
    expect(pageStartsFromBlocks(blocks, sections, 3)).toEqual([0, 7, 9]); // page 3 has no text: starts at the end
  });
});
