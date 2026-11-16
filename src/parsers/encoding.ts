/**
 * Byte -> string decoding with charset detection for plain-text-ish formats.
 * Order: BOM, explicit hint (meta charset / XML declaration / RTF codepage), strict UTF-8,
 * UTF-16 without BOM (zero-byte pattern), then a windows-125x guess.
 */

export interface DecodeResult {
  text: string;
  encoding: string;
}

function tryDecoder(label: string, bytes: Uint8Array, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/** Normalise charset labels that TextDecoder knows under another name. Returns null if unsupported. */
export function normalizeCharset(label: string | null | undefined): string | null {
  if (!label) return null;
  let l = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!l) return null;
  if (/^(cp|ansi)?125\d$/.test(l)) l = `windows-${l.replace(/\D/g, '')}`;
  if (l === 'utf8') l = 'utf-8';
  try {
    return new TextDecoder(l).encoding;
  } catch {
    return null;
  }
}

/** Map a Windows code page number (RTF \ansicpgN, MOBI) to a TextDecoder label. */
export function codepageToLabel(cp: number): string {
  switch (cp) {
    case 65001:
      return 'utf-8';
    case 1200:
      return 'utf-16le';
    case 1201:
      return 'utf-16be';
    case 932:
      return 'shift_jis';
    case 936:
      return 'gbk';
    case 949:
      return 'euc-kr';
    case 950:
      return 'big5';
    case 874:
      return 'windows-874';
    case 10000:
      return 'macintosh';
    case 20866:
      return 'koi8-r';
    case 28591:
      return 'iso-8859-1';
    case 866:
      return 'ibm866';
    default:
      if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
      return 'windows-1252';
  }
}

function detectBom(bytes: Uint8Array): { encoding: string; skip: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', skip: 3 };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', skip: 2 };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', skip: 2 };
  return null;
}

/** UTF-16 without BOM: lots of zero bytes on one parity (ASCII-range text). */
export function sniffUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 8192) & ~1;
  if (n < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++;
    if (bytes[i + 1] === 0) oddZero++;
  }
  const pairs = n / 2;
  if (oddZero > pairs * 0.3 && evenZero < pairs * 0.05) return 'utf-16le';
  if (evenZero > pairs * 0.3 && oddZero < pairs * 0.05) return 'utf-16be';
  return null;
}

/**
 * Guess a single-byte Windows code page. Western text has few high bytes; Cyrillic (1251) text is
 * mostly high bytes in 0xC0-0xFF; Central European (1250) has characteristic letters in 0x8A-0x9F.
 */
export function guessSingleByte(bytes: Uint8Array): string {
  const n = Math.min(bytes.length, 1 << 20);
  let letters = 0;
  let high = 0;
  let cyrRange = 0; // 0xC0-0xFF
  let ce = 0; // 1250-only letters: \u0160 \u015A \u0164 \u017D \u0179 \u0161 \u015B \u0165 \u017E \u017A \u0141 \u0142 \u0104 \u0105 \u0118 \u0119 \u0150 \u0151 \u0170 \u0171 \u010C \u010D \u0158 \u0159
  const ceSet = new Set([0x8a, 0x8c, 0x8d, 0x8e, 0x8f, 0x9a, 0x9c, 0x9d, 0x9e, 0x9f, 0xa3, 0xb3, 0xa5, 0xb9, 0xca, 0xea, 0xd5, 0xf5, 0xdb, 0xfb, 0xc8, 0xe8, 0xd8, 0xf8]);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) letters++;
    else if (b >= 0x80) {
      high++;
      if (b >= 0xc0) cyrRange++;
      if (ceSet.has(b)) ce++;
    }
  }
  const total = letters + high;
  if (total === 0) return 'windows-1252';
  if (cyrRange / total > 0.3) return 'windows-1251';
  if (ce > 0 && ce / Math.max(1, high) > 0.25 && high / total > 0.01) return 'windows-1250';
  return 'windows-1252';
}

/** Decode bytes to a string using BOM / hint / UTF-8 / UTF-16 / windows-125x, in that order. */
export function decodeBytes(bytes: Uint8Array, hint?: string | null): DecodeResult {
  const bom = detectBom(bytes);
  if (bom) {
    return { text: tryDecoder(bom.encoding, bytes.subarray(bom.skip)) ?? '', encoding: bom.encoding };
  }
  const hinted = normalizeCharset(hint);
  if (hinted && hinted !== 'utf-8') {
    // A wrong hint is common (copy-pasted meta tags): if the bytes are valid UTF-8 with non-ASCII, prefer UTF-8.
    const utf = hasNonAscii(bytes) ? tryDecoder('utf-8', bytes, true) : null;
    if (utf !== null && !hinted.startsWith('utf-16')) return { text: utf, encoding: 'utf-8' };
    const t = tryDecoder(hinted, bytes);
    if (t !== null) return { text: t, encoding: hinted };
  }
  const utf16 = sniffUtf16(bytes);
  if (utf16) return { text: tryDecoder(utf16, bytes) ?? '', encoding: utf16 };
  const utf8 = tryDecoder('utf-8', bytes, true);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };
  const label = guessSingleByte(bytes);
  return { text: tryDecoder(label, bytes) ?? tryDecoder('windows-1252', bytes) ?? '', encoding: label };
}

function hasNonAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) return true;
  return false;
}

/** Bytes -> "binary string" (one char per byte), for scanning ASCII markup in byte-addressed data. */
export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = start; i < end; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(end, i + CHUNK))));
  }
  return s;
}

/** Looks like binary (not text)? Many NULs / control bytes in the first few KB, ignoring UTF-16 patterns. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (detectBom(bytes) || sniffUtf16(bytes)) return false;
  const n = Math.min(bytes.length, 4096);
  if (n === 0) return false;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) bad++;
  }
  return bad / n > 0.05;
}
