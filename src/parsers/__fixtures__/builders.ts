/**
 * Test-only fixture builders. Everything is generated in memory; nothing is downloaded.
 */
import JSZip from 'jszip';

const enc = new TextEncoder();
export const utf8 = (s: string) => enc.encode(s);

export function fileOf(data: Uint8Array | string, name: string, type = ''): File {
  return new File([typeof data === 'string' ? data : (data as BlobPart)], name, { type });
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export interface PdfText {
  x: number;
  y: number;
  size?: number;
  text: string;
}
export interface PdfPageSpec {
  texts: PdfText[];
  /** draw a filled rectangle (for "scanned" pages without text) */
  rect?: boolean;
}
export interface PdfSpec {
  pages: PdfPageSpec[];
  info?: { Title?: string; Author?: string };
  /** outline entries: title + 0-based page + optional top y */
  outline?: { title: string; page: number; top?: number }[];
  /** add a bogus /Encrypt dictionary (pdf.js will ask for a password) */
  encrypted?: boolean;
}

const pdfStr = (s: string) => `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;

export function buildPdf(spec: PdfSpec): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => {
    objs.push(s);
    return objs.length; // object number
  };
  const catalog = add(''); // 1
  const pagesObj = add(''); // 2
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageNums: number[] = [];
  for (const p of spec.pages) {
    let content = '';
    if (p.rect) content += '0.5 g 50 50 500 700 re f\n';
    for (const t of p.texts) content += `BT /F1 ${t.size ?? 12} Tf ${t.x} ${t.y} Td ${pdfStr(t.text)} Tj ET\n`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    pageNums.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;
  let outlineRef = '';
  if (spec.outline?.length) {
    const outlines = add('');
    const itemNums = spec.outline.map(() => add(''));
    spec.outline.forEach((o, i) => {
      const dest = `[${pageNums[o.page]} 0 R /XYZ 0 ${o.top ?? 792} 0]`;
      const prev = i > 0 ? `/Prev ${itemNums[i - 1]} 0 R ` : '';
      const next = i + 1 < itemNums.length ? `/Next ${itemNums[i + 1]} 0 R ` : '';
      objs[itemNums[i] - 1] = `<< /Title ${pdfStr(o.title)} /Parent ${outlines} 0 R ${prev}${next}/Dest ${dest} >>`;
    });
    objs[outlines - 1] = `<< /Type /Outlines /First ${itemNums[0]} 0 R /Last ${itemNums[itemNums.length - 1]} 0 R /Count ${itemNums.length} >>`;
    outlineRef = ` /Outlines ${outlines} 0 R`;
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${outlineRef} >>`;
  let infoRef = '';
  if (spec.info) {
    const parts = Object.entries(spec.info)
      .map(([k, v]) => `/${k} ${pdfStr(v ?? '')}`)
      .join(' ');
    infoRef = ` /Info ${add(`<< ${parts} >>`)} 0 R`;
  }
  let encRef = '';
  if (spec.encrypted) {
    const e = add(`<< /Filter /Standard /V 1 /R 2 /O <${'11'.repeat(32)}> /U <${'22'.repeat(32)}> /P -44 >>`);
    encRef = ` /Encrypt ${e} 0 R /ID [<${'ab'.repeat(16)}> <${'ab'.repeat(16)}>]`;
  }
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${infoRef}${encRef} >>\nstartxref\n${xref}\n%%EOF`;
  return utf8(out);
}

/** Lay out paragraphs as lines on pages (12pt Helvetica, 14pt leading, 28pt paragraph gap). */
export function textPages(paragraphLines: string[][], opts: { header?: string; pageNumbers?: boolean; linesPerPage?: number } = {}): PdfPageSpec[] {
  const pages: PdfPageSpec[] = [];
  let cur: PdfText[] = [];
  let y = 720;
  const perPage = opts.linesPerPage ?? 40;
  let count = 0;
  const newPage = () => {
    if (opts.header) cur.push({ x: 200, y: 760, size: 9, text: opts.header });
    if (opts.pageNumbers) cur.push({ x: 300, y: 30, size: 9, text: String(pages.length + 1) });
    pages.push({ texts: cur });
    cur = [];
    y = 720;
    count = 0;
  };
  for (const para of paragraphLines) {
    for (const line of para) {
      if (count >= perPage) newPage();
      cur.push({ x: 72, y, text: line });
      y -= 14;
      count++;
    }
    y -= 14;
  }
  newPage();
  return pages;
}

// ---------------------------------------------------------------------------
// MOBI
// ---------------------------------------------------------------------------

/** Simple PalmDOC LZ77 compressor (greedy), for fixtures. */
export function palmDocCompress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    // try a back-reference
    let bestLen = 0;
    let bestDist = 0;
    for (let d = 1; d <= Math.min(2047, i); d++) {
      let l = 0;
      while (l < 10 && i + l < src.length && src[i + l] === src[i - d + l]) l++;
      if (l > bestLen) {
        bestLen = l;
        bestDist = d;
      }
    }
    if (bestLen >= 3) {
      const pair = 0x8000 | (bestDist << 3) | (bestLen - 3);
      out.push(pair >> 8, pair & 0xff);
      i += bestLen;
      continue;
    }
    const c = src[i];
    if (c === 0x20 && i + 1 < src.length && src[i + 1] >= 0x40 && src[i + 1] < 0x80) {
      out.push(src[i + 1] ^ 0x80);
      i += 2;
      continue;
    }
    if ((c >= 0x09 && c < 0x80) || c === 0) {
      out.push(c);
      i++;
      continue;
    }
    // literal run of "odd" bytes
    let n = 0;
    while (n < 8 && i + n < src.length && !((src[i + n] >= 0x09 && src[i + n] < 0x80) || src[i + n] === 0)) n++;
    out.push(n);
    for (let k = 0; k < n; k++) out.push(src[i + k]);
    i += n;
  }
  return Uint8Array.from(out);
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

export interface MobiSpec {
  html: string;
  title?: string;
  author?: string;
  compression?: 'none' | 'palmdoc' | 'huff';
  extraFlags?: number;
  encryption?: number;
  version?: number; // 6 (default) or 8
  encoding?: 1252 | 65001;
  cover?: Uint8Array;
  /** KF8: flows (flow 0 = html, the rest appended after it) */
  extraFlows?: string[];
  type?: 'BOOKMOBI' | 'TEXtREAd';
}

function exth(records: [number, Uint8Array][]): number[] {
  const body: number[] = [];
  for (const [t, d] of records) body.push(...be32(t), ...be32(d.length + 8), ...d);
  const len = 12 + body.length;
  const pad = (4 - (len % 4)) % 4;
  return [...utf8('EXTH'), ...be32(len + pad), ...be32(records.length), ...body, ...new Array(pad).fill(0)];
}

/** Build the record list of a MOBI book (record 0 first). `imageBase` = absolute index of the first image. */
export function mobiRecords(spec: MobiSpec, opts: { imageBase?: number; extraExth?: [number, Uint8Array][] } = {}): Uint8Array[] {
  const encoding = spec.encoding ?? 65001;
  const textBytes = encoding === 65001 ? utf8(spec.html + (spec.extraFlows ?? []).join('')) : Uint8Array.from(spec.html, (c) => c.charCodeAt(0) & 0xff);
  const flowBoundaries: [number, number][] = [];
  if (spec.extraFlows) {
    let p = 0;
    for (const f of [spec.html, ...spec.extraFlows]) {
      const len = utf8(f).length;
      flowBoundaries.push([p, p + len]);
      p += len;
    }
  }
  const compression = spec.compression ?? 'palmdoc';
  const extraFlags = spec.extraFlags ?? 0;
  const textRecs: Uint8Array[] = [];
  let huffRecs: Uint8Array[] = [];
  for (let i = 0; i < textBytes.length; i += 4096) {
    const chunk = textBytes.subarray(i, i + 4096);
    let data: Uint8Array = compression === 'palmdoc' ? palmDocCompress(chunk) : compression === 'huff' ? chunk.slice() : chunk;
    // trailing entries: [multibyte byte][entry 0xAA 0xBB, size 3]
    const trail: number[] = [];
    if (extraFlags & 1) trail.push(0x00);
    if (extraFlags & 2) trail.push(0xaa, 0xbb, 0x83);
    if (trail.length) data = Uint8Array.from([...data, ...trail]);
    textRecs.push(data);
  }
  if (compression === 'huff') huffRecs = buildIdentityHuff();
  const version = spec.version ?? 6;
  const title = utf8(spec.title ?? 'Untitled');
  const exthRecs: [number, Uint8Array][] = [];
  if (spec.author) exthRecs.push([100, utf8(spec.author)]);
  if (spec.title) exthRecs.push([503, utf8(spec.title)]);
  if (spec.cover) exthRecs.push([201, Uint8Array.from(be32(0))]);
  exthRecs.push(...(opts.extraExth ?? []));
  const exthBytes = exth(exthRecs);

  const textCount = textRecs.length;
  // record layout after record 0: text..., [huff, cdic], [fdst], [cover]
  let next = 1 + textCount;
  const huffIdx = huffRecs.length ? next : 0;
  next += huffRecs.length;
  const fdstIdx = flowBoundaries.length ? next++ : 0xffffffff;
  const imageIdx = spec.cover ? next++ : 0xffffffff;

  const headerLen = 0xe8;
  const rec0 = new Uint8Array(16 + headerLen + exthBytes.length + title.length + 4);
  const set = (o: number, bytes: number[]) => rec0.set(bytes, o);
  set(0, be16(compression === 'none' ? 1 : compression === 'palmdoc' ? 2 : 17480));
  set(4, be32(textBytes.length));
  set(8, be16(textCount));
  set(10, be16(4096));
  set(12, be16(spec.encryption ?? 0));
  if (spec.type !== 'TEXtREAd') {
    set(16, [...utf8('MOBI')]);
    set(20, be32(headerLen));
    set(24, be32(2));
    set(28, be32(encoding));
    set(36, be32(version));
    set(0x50, be32(next));
    set(0x54, be32(16 + headerLen + exthBytes.length));
    set(0x58, be32(title.length));
    set(0x6c, be32(spec.cover ? (opts.imageBase ?? imageIdx) : 0xffffffff));
    set(0x70, be32(huffIdx));
    set(0x74, be32(huffRecs.length));
    set(0x80, be32(0x40));
    set(0xc0, be32(fdstIdx));
    set(0xc4, be32(flowBoundaries.length));
    set(0xf2, be16(extraFlags));
    rec0.set(exthBytes, 16 + headerLen);
    rec0.set(title, 16 + headerLen + exthBytes.length);
  }
  const recs: Uint8Array[] = [spec.type === 'TEXtREAd' ? rec0.subarray(0, 16) : rec0, ...textRecs, ...huffRecs];
  if (flowBoundaries.length) {
    recs.push(Uint8Array.from([...utf8('FDST'), ...be32(12), ...be32(flowBoundaries.length), ...flowBoundaries.flatMap(([s, e]) => [...be32(s), ...be32(e)])]));
  }
  if (spec.cover) recs.push(spec.cover);
  return recs;
}

/** HUFF/CDIC tables where each input byte b decodes to phrase b = the single byte b. */
function buildIdentityHuff(): Uint8Array[] {
  const huff = new Uint8Array(24 + 256 * 4 + 64 * 4);
  huff.set(utf8('HUFF'), 0);
  huff.set(be32(0x18), 4);
  huff.set(be32(24), 8);
  huff.set(be32(24 + 1024), 12);
  for (let b = 0; b < 256; b++) {
    // codelen 8, terminal, maxcode chosen so that (maxcode - code) >> 24 == b
    const v = ((2 * b) << 8) | 0x80 | 8;
    huff.set(be32(v >>> 0), 24 + b * 4);
  }
  const phrases = 256;
  const offsets: number[] = [];
  const data: number[] = [];
  for (let b = 0; b < phrases; b++) {
    offsets.push(phrases * 2 + data.length);
    data.push(...be16(0x8000 | 1), b);
  }
  const cdic = Uint8Array.from([...utf8('CDIC'), ...be32(0x10), ...be32(phrases), ...be32(8), ...offsets.flatMap(be16), ...data]);
  return [huff, cdic];
}

export function palmDb(records: Uint8Array[], name = 'Test_Book', typeCreator = 'BOOKMOBI'): Uint8Array {
  const headerLen = 78 + records.length * 8 + 2;
  const total = headerLen + records.reduce((s, r) => s + r.length, 0);
  const out = new Uint8Array(total);
  out.set(utf8(name).subarray(0, 31), 0);
  out.set(utf8(typeCreator), 60);
  out.set(be16(records.length), 76);
  let off = headerLen;
  records.forEach((r, i) => {
    out.set(be32(off), 78 + i * 8);
    out.set(be32(i * 2), 78 + i * 8 + 4);
    out.set(r, off);
    off += r.length;
  });
  return out;
}

export const buildMobi = (spec: MobiSpec) => palmDb(mobiRecords(spec), 'Test_Book', spec.type ?? 'BOOKMOBI');

// ---------------------------------------------------------------------------
// Zip-based formats
// ---------------------------------------------------------------------------

export async function zipOf(files: Record<string, string | Uint8Array>, storeFirst?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  if (storeFirst && files[storeFirst] !== undefined) zip.file(storeFirst, files[storeFirst], { compression: 'STORE' });
  for (const [k, v] of Object.entries(files)) if (k !== storeFirst) zip.file(k, v);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export interface EpubSpec {
  title?: string;
  author?: string;
  chapters: { id: string; title?: string; body: string; inToc?: boolean }[];
  nav?: 'nav' | 'ncx' | 'none';
  encryption?: string;
  cover?: Uint8Array;
  /** extra toc entries pointing at fragments: [chapterId, fragment, title] */
  fragmentToc?: [string, string, string][];
}

export async function buildEpub(spec: EpubSpec): Promise<Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  files['mimetype'] = 'application/epub+zip';
  files['META-INF/container.xml'] =
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const nav = spec.nav ?? 'nav';
  const manifest: string[] = [];
  const spine: string[] = [];
  for (const ch of spec.chapters) {
    files[`OEBPS/text/${ch.id}.xhtml`] =
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${ch.title ?? ''}</title><style>p{margin:0}</style></head><body>${ch.body}</body></html>`;
    manifest.push(`<item id="${ch.id}" href="text/${ch.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${ch.id}"/>`);
  }
  const tocEntries: { href: string; title: string }[] = [];
  for (const ch of spec.chapters) if (ch.inToc !== false && ch.title) tocEntries.push({ href: `text/${ch.id}.xhtml`, title: ch.title });
  for (const [id, frag, title] of spec.fragmentToc ?? []) tocEntries.push({ href: `text/${id}.xhtml#${frag}`, title });
  if (nav === 'nav') {
    files['OEBPS/nav.xhtml'] =
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${tocEntries
        .map((t) => `<li><a href="${t.href}">${t.title}</a></li>`)
        .join('')}</ol></nav></body></html>`;
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  } else if (nav === 'ncx') {
    files['OEBPS/toc.ncx'] =
      `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${tocEntries
        .map((t, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${t.title}</text></navLabel><content src="${t.href}"/></navPoint>`)
        .join('')}</navMap></ncx>`;
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  }
  if (spec.cover) {
    files['OEBPS/images/cover.jpg'] = spec.cover;
    manifest.push('<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>');
  }
  files['OEBPS/content.opf'] =
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>${spec.title ?? ''}</dc:title>${
      spec.author ? `<dc:creator>${spec.author}</dc:creator>` : ''
    }</metadata><manifest>${manifest.join('')}</manifest><spine${nav === 'ncx' ? ' toc="ncx"' : ''}>${spine.join('')}</spine></package>`;
  if (spec.encryption) files['META-INF/encryption.xml'] = spec.encryption;
  return zipOf(files, 'mimetype');
}

export async function buildDocx(paragraphs: { style?: string; text: string }[], meta: { title?: string; author?: string } = {}): Promise<Uint8Array> {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = paragraphs
    .map((p) => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`)
    .join('');
  const styles = ['Heading1:heading 1', 'Heading2:heading 2', 'Title:Title']
    .map((s) => {
      const [id, name] = s.split(':');
      return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
    })
    .join('');
  return zipOf({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': `<?xml version="1.0"?><w:styles ${W}>${styles}</w:styles>`,
    'docProps/core.xml': `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${
      meta.title ? `<dc:title>${meta.title}</dc:title>` : ''
    }${meta.author ? `<dc:creator>${meta.author}</dc:creator>` : ''}</cp:coreProperties>`,
  });
}

export async function buildOdt(bodyXml: string, meta: { title?: string; author?: string } = {}): Promise<Uint8Array> {
  const NS =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
  return zipOf(
    {
      mimetype: 'application/vnd.oasis.opendocument.text',
      'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`,
      'meta.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS}><office:meta>${meta.title ? `<dc:title>${meta.title}</dc:title>` : ''}${
        meta.author ? `<dc:creator>${meta.author}</dc:creator>` : ''
      }</office:meta></office:document-meta>`,
    },
    'mimetype',
  );
}

// ---------------------------------------------------------------------------
// OLE compound file / Word 97 .doc
// ---------------------------------------------------------------------------

const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** Build a v3 compound file: streams < 4096 bytes go to the mini stream. */
export function buildOle(streams: { name: string; data: Uint8Array }[]): Uint8Array {
  const SS = 512;
  const big = streams.filter((s) => s.data.length >= 4096);
  const small = streams.filter((s) => s.data.length < 4096);
  // mini stream
  const miniChunks: number[] = [];
  const miniStart = new Map<string, number>();
  const miniFat: number[] = [];
  for (const s of small) {
    const startSector = miniChunks.length / 64;
    miniStart.set(s.name, startSector);
    const n = Math.max(1, Math.ceil(s.data.length / 64));
    for (let i = 0; i < n; i++) miniFat.push(i + 1 < n ? startSector + i + 1 : 0xfffffffe);
    const padded = new Uint8Array(n * 64);
    padded.set(s.data);
    miniChunks.push(...padded);
  }
  // sectors: 0 FAT, 1 directory, 2 miniFAT, then mini stream, then big streams
  const fat: number[] = [0xfffffffd, 0xfffffffe, 0xfffffffe];
  const sectors: Uint8Array[] = [];
  const miniStreamSectors = Math.ceil(miniChunks.length / SS);
  const miniStreamStart = miniStreamSectors ? 3 : 0xfffffffe;
  for (let i = 0; i < miniStreamSectors; i++) fat.push(i + 1 < miniStreamSectors ? 3 + i + 1 : 0xfffffffe);
  const bigStart = new Map<string, number>();
  let nextSector = 3 + miniStreamSectors;
  for (const s of big) {
    const n = Math.ceil(s.data.length / SS);
    bigStart.set(s.name, nextSector);
    for (let i = 0; i < n; i++) fat.push(i + 1 < n ? nextSector + i + 1 : 0xfffffffe);
    nextSector += n;
  }
  while (fat.length < 128) fat.push(0xffffffff);
  // directory
  const entry = (name: string, type: number, start: number, size: number, child = 0xffffffff, right = 0xffffffff) => {
    const e = new Uint8Array(128);
    for (let i = 0; i < name.length; i++) e.set(le16(name.charCodeAt(i)), i * 2);
    e.set(le16((name.length + 1) * 2), 64);
    e[66] = type;
    e[67] = 1;
    e.set(le32(0xffffffff), 68);
    e.set(le32(right), 72);
    e.set(le32(child), 76);
    e.set(le32(start), 116);
    e.set(le32(size), 120);
    return e;
  };
  const dirEntries = [entry('Root Entry', 5, miniStreamStart, miniChunks.length, 1)];
  streams.forEach((s, i) => {
    const start = s.data.length >= 4096 ? bigStart.get(s.name)! : miniStart.get(s.name)!;
    dirEntries.push(entry(s.name, 2, start, s.data.length, 0xffffffff, i + 2 <= streams.length ? i + 2 : 0xffffffff));
  });
  while (dirEntries.length < 4) dirEntries.push(new Uint8Array(128));
  if (dirEntries.length > 4) throw new Error('fixture supports up to 3 streams');
  const dirSector = new Uint8Array(SS);
  dirEntries.forEach((e, i) => dirSector.set(e, i * 128));
  const fatSector = new Uint8Array(SS);
  fat.slice(0, 128).forEach((v, i) => fatSector.set(le32(v), i * 4));
  const miniFatSector = new Uint8Array(SS);
  for (let i = 0; i < 128; i++) miniFatSector.set(le32(i < miniFat.length ? miniFat[i] : 0xffffffff), i * 4);
  sectors.push(fatSector, dirSector, miniFatSector);
  const ms = new Uint8Array(miniStreamSectors * SS);
  ms.set(miniChunks);
  for (let i = 0; i < miniStreamSectors; i++) sectors.push(ms.subarray(i * SS, (i + 1) * SS));
  for (const s of big) {
    const n = Math.ceil(s.data.length / SS);
    const padded = new Uint8Array(n * SS);
    padded.set(s.data);
    for (let i = 0; i < n; i++) sectors.push(padded.subarray(i * SS, (i + 1) * SS));
  }
  const header = new Uint8Array(512);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  header.set(le16(0x3e), 0x18);
  header.set(le16(3), 0x1a);
  header.set(le16(0xfffe), 0x1c);
  header.set(le16(9), 0x1e);
  header.set(le16(6), 0x20);
  header.set(le32(1), 0x2c); // FAT sectors
  header.set(le32(1), 0x30); // first dir sector
  header.set(le32(4096), 0x38);
  header.set(le32(2), 0x3c); // first mini FAT
  header.set(le32(1), 0x40);
  header.set(le32(0xfffffffe), 0x44);
  header.set(le32(0), 0x48);
  header.set(le32(0), 0x4c);
  for (let i = 1; i < 109; i++) header.set(le32(0xffffffff), 0x4c + i * 4);
  const out = new Uint8Array(512 + sectors.length * SS);
  out.set(header, 0);
  sectors.forEach((s, i) => out.set(s, 512 + i * SS));
  return out;
}

/** A Word 97 .doc: piece 1 is 8-bit compressed text, piece 2 UTF-16. */
export function buildDoc(part1: string, part2: string, meta: { title?: string; author?: string } = {}, opts: { encrypted?: boolean } = {}): Uint8Array {
  const wd = new Uint8Array(6144);
  wd.set(le16(0xa5ec), 0);
  wd.set(le16(0x00c1), 2);
  wd.set(le16(0x0200 | (opts.encrypted ? 0x0100 : 0)), 0x0a);
  const fc1 = 0x800;
  for (let i = 0; i < part1.length; i++) wd[fc1 + i] = part1.charCodeAt(i) & 0xff;
  const fc2 = 0x800 + part1.length + 16;
  for (let i = 0; i < part2.length; i++) wd.set(le16(part2.charCodeAt(i)), fc2 + i * 2);
  const ccp = part1.length + part2.length;
  wd.set(le32(ccp), 0x4c);
  // CLX in table stream
  const plc = [
    ...le32(0),
    ...le32(part1.length),
    ...le32(ccp),
    ...[0, 0, ...le32((fc1 * 2) | 0x40000000), 0, 0],
    ...[0, 0, ...le32(fc2), 0, 0],
  ];
  const clx = [0x02, ...le32(plc.length), ...plc];
  const table = Uint8Array.from([...clx, ...new Array(64).fill(0)]);
  wd.set(le32(0), 0x1a2);
  wd.set(le32(clx.length), 0x1a6);
  // SummaryInformation
  const props: [number, number[]][] = [[1, [...le32(2), ...le16(1252), 0, 0]]];
  const str = (s: string) => {
    const b = [...utf8(s), 0];
    while (b.length % 4) b.push(0);
    return [...le32(0x1e), ...le32(s.length + 1), ...b];
  };
  if (meta.title) props.push([2, str(meta.title)]);
  if (meta.author) props.push([4, str(meta.author)]);
  let off = 8 + props.length * 8;
  const index: number[] = [];
  const values: number[] = [];
  for (const [pid, v] of props) {
    index.push(...le32(pid), ...le32(off));
    values.push(...v);
    off += v.length;
  }
  const section = [...le32(8 + index.length + values.length), ...le32(props.length), ...index, ...values];
  const si = Uint8Array.from([...le16(0xfffe), ...le16(0), ...le32(0), ...new Array(16).fill(0), ...le32(1), ...new Array(16).fill(0x11), ...le32(48), ...section]);
  return buildOle([
    { name: 'WordDocument', data: wd },
    { name: '1Table', data: table },
    { name: '\u0005SummaryInformation', data: si },
  ]);
}
