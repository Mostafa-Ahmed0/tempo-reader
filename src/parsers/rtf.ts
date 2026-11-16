/**
 * Hand-rolled RTF reader: groups, destinations (skips fonttbl/stylesheet/pict/header/...),
 * \par/\line, \'hh with per-font charsets, \uN with \ucN skipping, \info title/author,
 * headings from \outlinelevel or "heading N" styles.
 */
import type { ParsedBook } from '../core/types';
import { codepageToLabel } from './encoding';
import { corrupt, emptyBook } from './errors';
import { type Block, cleanInline, fillTitles, plainParagraphsToBlocks, sectionsFromBlocks, titleFromFileName } from './textUtils';

/** Destinations whose content is never text. */
const SKIP_DEST = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation', 'atnid', 'atnauthor', 'atndate', 'atnref',
  'fldinst', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl',
  'generator', 'xmlnstbl', 'mmathPr', 'pgdsctbl', 'filetbl', 'revtbl', 'bkmkstart', 'bkmkend', 'shpinst', 'nonshppict',
  'blipuid', 'userprops', 'docvar', 'wgrffmtfilter', 'pnseclvl', 'pntext', 'pntxta', 'pntxtb', 'listtext', 'template',
  'falt', 'panose', 'fontemb', 'fontfile', 'operator', 'company', 'title', 'author', 'subject', 'keywords', 'comment',
  'doccomm', 'creatim', 'revtim', 'printim', 'buptim', 'xe', 'tc', 'txe', 'rxe', 'sp', 'sn', 'sv', 'protusertbl',
  'passwordhash', 'ftnsep', 'ftnsepc', 'ftncn', 'aftnsep', 'aftnsepc', 'aftncn', 'formfield', 'ud', 'background',
  'shppict', 'mhtmltag', 'htmltag', 'ql', 'factoidname', 'oldcprops', 'oldpprops', 'oldtprops', 'oldsprops', 'pgptbl',
]);

/** \fcharset -> Windows code page */
const CHARSET_CP: Record<number, number> = {
  0: 1252, 77: 10000, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256,
  186: 1257, 204: 1251, 222: 874, 238: 1250, 255: 437,
};

interface State {
  dest: 'body' | 'skip' | 'fonttbl' | 'stylesheet' | 'info' | 'meta-title' | 'meta-author';
  uc: number;
  font: number;
}

export function parseRtfBytes(bytes: Uint8Array, fileName: string): ParsedBook {
  const { blocks, title, author } = rtfToBlocks(bytes);
  if (!blocks.length) throw emptyBook('RTF');
  const hasHeadings = blocks.some((b) => b.kind === 'h');
  const finalBlocks = hasHeadings ? blocks : plainParagraphsToBlocks(blocks.map((b) => b.text));
  const t = title || titleFromFileName(fileName);
  return { title: t, author: author || undefined, sections: fillTitles(sectionsFromBlocks(finalBlocks, { singleTitle: t })) };
}

export function rtfToBlocks(bytes: Uint8Array): { blocks: Block[]; title: string; author: string } {
  // Header check: "{\rtf"
  let start = 0;
  while (start < bytes.length && start < 16 && bytes[start] !== 0x7b) start++;
  if (!(bytes[start] === 0x7b && bytes[start + 1] === 0x5c && bytes[start + 2] === 0x72 && bytes[start + 3] === 0x74 && bytes[start + 4] === 0x66)) {
    throw corrupt('RTF');
  }

  let ansiCp = 1252;
  const fontCp = new Map<number, number>();
  const styleLevel = new Map<number, number>();
  const decoders = new Map<number, TextDecoder>();
  const decoderFor = (cp: number) => {
    let d = decoders.get(cp);
    if (!d) {
      try {
        d = new TextDecoder(codepageToLabel(cp));
      } catch {
        d = new TextDecoder('windows-1252');
      }
      decoders.set(cp, d);
    }
    return d;
  };

  const blocks: Block[] = [];
  let para = '';
  let paraLevel = 0; // heading level of current paragraph (0 = body)
  let metaTitle = '';
  let metaAuthor = '';
  // stylesheet parsing
  let styleNum = -1;
  let styleName = '';
  let fontNum = -1;

  let st: State = { dest: 'body', uc: 1, font: -1 };
  const stack: State[] = [];
  let groupStart = false; // just after '{' (destination keyword position)
  let ignorable = false; // saw \*
  let pendingBytes: number[] = [];
  let skipChars = 0;

  const currentCp = () => (st.font >= 0 && fontCp.has(st.font) ? fontCp.get(st.font)! : ansiCp);
  const emit = (s: string) => {
    switch (st.dest) {
      case 'body':
        para += s;
        break;
      case 'meta-title':
        metaTitle += s;
        break;
      case 'meta-author':
        metaAuthor += s;
        break;
      case 'stylesheet':
        styleName += s;
        break;
      default:
        break;
    }
  };
  const flushBytes = () => {
    if (pendingBytes.length) {
      const cp = currentCp();
      const text = cp === 42 /* symbol */ ? '' : decoderFor(cp).decode(new Uint8Array(pendingBytes));
      pendingBytes = [];
      emit(text);
    }
  };
  const endParagraph = () => {
    flushBytes();
    const t = cleanInline(para);
    if (t) blocks.push(paraLevel > 0 ? { kind: 'h', level: paraLevel, text: t } : { kind: 'p', text: t });
    para = '';
  };
  const text = (s: string) => {
    if (skipChars > 0) {
      skipChars--;
      return;
    }
    flushBytes();
    emit(s);
  };
  const byte = (b: number) => {
    if (skipChars > 0) {
      skipChars--;
      return;
    }
    if (st.dest === 'body' || st.dest === 'meta-title' || st.dest === 'meta-author' || st.dest === 'stylesheet') pendingBytes.push(b);
  };

  const n = bytes.length;
  let i = start;
  let guard = 0;
  while (i < n) {
    if (++guard > 200_000_000) break;
    const c = bytes[i];
    if (c === 0x7b /* { */) {
      flushBytes();
      stack.push({ ...st });
      if (stack.length > 2000) throw corrupt('RTF');
      groupStart = true;
      ignorable = false;
      i++;
      continue;
    }
    if (c === 0x7d /* } */) {
      flushBytes();
      if (st.dest === 'stylesheet' && styleNum >= 0) {
        recordStyle();
      }
      st = stack.pop() ?? st;
      groupStart = false;
      i++;
      continue;
    }
    if (c === 0x5c /* \ */) {
      const next = bytes[i + 1];
      if (next === undefined) break;
      const isLetter = (x: number) => (x >= 0x61 && x <= 0x7a) || (x >= 0x41 && x <= 0x5a);
      if (isLetter(next)) {
        let j = i + 1;
        while (j < n && isLetter(bytes[j]) && j - i < 40) j++;
        const word = latinStr(bytes, i + 1, j);
        let param: number | null = null;
        let k = j;
        if (bytes[k] === 0x2d || (bytes[k] >= 0x30 && bytes[k] <= 0x39)) {
          let neg = false;
          if (bytes[k] === 0x2d) {
            neg = true;
            k++;
          }
          let v = 0;
          const ds = k;
          while (k < n && bytes[k] >= 0x30 && bytes[k] <= 0x39 && k - ds < 10) v = v * 10 + (bytes[k++] - 0x30);
          param = neg ? -v : v;
        }
        if (bytes[k] === 0x20) k++;
        i = k;
        const wasGroupStart = groupStart;
        groupStart = false;
        if (word === 'bin' && param !== null && param > 0) {
          i += param;
          continue;
        }
        handleWord(word, param, wasGroupStart);
        continue;
      }
      // control symbol
      i += 2;
      groupStart = false;
      switch (next) {
        case 0x27: {
          // \'hh
          const h = parseInt(latinStr(bytes, i, i + 2), 16);
          i += 2;
          if (!Number.isNaN(h)) byte(h);
          break;
        }
        case 0x2a: // \*
          ignorable = true;
          break;
        case 0x7e: // \~
          text('\u00A0');
          break;
        case 0x2d: // \- optional hyphen
          break;
        case 0x5f: // \_
          text('-');
          break;
        case 0x0a:
        case 0x0d:
          if (st.dest === 'body') endParagraph();
          break;
        case 0x5c:
          text('\\');
          break;
        case 0x7b:
          text('{');
          break;
        case 0x7d:
          text('}');
          break;
        case 0x09:
          text(' ');
          break;
        default:
          break;
      }
      continue;
    }
    if (c === 0x0d || c === 0x0a) {
      i++;
      continue;
    }
    groupStart = false;
    if (c >= 0x80) byte(c);
    else if (c === 0x3b /* ; */ && st.dest === 'stylesheet') {
      flushBytes();
      recordStyle();
    } else if (c === 0x09) text(' ');
    else if (c >= 0x20) text(String.fromCharCode(c));
    i++;
  }
  endParagraph();

  function recordStyle() {
    if (styleNum >= 0) {
      const m = /^\s*heading\s*(\d)/i.exec(styleName) ?? /^\s*(?:title|chapter)\b/i.exec(styleName);
      if (m) styleLevel.set(styleNum, m[1] ? Number(m[1]) : 1);
    }
    styleNum = -1;
    styleName = '';
  }

  function handleWord(word: string, param: number | null, atGroupStart: boolean) {
    // Destinations
    if (atGroupStart || ignorable) {
      const wasIgnorable = ignorable;
      ignorable = false;
      if (st.dest === 'skip') return;
      if (word === 'fonttbl' || word === 'stylesheet' || word === 'info') {
        st.dest = word;
        return;
      }
      if (st.dest === 'info') {
        st.dest = word === 'title' ? 'meta-title' : word === 'author' ? 'meta-author' : 'skip';
        return;
      }
      if (st.dest === 'fonttbl' || st.dest === 'stylesheet') {
        // entries of the table ({\f0 ...}, {\s1 ...}, {\*\cs10 ...}): handled below
      } else if (word === 'fldrslt' || word === 'field' || word === 'shptxt' || word === 'shp') {
        // keep content (field results, text boxes)
      } else if (SKIP_DEST.has(word) || wasIgnorable) {
        st.dest = 'skip';
        return;
      }
    }
    switch (word) {
      case 'ansicpg':
        if (param) ansiCp = param;
        return;
      case 'mac':
        ansiCp = 10000;
        return;
      case 'pc':
        ansiCp = 437;
        return;
      case 'pca':
        ansiCp = 850;
        return;
      case 'f':
        if (param === null) return;
        if (st.dest === 'fonttbl') fontNum = param;
        flushBytes();
        st.font = param;
        return;
      case 'fcharset':
        if (st.dest === 'fonttbl' && fontNum >= 0 && param !== null) {
          const cp = CHARSET_CP[param];
          if (param === 2) fontCp.set(fontNum, 42);
          else if (cp) fontCp.set(fontNum, cp);
        }
        return;
      case 'cpg':
        if (st.dest === 'fonttbl' && fontNum >= 0 && param) fontCp.set(fontNum, param);
        return;
      case 's':
        if (st.dest === 'stylesheet') styleNum = param ?? 0;
        else if (st.dest === 'body' && param !== null && styleLevel.has(param)) paraLevel = styleLevel.get(param)!;
        return;
      case 'outlinelevel':
        if (st.dest === 'body' && param !== null && param >= 0 && param < 9) paraLevel = param + 1;
        return;
      case 'pard':
        paraLevel = 0;
        return;
      case 'uc':
        st.uc = param ?? 1;
        return;
      case 'u':
        if (param !== null) {
          flushBytes();
          if (skipChars > 0) skipChars = 0;
          const code = param < 0 ? param + 65536 : param;
          emit(String.fromCharCode(code));
          skipChars = st.uc;
        }
        return;
    }
    if (st.dest !== 'body') return;
    switch (word) {
      case 'par':
      case 'sect':
      case 'page':
      case 'line':
      case 'row':
      case 'column':
        endParagraph();
        return;
      case 'cell':
      case 'nestcell':
      case 'tab':
        text(' ');
        return;
      case 'emdash':
        text('\u2014');
        return;
      case 'endash':
        text('\u2013');
        return;
      case 'lquote':
        text('\u2018');
        return;
      case 'rquote':
        text('\u2019');
        return;
      case 'ldblquote':
        text('\u201C');
        return;
      case 'rdblquote':
        text('\u201D');
        return;
      case 'bullet':
        text('\u2022');
        return;
      case 'emspace':
      case 'enspace':
      case 'qmspace':
        text(' ');
        return;
    }
  }

  return { blocks, title: cleanInline(metaTitle), author: cleanInline(metaAuthor) };
}

function latinStr(b: Uint8Array, s: number, e: number): string {
  let out = '';
  for (let i = s; i < e && i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}
