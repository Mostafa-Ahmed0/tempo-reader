/**
 * Legacy Word .doc (Word 97-2003 binary, [MS-DOC]): text from the piece table (CLX) in the table
 * stream; Word 6/95 files fall back to the contiguous text range. No styles: chapter detection is
 * the plain-text heuristic. Title/author from SummaryInformation.
 */
import type { ParsedBook } from '../core/types';
import { ParseError, corrupt, emptyBook } from './errors';
import { OleFile, readSummaryInfo } from './ole';
import { fillTitles, plainParagraphsToBlocks, sectionsFromBlocks, titleFromFileName, cleanInline } from './textUtils';
import { isJunkDocTitle } from './docx';

const passwordError = () =>
  new ParseError('password', 'This document is password-protected. Open it in Word, remove the password, save it and try again.');

export function parseDocBytes(bytes: Uint8Array, fileName: string): ParsedBook {
  let ole: OleFile;
  try {
    ole = new OleFile(bytes);
  } catch (e) {
    throw corrupt('Word', e);
  }
  if (ole.find('EncryptedPackage') || ole.find('EncryptionInfo')) throw passwordError();
  const wd = ole.stream('WordDocument');
  if (!wd) {
    throw new ParseError('unsupported', 'This Office file is not a Word document. Save it as .docx, PDF or plain text and try again.');
  }
  const text = extractDocText(wd, ole);
  const paragraphs = docTextToParagraphs(text);
  if (!paragraphs.length) throw emptyBook('Word');
  const info = readSummaryInfo(ole.stream('\u0005SummaryInformation'));
  const title = info.title && !isJunkDocTitle(info.title) ? info.title : titleFromFileName(fileName);
  const blocks = plainParagraphsToBlocks(paragraphs);
  return { title, author: info.author || undefined, sections: fillTitles(sectionsFromBlocks(blocks, { singleTitle: title })) };
}

/** Raw main-document text (with Word's control characters) from the WordDocument stream. */
export function extractDocText(wd: Uint8Array, ole: OleFile): string {
  if (wd.length < 0x200) throw corrupt('Word');
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  if (dv.getUint16(0, true) !== 0xa5ec) throw corrupt('Word');
  const nFib = dv.getUint16(2, true);
  const flags = dv.getUint16(0x0a, true);
  if (flags & 0x0100) throw passwordError();
  const cp1252 = new TextDecoder('windows-1252');

  if (nFib < 0xc0) {
    // Word 6 / 95: text stored contiguously between fcMin and fcMac (only if not fast-saved/complex).
    if (flags & 0x0004) {
      throw new ParseError('legacy', 'This is a fast-saved Word 95 file Tempo cannot read. Open it in Word, save it as .docx and try again.');
    }
    const fcMin = dv.getUint32(0x18, true);
    const fcMac = dv.getUint32(0x1c, true);
    if (fcMin >= fcMac || fcMac > wd.length) throw corrupt('Word');
    return cp1252.decode(wd.subarray(fcMin, fcMac));
  }

  const ccpText = dv.getUint32(0x4c, true);
  const fcClx = dv.getUint32(0x1a2, true);
  const lcbClx = dv.getUint32(0x1a6, true);
  const table = ole.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table || lcbClx === 0 || fcClx + lcbClx > table.length) throw corrupt('Word');
  const tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);

  // CLX: Prc* (0x01) then Pcdt (0x02)
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + tdv.getInt16(p + 1, true);
  if (table[p] !== 0x02) throw corrupt('Word');
  const lcb = tdv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = Math.floor((lcb - 4) / 12);
  if (n <= 0 || plc + lcb > table.length) throw corrupt('Word');
  const utf16 = new TextDecoder('utf-16le');
  let out = '';
  for (let i = 0; i < n; i++) {
    const cpStart = tdv.getUint32(plc + i * 4, true);
    let cpEnd = tdv.getUint32(plc + (i + 1) * 4, true);
    if (cpStart >= ccpText) break;
    cpEnd = Math.min(cpEnd, ccpText);
    const len = cpEnd - cpStart;
    if (len <= 0) continue;
    const pcd = plc + (n + 1) * 4 + i * 8;
    const fcRaw = tdv.getUint32(pcd + 2, true);
    if (fcRaw & 0x40000000) {
      const fc = (fcRaw & 0x3fffffff) / 2;
      out += cp1252.decode(wd.subarray(fc, Math.min(wd.length, fc + len)));
    } else {
      out += utf16.decode(wd.subarray(fcRaw, Math.min(wd.length, fcRaw + len * 2)));
    }
    if (out.length > 50_000_000) break;
  }
  return out;
}

/** Interpret Word control characters: fields, cells, breaks; returns paragraphs. */
export function docTextToParagraphs(raw: string): string[] {
  let s = '';
  // Fields: 0x13 instructions 0x14 result 0x15 -> keep result only. Nested fields are tracked with a stack.
  const stack: boolean[] = []; // true = currently in the instruction part
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x13) {
      stack.push(true);
      continue;
    }
    if (c === 0x14) {
      if (stack.length) stack[stack.length - 1] = false;
      continue;
    }
    if (c === 0x15) {
      stack.pop();
      continue;
    }
    if (stack.some((inInstr) => inInstr)) continue;
    switch (c) {
      case 0x0d: // paragraph end
      case 0x0b: // vertical tab = line break
      case 0x0c: // page / section break
      case 0x0e: // column break
        s += '\n';
        break;
      case 0x07: // cell / row end
        s += raw.charCodeAt(i + 1) === 0x07 ? '\n' : ' ';
        break;
      case 0x09:
      case 0xa0:
        s += ' ';
        break;
      case 0x1e: // non-breaking hyphen
        s += '-';
        break;
      case 0x1f: // optional hyphen
      case 0x01: // picture
      case 0x08: // drawn object
      case 0x02: // auto-numbered footnote ref
      case 0x05: // annotation ref
      case 0x03:
      case 0x04:
        break;
      default:
        if (c >= 0x20) s += raw[i];
    }
  }
  return s
    .split('\n')
    .map((l) => cleanInline(l))
    .filter(Boolean);
}
