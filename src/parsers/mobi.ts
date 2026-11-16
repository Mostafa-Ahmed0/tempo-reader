/**
 * MOBI / AZW / AZW3 / PRC reader, hand-written:
 * PalmDB container, PalmDOC (LZ77) and HUFF/CDIC decompression, trailing-entry stripping, EXTH metadata
 * and cover, cp1252/UTF-8 text, KF8 (standalone AZW3 and the KF8 half of combo files, flow 0 via FDST).
 * Chapters: MOBI6 TOC (filepos links), else headings / <mbp:pagebreak>; KF8 by part files + headings.
 * Not implemented: the NCX/INDX index (chapter titles come from the HTML instead).
 */
import type { ParsedBook, ParsedSection } from '../core/types';
import { latin1 } from './encoding';
import { ParseError, corrupt, drmError, emptyBook, tooLarge } from './errors';
import { htmlToBlocks } from './html';
import { sniffImageType } from './epub';
import {
  type Block,
  cleanInline,
  fillTitles,
  plainTextToSections,
  prettifyHeading,
  sectionsFromBlocks,
  titleFromFileName,
  wordCount,
  yieldToUi,
} from './textUtils';

const MAX_TEXT_BYTES = 128 * 1024 * 1024;

const be16 = (b: Uint8Array, o: number) => ((b[o] << 8) | b[o + 1]) >>> 0;
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export interface PalmDb {
  name: string;
  type: string;
  creator: string;
  records: Uint8Array[];
}

export function readPalmDb(bytes: Uint8Array): PalmDb {
  if (bytes.length < 86) throw corrupt('MOBI');
  const nameEnd = bytes.subarray(0, 32).indexOf(0);
  const name = latin1(bytes, 0, nameEnd < 0 ? 32 : nameEnd);
  const type = latin1(bytes, 60, 64);
  const creator = latin1(bytes, 64, 68);
  const count = be16(bytes, 76);
  if (count === 0 || 78 + count * 8 > bytes.length) throw corrupt('MOBI');
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(be32(bytes, 78 + i * 8));
  const records: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = offsets[i];
    const end = i + 1 < count ? offsets[i + 1] : bytes.length;
    records.push(start <= end && end <= bytes.length ? bytes.subarray(start, end) : new Uint8Array(0));
  }
  return { name, type, creator, records };
}

/** PalmDOC LZ77 decompression of one record. */
export function palmDocDecompress(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(16, src.length * 8));
  let o = 0;
  let i = 0;
  const n = src.length;
  while (i < n && o < out.length) {
    const c = src[i++];
    if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < n && o < out.length; k++) out[o++] = src[i++];
    } else if (c < 0x80) {
      out[o++] = c;
    } else if (c >= 0xc0) {
      out[o++] = 0x20;
      if (o < out.length) out[o++] = c ^ 0x80;
    } else {
      if (i >= n) break;
      const pair = (c << 8) | src[i++];
      const dist = (pair >> 3) & 0x7ff;
      const len = (pair & 7) + 3;
      if (dist === 0 || dist > o) continue; // corrupt reference: skip
      for (let k = 0; k < len && o < out.length; k++) {
        out[o] = out[o - dist];
        o++;
      }
    }
  }
  return out.subarray(0, o);
}

/** Size of the trailing entries appended to a text record (MOBI "extra data flags"). */
export function trailingSize(rec: Uint8Array, flags: number): number {
  let size = 0;
  const entry = (end: number) => {
    // backward-encoded variable-width integer ending at `end`
    let result = 0;
    let shift = 0;
    let p = end;
    while (p > 0) {
      const v = rec[p - 1];
      result |= (v & 0x7f) << shift;
      shift += 7;
      p--;
      if (v & 0x80 || shift >= 28) break;
    }
    return result;
  };
  let f = flags >> 1;
  while (f) {
    if (f & 1) size += entry(rec.length - size);
    f >>= 1;
    if (size > rec.length) return rec.length;
  }
  if (flags & 1) {
    const off = rec.length - size - 1;
    if (off >= 0) size += (rec[off] & 3) + 1;
  }
  return Math.min(size, rec.length);
}

// ---------------------------------------------------------------------------
// HUFF/CDIC
// ---------------------------------------------------------------------------

export class HuffCdic {
  private dict1: { codelen: number; term: boolean; maxcode: number }[] = [];
  private mincode: number[] = [];
  private maxcode: number[] = [];
  private dictionary: ({ data: Uint8Array; literal: boolean } | null)[] = [];

  constructor(huff: Uint8Array, cdics: Uint8Array[]) {
    if (latin1(huff, 0, 4) !== 'HUFF' || be32(huff, 4) !== 0x18) throw corrupt('MOBI');
    const off1 = be32(huff, 8);
    const off2 = be32(huff, 12);
    for (let i = 0; i < 256; i++) {
      const v = be32(huff, off1 + i * 4);
      const codelen = v & 0x1f;
      const term = (v & 0x80) !== 0;
      const max = v >>> 8;
      if (codelen === 0) throw corrupt('MOBI');
      this.dict1.push({ codelen, term, maxcode: (max + 1) * 2 ** (32 - codelen) - 1 });
    }
    this.mincode.push(0);
    this.maxcode.push(2 ** 32 - 1);
    for (let codelen = 1; codelen <= 32; codelen++) {
      const min = be32(huff, off2 + (codelen - 1) * 8);
      const max = be32(huff, off2 + (codelen - 1) * 8 + 4);
      this.mincode.push(min * 2 ** (32 - codelen));
      this.maxcode.push((max + 1) * 2 ** (32 - codelen) - 1);
    }
    for (const cdic of cdics) {
      if (latin1(cdic, 0, 4) !== 'CDIC' || be32(cdic, 4) !== 0x10) throw corrupt('MOBI');
      const phrases = be32(cdic, 8);
      const bits = be32(cdic, 12);
      const n = Math.min(2 ** bits, phrases - this.dictionary.length);
      for (let i = 0; i < n; i++) {
        const off = be16(cdic, 16 + i * 2);
        const blen = be16(cdic, 16 + off);
        const start = 18 + off;
        this.dictionary.push({ data: cdic.subarray(start, start + (blen & 0x7fff)), literal: (blen & 0x8000) !== 0 });
      }
    }
  }

  unpack(data: Uint8Array, depth = 0): Uint8Array {
    if (depth > 32) throw corrupt('MOBI');
    const buf = new Uint8Array(data.length + 8);
    buf.set(data);
    let bitsleft = data.length * 8;
    let pos = 0;
    let n = 32;
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      if (n <= 0) {
        pos += 4;
        n += 32;
      }
      const hi = be32(buf, pos);
      const lo = be32(buf, pos + 4);
      const code = n === 32 ? hi : ((hi << (32 - n)) | (lo >>> n)) >>> 0;
      const d = this.dict1[code >>> 24];
      let codelen = d.codelen;
      let maxcode = d.maxcode;
      if (!d.term) {
        while (codelen < 32 && code < this.mincode[codelen]) codelen++;
        maxcode = this.maxcode[codelen];
      }
      n -= codelen;
      bitsleft -= codelen;
      if (bitsleft < 0) break;
      const r = Math.floor((maxcode - code) / 2 ** (32 - codelen));
      const entry = this.dictionary[r];
      if (!entry) throw corrupt('MOBI');
      let slice: Uint8Array;
      if (entry.literal) slice = entry.data;
      else {
        this.dictionary[r] = null; // recursion guard (as in the reference implementation)
        slice = this.unpack(entry.data, depth + 1);
        this.dictionary[r] = { data: slice, literal: true };
      }
      parts.push(slice);
      total += slice.length;
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const s of parts) {
      out.set(s, p);
      p += s.length;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

interface MobiHeader {
  compression: number;
  textLength: number;
  recordCount: number;
  encryption: number;
  hasMobi: boolean;
  headerLength: number;
  encoding: number;
  version: number;
  firstImage: number;
  huffOffset: number;
  huffCount: number;
  extraFlags: number;
  fdst: number;
  fullName: string;
  exth: Map<number, Uint8Array[]>;
}

function readHeader(rec0: Uint8Array): MobiHeader {
  if (rec0.length < 16) throw corrupt('MOBI');
  const h: MobiHeader = {
    compression: be16(rec0, 0),
    textLength: be32(rec0, 4),
    recordCount: be16(rec0, 8),
    encryption: be16(rec0, 12),
    hasMobi: latin1(rec0, 16, 20) === 'MOBI',
    headerLength: 0,
    encoding: 1252,
    version: 0,
    firstImage: 0xffffffff,
    huffOffset: 0,
    huffCount: 0,
    extraFlags: 0,
    fdst: 0xffffffff,
    fullName: '',
    exth: new Map(),
  };
  if (!h.hasMobi) return h;
  h.headerLength = be32(rec0, 20);
  h.encoding = be32(rec0, 28);
  h.version = be32(rec0, 36);
  if (rec0.length >= 0x70) h.firstImage = be32(rec0, 0x6c);
  if (rec0.length >= 0x78) {
    h.huffOffset = be32(rec0, 0x70);
    h.huffCount = be32(rec0, 0x74);
  }
  if (h.headerLength >= 0xe4 && rec0.length >= 0xf4) h.extraFlags = be16(rec0, 0xf2);
  if (h.version >= 8 && rec0.length >= 0xc4) h.fdst = be32(rec0, 0xc0);
  const nameOff = be32(rec0, 0x54);
  const nameLen = be32(rec0, 0x58);
  const exthFlags = rec0.length >= 0x84 ? be32(rec0, 0x80) : 0;
  if (exthFlags & 0x40) {
    const p = 16 + h.headerLength;
    if (latin1(rec0, p, p + 4) === 'EXTH') {
      const count = be32(rec0, p + 8);
      let q = p + 12;
      for (let i = 0; i < count && q + 8 <= rec0.length; i++) {
        const type = be32(rec0, q);
        const len = be32(rec0, q + 4);
        if (len < 8 || q + len > rec0.length) break;
        const list = h.exth.get(type) ?? [];
        list.push(rec0.subarray(q + 8, q + len));
        h.exth.set(type, list);
        q += len;
      }
    }
  }
  const dec = textDecoder(h.encoding);
  if (nameOff > 0 && nameLen > 0 && nameOff + nameLen <= rec0.length) h.fullName = dec.decode(rec0.subarray(nameOff, nameOff + nameLen));
  return h;
}

function textDecoder(encoding: number): TextDecoder {
  return new TextDecoder(encoding === 65001 ? 'utf-8' : 'windows-1252');
}

/** Decompress all text records of a book whose record 0 is records[base]. */
async function readText(db: PalmDb, base: number, h: MobiHeader, onProgress?: (f: number) => void): Promise<Uint8Array> {
  let huff: HuffCdic | null = null;
  if (h.compression === 17480) {
    const hi = base + h.huffOffset;
    if (!h.huffCount || hi >= db.records.length) throw corrupt('MOBI');
    const cdics: Uint8Array[] = [];
    for (let i = 1; i < h.huffCount && hi + i < db.records.length; i++) cdics.push(db.records[hi + i]);
    huff = new HuffCdic(db.records[hi], cdics);
  } else if (h.compression !== 1 && h.compression !== 2) {
    throw new ParseError('unsupported', 'This Kindle file uses a compression Tempo does not know. Convert it to EPUB (e.g. with Calibre) and try again.');
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  const count = Math.min(h.recordCount, db.records.length - base - 1);
  for (let r = 1; r <= count; r++) {
    let rec = db.records[base + r];
    rec = rec.subarray(0, rec.length - trailingSize(rec, h.extraFlags));
    const out = h.compression === 2 ? palmDocDecompress(rec) : huff ? huff.unpack(rec) : rec;
    parts.push(out);
    total += out.length;
    if (total > MAX_TEXT_BYTES) throw tooLarge('This book has more text than Tempo can handle.');
    if (r % 64 === 0) {
      onProgress?.(0.1 + (0.6 * r) / count);
      await yieldToUi();
    }
  }
  const text = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    text.set(part, p);
    p += part.length;
  }
  return h.textLength > 0 && h.textLength < text.length ? text.subarray(0, h.textLength) : text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function parseMobiBytes(bytes: Uint8Array, fileName: string, onProgress?: (f: number) => void): Promise<ParsedBook> {
  if (latin1(bytes, 0, 8).includes('DRMION') || latin1(bytes, 0, 4) === 'CONT') {
    throw new ParseError('unsupported', 'This is a KFX Kindle file, which Tempo cannot read. Use an EPUB or a DRM-free MOBI/AZW3 instead.');
  }
  const db = readPalmDb(bytes);
  const tc = db.type + db.creator;
  if (tc === 'TEXtREAd') return parsePalmDoc(db, fileName, onProgress);
  if (tc !== 'BOOKMOBI') throw corrupt('MOBI');

  const h0 = readHeader(db.records[0]);
  if (h0.encryption !== 0) throw drmError('Kindle book');

  // KF8: standalone (version 8) or the KF8 part of a combo file (EXTH 121 = KF8 record 0).
  let base = 0;
  let h = h0;
  const boundary = h0.exth.get(121)?.[0];
  if (boundary && boundary.length >= 4) {
    const idx = be32(boundary, 0);
    for (const cand of [idx, idx + 1]) {
      const rec = db.records[cand];
      if (rec && rec.length > 20 && latin1(rec, 16, 20) === 'MOBI') {
        const hk = readHeader(rec);
        if (hk.encryption === 0 && hk.version >= 8) {
          base = cand;
          h = hk;
        }
        break;
      }
    }
  }
  const isKf8 = h.version >= 8;

  onProgress?.(0.1);
  let raw = await readText(db, base, h, onProgress);
  if (isKf8 && h.fdst !== 0xffffffff) {
    const fdst = db.records[base + h.fdst];
    if (fdst && latin1(fdst, 0, 4) === 'FDST') {
      const off = be32(fdst, 4);
      const n = be32(fdst, 8);
      if (n >= 1 && off + 8 <= fdst.length) {
        const s = be32(fdst, off);
        const e = be32(fdst, off + 4);
        if (s < e && e <= raw.length) raw = raw.subarray(s, e);
      }
    }
  }
  onProgress?.(0.75);

  const dec = textDecoder(h.encoding);
  const exthStr = (t: number) =>
    (h.exth.get(t) ?? h0.exth.get(t) ?? []).map((b) => cleanInline(textDecoder(h.encoding).decode(b))).filter(Boolean);
  const title = exthStr(503)[0] || cleanInline(h.fullName || h0.fullName) || cleanInline(db.name.replace(/_/g, ' ')) || titleFromFileName(fileName);
  const authors = exthStr(100);
  const author = authors.length ? [...new Set(authors)].slice(0, 3).join(', ') : undefined;

  let sections = isKf8 ? kf8Sections(raw, dec) : mobi6Sections(raw, dec);
  sections = sections.filter((s) => s.text.trim());
  if (!sections.length) throw emptyBook('Kindle');
  const cover = findCover(db, h0);
  onProgress?.(0.95);
  return { title, author, cover, sections: fillTitles(sections) };
}

async function parsePalmDoc(db: PalmDb, fileName: string, onProgress?: (f: number) => void): Promise<ParsedBook> {
  const h = readHeader(db.records[0]);
  if (h.encryption !== 0) throw drmError('eBook');
  h.extraFlags = 0;
  const raw = await readText(db, 0, h, onProgress);
  const text = new TextDecoder('windows-1252').decode(raw);
  const title = cleanInline(db.name.replace(/_/g, ' ')) || titleFromFileName(fileName);
  const sections = fillTitles(plainTextToSections(text, { singleTitle: title }));
  if (!sections.some((s) => s.text)) throw emptyBook('eBook');
  return { title, sections };
}

function findCover(db: PalmDb, h: MobiHeader): Blob | undefined {
  if (h.firstImage === 0xffffffff || h.firstImage === 0) return undefined;
  const offRaw = h.exth.get(201)?.[0] ?? h.exth.get(202)?.[0];
  if (!offRaw || offRaw.length < 4) return undefined;
  const off = be32(offRaw, 0);
  if (off === 0xffffffff) return undefined;
  const rec = db.records[h.firstImage + off];
  if (!rec || rec.length < 16) return undefined;
  const type = sniffImageType(rec);
  if (!type.startsWith('image/')) return undefined;
  return new Blob([rec.slice() as BlobPart], { type });
}

// ---------------------------------------------------------------------------
// MOBI6 (old-style) HTML
// ---------------------------------------------------------------------------

function cleanMobiHtml(html: string): string {
  return html.replace(/<mbp:pagebreak[^>]*>/gi, '<hr/>').replace(/<\/?mbp:[^>]*>/gi, '');
}

interface TocLink {
  pos: number; // byte offset of the <a> tag
  end: number;
  target: number;
  label: string;
}

function findTocLinks(s: string, dec: TextDecoder): TocLink[] {
  const links: TocLink[] = [];
  const re = /<a\b[^>]*?\bfilepos\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const labelBytes = Uint8Array.from(m[2].replace(/<[^>]+>/g, ''), (ch) => ch.charCodeAt(0) & 0xff);
    const label = cleanInline(decodeEntities(dec.decode(labelBytes)));
    links.push({ pos: m.index, end: m.index + m[0].length, target: Number(m[1]), label });
  }
  return links;
}

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  const ta = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  if (!ta) return s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  ta.innerHTML = s;
  return ta.value;
}

/** Pick the TOC: links after the guide's TOC reference, else the biggest cluster of filepos links. */
function chooseToc(s: string, links: TocLink[]): TocLink[] {
  const usable = (l: TocLink) => l.label && l.target > 0 && l.target <= s.length;
  const guide = /<reference\b[^>]*>/gi;
  let tocPos = -1;
  let m: RegExpExecArray | null;
  while ((m = guide.exec(s))) {
    if (/type\s*=\s*["']?toc/i.test(m[0])) {
      const fp = /filepos\s*=\s*["']?(\d+)/i.exec(m[0]);
      if (fp) tocPos = Number(fp[1]);
    }
  }
  const clusters: TocLink[][] = [];
  let cur: TocLink[] = [];
  for (const l of links) {
    if (!usable(l)) continue;
    if (cur.length && l.pos - cur[cur.length - 1].end > 1500) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(l);
  }
  if (cur.length) clusters.push(cur);
  let best: TocLink[] | undefined;
  if (tocPos >= 0) best = clusters.find((c) => c[c.length - 1].end >= tocPos && c[0].pos <= tocPos + 4096);
  if (!best) best = clusters.filter((c) => c.length >= 3).sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 2 ? best : [];
}

export function mobi6Sections(raw: Uint8Array, dec: TextDecoder): ParsedSection[] {
  const s = latin1(raw);
  const links = findTocLinks(s, dec);
  const toc = chooseToc(s, links);
  if (toc.length >= 2) {
    // chapter starts = TOC targets, moved back to the start of the tag they point into
    const starts = [...new Map(toc.map((l) => [l.target, l])).values()].sort((a, b) => a.target - b.target);
    const tocStart = toc[0].pos;
    const tocEnd = toc[toc.length - 1].end;
    const sections: ParsedSection[] = [];
    const toBlocks = (from: number, to: number) => {
      const bytes = raw.subarray(from, to);
      return htmlToBlocks(cleanMobiHtml(dec.decode(bytes)));
    };
    // Front matter (excluding the TOC itself)
    const first = starts[0].target;
    const front = [
      ...toBlocks(0, Math.min(first, tocStart)),
      ...(tocEnd < first ? toBlocks(tocEnd, first) : []),
    ];
    if (wordCount(front.map((b) => b.text).join(' ')) >= 40) sections.push({ title: 'Front matter', text: front.map((b) => b.text).join('\n\n') });
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i].target;
      const to = i + 1 < starts.length ? starts[i + 1].target : raw.length;
      let blocks = toBlocks(from, to);
      // The TOC page itself may sit after a target (TOC at the end): cut it out.
      if (tocStart >= from && tocStart < to) blocks = [...toBlocks(from, tocStart), ...toBlocks(tocEnd, to)];
      const titleText = starts[i].label;
      if (blocks[0]?.kind === 'h' && sameText(blocks[0].text, titleText)) blocks = blocks.slice(1);
      else if (blocks[0] && sameText(blocks[0].text, titleText)) blocks = blocks.slice(1);
      sections.push({ title: titleText, text: blocks.map((b) => b.text).join('\n\n') });
    }
    return sections;
  }
  // No TOC: split on page breaks, then decide by headings.
  const html = dec.decode(raw);
  const chunks = html.split(/<mbp:pagebreak[^>]*>/i).map((c) => htmlToBlocks(cleanMobiHtml(c)));
  return sectionsFromFileBlocks(chunks);
}

function sameText(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return !!n(a) && n(a) === n(b);
}

// ---------------------------------------------------------------------------
// KF8
// ---------------------------------------------------------------------------

export function kf8Sections(raw: Uint8Array, dec: TextDecoder): ParsedSection[] {
  const html = dec.decode(raw);
  // Each part file starts with its skeleton (<?xml ...?> / <html ...>); fragments follow the skeleton.
  const starts: number[] = [];
  const re = /<\?xml[^>]*\?>\s*(?:<!DOCTYPE[^>]*>\s*)?<html\b|<!DOCTYPE[^>]*>\s*<html\b|<html\b/gi;
  let m: RegExpExecArray | null;
  let lastEnd = -1;
  while ((m = re.exec(html))) {
    if (m.index >= lastEnd) starts.push(m.index);
    lastEnd = m.index + m[0].length;
  }
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  const files: Block[][] = [];
  for (let i = 0; i < starts.length; i++) {
    const part = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length);
    files.push(htmlToBlocks(part.replace(/<\?xml[^>]*\?>/g, '')));
  }
  return sectionsFromFileBlocks(files);
}

/**
 * Sections from a list of part files / page-break chunks:
 * - most parts start with a heading -> one section per heading part (others merge into the previous);
 * - otherwise, headings anywhere -> heading-based split over the whole text;
 * - otherwise one section per part, titled by a short first line when it looks like a title.
 */
export function sectionsFromFileBlocks(files: Block[][]): ParsedSection[] {
  const nonEmpty = files.filter((f) => f.some((b) => b.text));
  if (!nonEmpty.length) return [];
  const leadHeading = (f: Block[]) => f.slice(0, 3).find((b) => b.kind === 'h');
  const withHeading = nonEmpty.filter((f) => leadHeading(f)).length;
  if (nonEmpty.length > 1 && withHeading >= nonEmpty.length * 0.5) {
    const out: ParsedSection[] = [];
    for (const f of nonEmpty) {
      const h = leadHeading(f);
      const body = f.filter((b) => b !== h).map((b) => b.text);
      if (h || !out.length) out.push({ title: h ? prettifyHeading(h.text) : '', text: body.join('\n\n') });
      else out[out.length - 1].text += `\n\n${body.join('\n\n')}`;
    }
    return out;
  }
  const all = nonEmpty.flat();
  if (all.filter((b) => b.kind === 'h').length >= 2 || nonEmpty.length === 1) {
    return sectionsFromBlocks(all);
  }
  return nonEmpty.map((f) => {
    const first = f[0];
    const looksTitle = first && wordCount(first.text) <= 8 && !/[.!?,;]$/.test(first.text) && f.length > 1;
    return { title: looksTitle ? prettifyHeading(first.text) : '', text: (looksTitle ? f.slice(1) : f).map((b) => b.text).join('\n\n') };
  });
}
