/**
 * Shared HTML/XHTML -> text helper (used by HTML, EPUB, DOCX via mammoth, MOBI/KF8).
 * Block elements become paragraphs, h1-h6 become headings, script/style/svg etc. are dropped.
 */
import { cleanInline, type Block } from './textUtils';

const SKIP = new Set([
  'head', 'script', 'style', 'svg', 'math', 'noscript', 'template', 'iframe', 'object', 'embed', 'video', 'audio',
  'canvas', 'select', 'button', 'input', 'textarea', 'map', 'title', 'meta', 'link', 'img', 'image', 'picture', 'rt', 'rp',
]);
/** Page chrome dropped for stand-alone web pages (not for ebook content). */
const CHROME = new Set(['nav', 'header', 'footer', 'aside', 'form', 'menu']);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt',
  'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption', 'figure', 'figcaption', 'address', 'hr', 'center', 'body',
  'html', 'form', 'fieldset', 'legend', 'details', 'summary', 'hgroup', 'pagebreak', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'br',
]);
const CELL = new Set(['td', 'th']);

export interface HtmlToBlocksOptions {
  /** Drop nav/header/footer/aside (stand-alone web pages). */
  dropChrome?: boolean;
  /** Record element ids -> index of the block they start (for TOC fragment links). */
  anchors?: Map<string, number>;
}

/** Local name without prefix, case preserved (XML is case-sensitive: navMap, EncryptedData, FictionBook). */
function localName(el: Element): string {
  return (el.localName || el.nodeName).replace(/^.*:/, '');
}

/** Lower-cased local name for HTML tag decisions. */
function tagName(el: Element): string {
  return localName(el).toLowerCase();
}

function isNoteRef(el: Element, name: string): boolean {
  const type = (el.getAttribute('epub:type') ?? '') + ' ' + (el.getAttribute('role') ?? '');
  if (/noteref|doc-noteref/.test(type)) return true;
  if (name === 'sup') {
    const t = (el.textContent ?? '').trim();
    // footnote markers like 1, [12], *, \u2020
    if (t.length <= 4 && /^[\[(]?[\d*\u2020\u2021a-z]{1,3}[\])]?$/i.test(t) && el.getElementsByTagName('a').length > 0) return true;
  }
  return false;
}

/** Convert a DOM subtree into blocks. */
export function domToBlocks(root: Node, opts: HtmlToBlocksOptions = {}): Block[] {
  const blocks: Block[] = [];
  let buf = '';
  const anchors = opts.anchors;

  const flush = () => {
    const t = cleanInline(buf);
    if (t) blocks.push({ kind: 'p', text: t });
    buf = '';
  };
  const appendText = (s: string) => {
    if (s) buf += s;
  };

  const walk = (node: Node, inPre: boolean) => {
    if (node.nodeType === 3 /* TEXT */ || node.nodeType === 4 /* CDATA */) {
      const v = node.nodeValue ?? '';
      if (inPre) {
        const lines = v.split('\n');
        lines.forEach((l, i) => {
          if (i > 0) flush();
          appendText(l);
        });
      } else appendText(v);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const el = node as Element;
    const name = node.nodeType === 1 ? tagName(el) : '#doc';
    if (node.nodeType === 1) {
      if (SKIP.has(name)) return;
      if (opts.dropChrome && CHROME.has(name)) return;
      if (isNoteRef(el, name)) return;
      if (el.getAttribute('hidden') !== null || /display\s*:\s*none/i.test(el.getAttribute('style') ?? '')) return;
      const isBlock = BLOCK.has(name);
      if (anchors) {
        const id = el.getAttribute('id') ?? (name === 'a' ? el.getAttribute('name') : null);
        if (id && !anchors.has(id)) {
          // Block-level anchors start the next block (after flushing pending text);
          // inline anchors belong to the paragraph being built.
          anchors.set(id, blocks.length + (isBlock && /\S/.test(buf) ? 1 : 0));
        }
      }
      if (name === 'br') {
        flush();
        return;
      }
      if (name === 'hr') {
        flush();
        return;
      }
      const heading = /^h([1-6])$/.exec(name);
      if (heading) {
        flush();
        const text = cleanInline(textOf(el));
        if (text) blocks.push({ kind: 'h', level: Number(heading[1]), text });
        return;
      }
      if (isBlock) flush();
      if (CELL.has(name)) appendText(' ');
      const pre = inPre || name === 'pre';
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c, pre);
      if (isBlock) flush();
      else if (CELL.has(name)) appendText(' ');
      return;
    }
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c, inPre);
  };

  walk(root, false);
  flush();
  return blocks;
}

/** Text of a heading element, skipping note refs and images; <br> becomes a space. */
function textOf(el: Element): string {
  let s = '';
  const rec = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) {
      s += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const name = tagName(e);
    if (SKIP.has(name) || isNoteRef(e, name)) return;
    if (name === 'br') {
      s += ' ';
      return;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) rec(c);
  };
  rec(el);
  return s;
}

/** Parse markup. XHTML is tried as XML first (keeps namespaces/ids), falling back to the forgiving HTML parser. */
export function parseMarkup(markup: string, preferXml: boolean): Document {
  const parser = new DOMParser();
  if (preferXml) {
    const doc = parser.parseFromString(markup, 'application/xhtml+xml');
    if (!doc.getElementsByTagName('parsererror').length && doc.documentElement) return doc;
  }
  return parser.parseFromString(markup, 'text/html');
}

/** <body> of a document (or the document element if no body). */
export function bodyOf(doc: Document): Node {
  return doc.body ?? doc.getElementsByTagName('body')[0] ?? doc.documentElement ?? doc;
}

/** Convert an HTML string to blocks. */
export function htmlToBlocks(markup: string, opts: HtmlToBlocksOptions & { xml?: boolean } = {}): Block[] {
  return domToBlocks(bodyOf(parseMarkup(markup, opts.xml ?? false)), opts);
}

/** Parse an XML document; throws on malformed XML. */
export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML parse error');
  return doc;
}

/** Elements by local name, ignoring namespaces / prefixes. */
export function byLocalName(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) out.push(all[i]);
  return out;
}

/** First element by local name. */
export function firstByLocalName(root: Document | Element, name: string): Element | null {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) return all[i];
  return null;
}

/** Direct children by local name. */
export function childrenByLocalName(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => localName(c) === name);
}

export { localName };

/** Charset declared in an HTML <meta> or XML declaration (first 4 KB, ASCII). */
export function declaredCharset(head: string): string | null {
  const xml = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head);
  if (xml) return xml[1];
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return meta ? meta[1] : null;
}
