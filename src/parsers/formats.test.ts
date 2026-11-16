import { describe, expect, it } from 'vitest';
import { countWords } from '../core/tokenizer';
import {
  buildDoc,
  buildDocx,
  buildEpub,
  buildMobi,
  buildOdt,
  fileOf,
  mobiRecords,
  palmDb,
  utf8,
  zipOf,
} from './__fixtures__/builders';
import { ParseError, UnsupportedFormatError, detectFormatAsync, parseFile, parsePastedText } from './index';
import { HuffCdic, palmDocDecompress, trailingSize } from './mobi';
import { palmDocCompress } from './__fixtures__/builders';

const words = (n: number, w = 'lorem') => Array.from({ length: n }, (_, i) => `${w}${i % 9}`).join(' ');
const expectParseError = async (p: Promise<unknown>, code: string, msg?: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ParseError);
  expect((err as ParseError).code).toBe(code);
  if (msg) expect((err as Error).message).toMatch(msg);
  expect((err as Error).message.length).toBeLessThan(220); // toast-sized
};

// ---------------------------------------------------------------------------
describe('TXT / MD / paste', () => {
  it('parses a hard-wrapped txt with chapters', async () => {
    const txt = `CHAPTER 1\n\n${words(12)}\n${words(12)}\n${words(5)}.\n\n${words(30)}\n\nCHAPTER 2\n\n${words(40)}\n`;
    const book = await parseFile(fileOf(txt, 'novel.txt', 'text/plain'));
    expect(book.title).toBe('novel');
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(book.sections[0].text.split('\n\n')).toHaveLength(2);
    expect(book.sections[0].text).not.toContain('\n ');
  });
  it('decodes a windows-1252 txt', async () => {
    const bytes = Uint8Array.from([...utf8('Caf'), 0xe9, ...utf8(' au lait')]);
    const book = await parseFile(fileOf(bytes, 'cafe.txt'));
    expect(book.sections[0].text).toBe('Caf\u00E9 au lait');
  });
  it('decodes a UTF-16LE txt with BOM', async () => {
    const s = 'Hello UTF-16';
    const bytes = new Uint8Array(2 + s.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < s.length; i++) bytes[2 + i * 2] = s.charCodeAt(i);
    expect((await parseFile(fileOf(bytes, 'u.txt'))).sections[0].text).toBe(s);
  });
  it('uses Gutenberg metadata', async () => {
    const txt = `Title: Alice\nAuthor: Lewis Carroll\n\n*** START OF THE PROJECT GUTENBERG EBOOK ALICE ***\n\n${words(50)}\n\n*** END OF THE PROJECT GUTENBERG EBOOK ALICE ***\nlicense`;
    const book = await parseFile(fileOf(txt, 'pg11.txt'));
    expect(book).toMatchObject({ title: 'Alice', author: 'Lewis Carroll' });
    expect(book.sections[0].text).not.toMatch(/GUTENBERG|license/);
  });
  it('strips markdown and splits on headings', async () => {
    const md = `---\ntitle: "My Notes"\nauthor: Ann\n---\n# My Notes\n\n## First\n\nSome **bold** and _italic_ text with a [link](http://x.y) and \`code\`.\n\n- item one\n- item two\n\n![img](a.png)\n\n## Second\n\n> quoted text\n> more\n\n\`\`\`\nconst x = 1;\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n${words(30)}`;
    const book = await parseFile(fileOf(md, 'notes.md'));
    expect(book.title).toBe('My Notes');
    expect(book.author).toBe('Ann');
    expect(book.sections.map((s) => s.title)).toEqual(['First', 'Second']);
    expect(book.sections[0].text).toBe('Some bold and italic text with a link and code.\n\nitem one\n\nitem two');
    expect(book.sections[1].text).toContain('quoted text more');
    expect(book.sections[1].text).toContain('const x = 1;');
    expect(book.sections[1].text).not.toMatch(/[*_`#|>]/);
  });
  it('parsePastedText: paragraphs, chapters and default title', () => {
    const book = parsePastedText(`Chapter 1\n\n${words(30)}\n\nChapter 2\n\n${words(30)}`);
    expect(book.title).toBe('Chapter 1');
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    const p = parsePastedText('The quick brown fox jumps over the lazy dog again\nand again.');
    expect(p.title).toBe('The quick brown fox jumps over\u2026');
    expect(p.sections).toHaveLength(1);
    expect(parsePastedText('   ').sections).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('HTML', () => {
  it('converts blocks, drops chrome and scripts, splits on headings', async () => {
    const html = `<!doctype html><html><head><meta charset="windows-1252"><title>Web Book</title><meta name="author" content="Jo"><style>p{}</style></head>
      <body><nav>Home | About</nav><h1>Chapter One</h1><p>First <b>para</b><sup><a href="#n1">1</a></sup>.</p><p>Second<br>line</p><script>evil()</script>
      <h1>Chapter Two</h1><ul><li>A</li><li>B</li></ul><table><tr><td>x</td><td>y</td></tr></table><footer>(c) site</footer></body></html>`;
    const book = await parseFile(fileOf(html, 'page.html'));
    expect(book.title).toBe('Web Book');
    expect(book.author).toBe('Jo');
    expect(book.sections).toEqual([
      { title: 'Chapter One', text: 'First para.\n\nSecond\n\nline' },
      { title: 'Chapter Two', text: 'A\n\nB\n\nx y' },
    ]);
  });
  it('respects the meta charset', async () => {
    const bytes = Uint8Array.from([...utf8('<html><head><meta charset="windows-1251"></head><body><p>'), 0xcf, 0xf0, 0xe8, ...utf8('</p></body></html>')]);
    expect((await parseFile(fileOf(bytes, 'ru.htm'))).sections[0].text).toBe('\u041F\u0440\u0438');
  });
});

// ---------------------------------------------------------------------------
describe('RTF', () => {
  it('handles groups, destinations, escapes, unicode and headings', async () => {
    const rtf =
      String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Times;}{\f1\fcharset204 Arial Cyr;}}{\colortbl;\red0\green0\blue0;}` +
      String.raw`{\stylesheet{\s0 Normal;}{\s1 heading 1;}}{\info{\title The RTF Book}{\author R. Author}}{\*\generator Foo;}` +
      String.raw`{\header Running header}\pard\s1 Chapter One\par\pard Caf\'e9 \u8212? dash and {\b bold}\~text\par` +
      String.raw`{\pict\pngblip 89504e470d0a}{\field{\*\fldinst HYPERLINK "x"}{\fldrslt link text}}\par` +
      String.raw`{\f1 \'cf\'f0\'e8}\par\pard\s1 Chapter Two\par\pard Line\line next\tab tabbed\par}`;
    const book = await parseFile(fileOf(rtf, 'doc.rtf'));
    expect(book.title).toBe('The RTF Book');
    expect(book.author).toBe('R. Author');
    expect(book.sections).toEqual([
      { title: 'Chapter One', text: 'Caf\u00E9 \u2014 dash and bold text\n\nlink text\n\n\u041F\u0440\u0438' },
      { title: 'Chapter Two', text: 'Line\n\nnext tabbed' },
    ]);
  });
  it('falls back to plain chapter heuristics without heading styles', async () => {
    const rtf = String.raw`{\rtf1\ansi Chapter 1\par ` + words(30) + String.raw`\par Chapter 2\par ` + words(30) + '}';
    const book = await parseFile(fileOf(rtf, 'x.rtf'));
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });
  it('rejects garbage', async () => {
    await expectParseError(parseFile(fileOf('{\\rtx not rtf', 'bad.rtf')), 'corrupt');
  });
});

// ---------------------------------------------------------------------------
const FB2 = (encoding = 'utf-8', extra = '') => `<?xml version="1.0" encoding="${encoding}"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><author><first-name>Leo</first-name><last-name>Tolstoy</last-name></author><book-title>War and Peace</book-title>
<coverpage><image l:href="#cover.jpg"/></coverpage></title-info></description>
<body><title><p>War and Peace</p></title>
<section><title><p>Book One</p></title>
  <section><title><p>Chapter I</p></title><p>First <emphasis>para</emphasis><a l:href="#n1" type="note">1</a>.</p><empty-line/><p>Second para.</p>${extra}</section>
  <section><title><p>Chapter II</p></title><poem><stanza><v>Line one</v><v>Line two</v></stanza></poem></section>
</section></body>
<body name="notes"><section id="n1"><p>A footnote.</p></section></body>
<binary id="cover.jpg" content-type="image/jpeg">/9j/4AAQ</binary>
</FictionBook>`;

describe('FB2', () => {
  it('reads metadata, sections, cover and skips notes', async () => {
    const book = await parseFile(fileOf(FB2(), 'wp.fb2'));
    expect(book.title).toBe('War and Peace');
    expect(book.author).toBe('Leo Tolstoy');
    expect(book.cover?.type).toBe('image/jpeg');
    expect(book.sections).toEqual([
      { title: 'Chapter I', text: 'War and Peace\n\nFirst para.\n\nSecond para.' },
      { title: 'Chapter II', text: 'Line one\n\nLine two' },
    ]);
  });
  it('decodes a windows-1251 FB2', async () => {
    const xml = FB2('windows-1251', '<p>\u0000</p>').replace('Second para.', 'XYZ');
    const bytes = Uint8Array.from(xml, (c) => (c === '\u0000' ? 0 : c.charCodeAt(0)));
    // replace the NUL placeholder with cp1251 bytes for "\u041F\u0440\u0438"
    const i = bytes.indexOf(0);
    const fixed = Uint8Array.from([...bytes.subarray(0, i), 0xcf, 0xf0, 0xe8, ...bytes.subarray(i + 1)]);
    const book = await parseFile(fileOf(fixed, 'ru.fb2'));
    expect(book.sections[0].text).toContain('\u041F\u0440\u0438');
  });
  it('reads .fb2.zip', async () => {
    const zip = await zipOf({ 'book.fb2': FB2() });
    const book = await parseFile(fileOf(zip, 'wp.fb2.zip'));
    expect(book.title).toBe('War and Peace');
    expect(book.sections).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe('EPUB', () => {
  const chapters = [
    { id: 'cover', body: '<div><img src="../images/cover.jpg" alt="Cover"/></div>' },
    { id: 'copy', body: '<p>Copyright \u00A9 2020 Someone. All rights reserved.</p><p>ISBN 978-0-00-000000-0</p>' },
    { id: 'c1', title: 'The Beginning', body: `<h1>The Beginning</h1><p>${words(40)}</p><p>Second <span>para</span><a epub:type="noteref" href="#fn1">1</a>.</p><script>x()</script>` },
    { id: 'c1b', body: `<p>${words(20, 'cont')}</p>` },
    { id: 'c2', title: 'The Middle', body: `<h2>The Middle</h2><p>${words(30, 'mid')}</p><svg><text>no</text></svg>` },
  ];
  it('follows spine + nav, merges continuation files, skips copyright junk, extracts cover', async () => {
    const cover = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const epub = await buildEpub({ title: 'Test Book', author: 'A. Writer', chapters, nav: 'nav', cover });
    const book = await parseFile(fileOf(epub, 'test.epub'));
    expect(book.title).toBe('Test Book');
    expect(book.author).toBe('A. Writer');
    expect(book.cover?.type).toBe('image/jpeg');
    expect(book.sections.map((s) => s.title)).toEqual(['The Beginning', 'The Middle']);
    expect(book.sections[0].text).toBe(`${words(40)}\n\nSecond para.\n\n${words(20, 'cont')}`);
    expect(book.sections[1].text).toBe(words(30, 'mid'));
  });
  it('uses toc.ncx (EPUB2) and splits on fragment links', async () => {
    const epub = await buildEpub({
      title: 'NCX Book',
      nav: 'ncx',
      chapters: [{ id: 'all', title: 'Part A', body: `<h1>Part A</h1><p>${words(10)}</p><h2 id="b">Part B</h2><p>${words(10, 'bee')}</p>` }],
      fragmentToc: [['all', 'b', 'Part B']],
    });
    const book = await parseFile(fileOf(epub, 'ncx.epub'));
    expect(book.sections).toEqual([
      { title: 'Part A', text: words(10) },
      { title: 'Part B', text: words(10, 'bee') },
    ]);
  });
  it('without a TOC, titles come from the first heading', async () => {
    const epub = await buildEpub({ title: 'No TOC', nav: 'none', chapters: [{ id: 'a', body: `<h1>Alpha</h1><p>${words(5)}</p>` }, { id: 'b', body: `<p>${words(5)}</p>` }] });
    const book = await parseFile(fileOf(epub, 'n.epub'));
    expect(book.sections.map((s) => s.title)).toEqual(['Alpha', 'Section 2']);
  });
  it('detects DRM but ignores font obfuscation', async () => {
    const enc = (algo: string, uri: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algo}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
    const drm = await buildEpub({ title: 'x', chapters, encryption: enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'OEBPS/text/c1.xhtml') });
    await expectParseError(parseFile(fileOf(drm, 'drm.epub')), 'drm', /DRM/);
    const fonts = await buildEpub({ title: 'Fonts OK', chapters, encryption: enc('http://www.idpf.org/2008/embedding', 'OEBPS/fonts/a.otf') });
    expect((await parseFile(fileOf(fonts, 'f.epub'))).title).toBe('Fonts OK');
  });
  it('image-only EPUB gives a clear error', async () => {
    const epub = await buildEpub({ title: 'Comic', chapters: [{ id: 'p1', body: '<img src="a.jpg"/>' }] });
    await expectParseError(parseFile(fileOf(epub, 'comic.epub')), 'empty', /images/);
  });
});

// ---------------------------------------------------------------------------
describe('DOCX / ODT / DOC', () => {
  it('DOCX: headings become sections, metadata from core.xml', async () => {
    const docx = await buildDocx(
      [
        { style: 'Title', text: 'Ignored Title Para' },
        { style: 'Heading1', text: 'Intro' },
        { text: words(20) },
        { style: 'Heading2', text: 'Detail' },
        { text: 'More & more.' },
        { style: 'Heading1', text: 'Second' },
        { text: words(10, 'z') },
      ],
      { title: 'Doc Title', author: 'D. Author' },
    );
    const book = await parseFile(fileOf(docx, 'file.docx'));
    expect(book).toMatchObject({ title: 'Doc Title', author: 'D. Author' });
    expect(book.sections).toEqual([
      { title: 'Intro', text: `${words(20)}\n\nDetail\n\nMore & more.` },
      { title: 'Second', text: words(10, 'z') },
    ]);
  });
  it('ODT: text:h outline levels, spaces, notes skipped, meta', async () => {
    const odt = await buildOdt(
      `<text:h text:outline-level="1">One</text:h><text:p>Hello<text:s text:c="3"/>world<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>note</text:p></text:note-body></text:note>.</text:p>` +
        `<text:list><text:list-item><text:p>item</text:p></text:list-item></text:list><text:h text:outline-level="1">Two</text:h><text:p>Bye</text:p>`,
      { title: 'ODT Title', author: 'O. Author' },
    );
    const book = await parseFile(fileOf(odt, 'a.odt'));
    expect(book).toMatchObject({ title: 'ODT Title', author: 'O. Author' });
    expect(book.sections).toEqual([
      { title: 'One', text: 'Hello world.\n\nitem' },
      { title: 'Two', text: 'Bye' },
    ]);
  });
  it('DOC (Word 97): piece table with 8-bit and UTF-16 pieces, fields, metadata', async () => {
    const p1 = `Chapter 1\r${words(30)}\r\u0013 HYPERLINK "x" \u0014Linked\u0015 text\r`;
    const p2 = `Chapter 2\r${words(30, 'uni')} \u2014 done\u0007cell\u0007\u0007\r`;
    const doc = buildDoc(p1, p2, { title: 'Legacy Doc', author: 'W. Author' });
    const book = await parseFile(fileOf(doc, 'old.doc'));
    expect(book).toMatchObject({ title: 'Legacy Doc', author: 'W. Author' });
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(book.sections[0].text).toBe(`${words(30)}\n\nLinked text`);
    expect(book.sections[1].text).toBe(`${words(30, 'uni')} \u2014 done cell`);
  });
  it('DOC: encrypted -> password error', async () => {
    await expectParseError(parseFile(fileOf(buildDoc('a', 'b', {}, { encrypted: true }), 'p.doc')), 'password', /password/);
  });
});

// ---------------------------------------------------------------------------
describe('MOBI', () => {
  const html6 = (target1: string, target2: string) =>
    `<html><head><guide><reference type="toc" title="Contents" filepos=${'0'.repeat(10)} /></guide></head><body>` +
    `<p>Contents</p><p><a filepos=${target1}>First Chapter</a></p><p><a filepos=${target2}>Second Chapter</a></p><p><a filepos=${target2}>Second Chapter</a></p><mbp:pagebreak/>` +
    `<h2>First Chapter</h2><p>${words(30)}</p><p>Caf\u00E9 \u2014 ok</p><mbp:pagebreak/><h2>Second Chapter</h2><p>${words(20, 'two')}</p></body></html>`;
  /** Fill in filepos values (fixed width, so offsets don't move). */
  const withFilepos = () => {
    let h = html6('0000000000', '0000000000');
    const b = utf8(h);
    const find = (s: string) => {
      const needle = utf8(s);
      outer: for (let i = 0; i < b.length; i++) {
        for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
        return i;
      }
      return -1;
    };
    const t1 = find('<h2>First Chapter');
    const t2 = find('<h2>Second Chapter');
    h = html6(String(t1).padStart(10, '0'), String(t2).padStart(10, '0'));
    return h;
  };

  it('MOBI6: PalmDOC + trailing entries + EXTH + TOC filepos chapters + cover', async () => {
    const cover = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(7)]);
    const mobi = buildMobi({ html: withFilepos() + `<p>${words(2000, 'pad')}</p>`, title: 'Mobi Title', author: 'M. Author', extraFlags: 3, cover });
    const book = await parseFile(fileOf(mobi, 'book.mobi'));
    expect(book).toMatchObject({ title: 'Mobi Title', author: 'M. Author' });
    expect(book.cover?.type).toBe('image/jpeg');
    expect(book.sections.map((s) => s.title)).toEqual(['First Chapter', 'Second Chapter']);
    expect(book.sections[0].text).toBe(`${words(30)}\n\nCaf\u00E9 \u2014 ok`);
    expect(book.sections[1].text.startsWith(words(20, 'two'))).toBe(true);
    expect(book.sections[1].text).not.toContain('<');
  });
  it('MOBI6 without TOC: page breaks + headings; uncompressed; cp1252', async () => {
    const html = `<html><body><h1>Alpha</h1><p>${words(10)}</p><mbp:pagebreak/><h1>Beta</h1><p>caf\u00E9</p></body></html>`;
    const book = await parseFile(fileOf(buildMobi({ html, compression: 'none', encoding: 1252 }), 'x.azw'));
    expect(book.sections).toEqual([
      { title: 'Alpha', text: words(10) },
      { title: 'Beta', text: 'caf\u00E9' },
    ]);
  });
  it('HUFF/CDIC compressed text', async () => {
    const html = `<html><body><h1>Huff</h1><p>${words(800, 'huff')}</p><h1>Puff</h1><p>end</p></body></html>`;
    const book = await parseFile(fileOf(buildMobi({ html, compression: 'huff', extraFlags: 2 }), 'h.mobi'));
    expect(book.sections.map((s) => s.title)).toEqual(['Huff', 'Puff']);
    expect(countWords(book.sections)).toBe(801);
  });
  it('KF8 (AZW3): FDST flow 0 only, one section per part file', async () => {
    const part = (t: string, body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body><div><h1>${t}</h1><p>${body}</p></div></body></html>`;
    const html = part('One', words(10)) + part('Two', words(10, 'kf'));
    const book = await parseFile(fileOf(buildMobi({ html, version: 8, extraFlows: ['p { color: red }'], title: 'KF8 Book' }), 'k.azw3'));
    expect(book.title).toBe('KF8 Book');
    expect(book.sections).toEqual([
      { title: 'One', text: words(10) },
      { title: 'Two', text: words(10, 'kf') },
    ]);
  });
  it('combo MOBI6+KF8 file prefers the KF8 part', async () => {
    const kf8 = mobiRecords({ html: '<html><body><h1>From KF8</h1><p>new text</p></body></html>', version: 8, extraFlows: [''] });
    const six = mobiRecords({ html: '<html><body><h1>From MOBI6</h1><p>old text</p></body></html>' });
    const boundaryIdx = six.length + 1; // after BOUNDARY record
    const sixWithExth = mobiRecords(
      { html: '<html><body><h1>From MOBI6</h1><p>old text</p></body></html>', title: 'Combo' },
      { extraExth: [[121, Uint8Array.from([(boundaryIdx >>> 24) & 255, (boundaryIdx >>> 16) & 255, (boundaryIdx >>> 8) & 255, boundaryIdx & 255])]] },
    );
    expect(sixWithExth.length).toBe(six.length);
    const book = await parseFile(fileOf(palmDb([...sixWithExth, utf8('BOUNDARY'), ...kf8]), 'combo.azw3'));
    expect(book.title).toBe('Combo');
    expect(book.sections).toEqual([{ title: 'From KF8', text: 'new text' }]);
  });
  it('plain PalmDOC (TEXtREAd) .pdb', async () => {
    const book = await parseFile(fileOf(buildMobi({ html: `Chapter 1\n\n${words(20)}\n\nChapter 2\n\n${words(20)}`, type: 'TEXtREAd' }), 'old.pdb'));
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });
  it('DRM-encrypted -> clear error', async () => {
    await expectParseError(parseFile(fileOf(buildMobi({ html: '<p>x</p>', encryption: 2 }), 'drm.azw')), 'drm', /DRM/);
  });
  it('KFX -> clear error', async () => {
    await expectParseError(parseFile(fileOf(Uint8Array.from([0xea, ...utf8('DRMION'), 0xee, 1, 2, 3]), 'b.azw')), 'unsupported', /KFX/);
  });
  it('LZ77 round trip and trailing entries', () => {
    const src = utf8(`${words(300)} \u00E9\u00E9 \u0001\u0002 end`);
    expect(Array.from(palmDocDecompress(palmDocCompress(src)))).toEqual(Array.from(src));
    expect(trailingSize(Uint8Array.from([1, 2, 3, 0x00, 0xaa, 0xbb, 0x83]), 3)).toBe(4);
    expect(trailingSize(Uint8Array.from([1, 2, 3, 0x02, 0x82]), 2)).toBe(2);
  });
  it('HuffCdic rejects bad tables', () => {
    expect(() => new HuffCdic(utf8('nope'), [])).toThrow(ParseError);
  });
});

// ---------------------------------------------------------------------------
describe('detection and errors', () => {
  it('magic bytes beat a wrong extension', async () => {
    const epub = await buildEpub({ title: 'Renamed', chapters: [{ id: 'a', title: 'A', body: '<p>hello</p>' }] });
    expect((await parseFile(fileOf(epub, 'actually-epub.pdf'))).title).toBe('Renamed');
    expect(await detectFormatAsync(fileOf(epub, 'book.bin'))).toBe('epub');
    const docx = await buildDocx([{ text: 'hello docx' }]);
    expect((await parseFile(fileOf(docx, 'noext'))).sections[0].text).toBe('hello docx');
    expect(await detectFormatAsync(fileOf(buildMobi({ html: '<p>x</p>' }), 'book.txt'))).toBe('mobi');
    expect(await detectFormatAsync(fileOf('{\\rtf1 hi}', 'x.txt'))).toBe('rtf');
    expect(await detectFormatAsync(fileOf(buildDoc('a', 'b'), 'x'))).toBe('docx');
    expect(await detectFormatAsync(fileOf(FB2(), 'book.xml'))).toBe('fb2');
    expect(await detectFormatAsync(fileOf('<!DOCTYPE html><html><body>x</body></html>', 'page'))).toBe('html');
    expect(await detectFormatAsync(fileOf('%PDF-1.4 ...', 'doc.txt'))).toBe('pdf');
    expect(await detectFormatAsync(fileOf(await zipOf({ 'a.odt.content': 'x' }), 'x.zip'))).toBeNull();
    const odt = await buildOdt('<text:p>odt</text:p>');
    expect(await detectFormatAsync(fileOf(odt, 'a.docx'))).toBe('odt');
  });
  it('unknown binary and unknown zips are rejected clearly', async () => {
    await expect(parseFile(fileOf(Uint8Array.from([0, 1, 2, 3, 0, 0, 9, 200]), 'x.bin'))).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(parseFile(fileOf(await zipOf({ 'readme.md': 'hi' }), 'stuff.zip'))).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
  it('garbage with a known extension -> corrupt', async () => {
    await expectParseError(parseFile(fileOf('this is not a pdf', 'a.pdf')), 'corrupt', /PDF/);
    await expectParseError(parseFile(fileOf('nope', 'a.epub')), 'corrupt', /EPUB/);
    await expectParseError(parseFile(fileOf(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0]), 'a.docx')), 'corrupt');
    await expectParseError(parseFile(fileOf(new Uint8Array(100), 'a.mobi')), 'corrupt');
  });
  it('empty file', async () => {
    await expectParseError(parseFile(fileOf('', 'e.txt')), 'empty');
  });
  it('zip bomb guard (declared sizes)', async () => {
    const zip = await zipOf({ 'mimetype': 'application/epub+zip', 'big.xhtml': 'a'.repeat(1000) }, 'mimetype');
    // patch the central directory's uncompressed size of big.xhtml to 3 GB
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        const nameLen = view.getUint16(i + 28, true);
        const name = new TextDecoder().decode(zip.subarray(i + 46, i + 46 + nameLen));
        if (name === 'big.xhtml') view.setUint32(i + 24, 3_000_000_000, true);
      }
    }
    await expectParseError(parseFile(fileOf(zip, 'bomb.epub')), 'too-large');
  });
});
