/**
 * PDF via pdf.js (legacy build for older Android WebViews; loaded with dynamic import, worker via Vite ?url).
 * Layout reconstruction lives in pdfLayout.ts. Chapters from the outline, else headings, else page ranges.
 */
import type { ParsedBook, ParsedSection } from '../core/types';
import { ParseError, corrupt } from './errors';
import { type Line, type PdfBlock, type PdfItem, itemsToLines, layoutLines, orderLines } from './pdfLayout';
import { type Block, cleanInline, dropTocRuns, fillTitles, sectionsFromBlocks, titleFromFileName, wordCount, yieldToUi } from './textUtils';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Load pdf.js once; in a browser, point it at the bundled worker (code-split asset). */
export function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
      const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }
    return pdfjs;
  })();
  return pdfjsPromise;
}

const PAGES_PER_CHUNK = 20;

export const scannedPdfError = () =>
  new ParseError(
    'scanned',
    'This PDF is a scanned image with no text layer, so there is nothing to read. Run it through OCR (e.g. a scanner app or Acrobat) and import the result.',
  );

export async function parsePdfBytes(bytes: Uint8Array, fileName: string, onProgress?: (f: number) => void): Promise<ParsedBook> {
  const pdfjs = await loadPdfjs();
  let doc: PdfDoc;
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    verbosity: 0,
    stopAtErrors: false,
  });
  // No onPassword handler: pdf.js then rejects with a PasswordException.
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException' || /password/i.test(String((e as Error)?.message))) {
      throw new ParseError('password', 'This PDF is password-protected. Remove the password (e.g. print it to a new PDF) and try again.');
    }
    throw corrupt('PDF', e);
  }

  try {
    const numPages = doc.numPages;
    const pages: { lines: Line[]; height: number }[] = [];
    let totalChars = 0;
    let textPages = 0;
    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const [x0, y0, x1, y1] = page.view;
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      let chars = 0;
      for (const it of content.items) {
        if (!('str' in it) || !it.str) continue;
        const t = it.transform as number[];
        // upright text only (skip rotated watermarks / vertical labels)
        if (!(t[0] > 0 && t[3] > 0 && Math.abs(t[1]) < t[0] * 0.05 && Math.abs(t[2]) < t[3] * 0.05)) continue;
        items.push({ str: it.str, x: t[4] - x0, y: t[5] - y0, width: it.width, size: Math.abs(t[3]) || it.height, eol: it.hasEOL });
        chars += it.str.replace(/\s+/g, '').length;
      }
      totalChars += chars;
      if (chars >= 30) textPages++;
      pages.push({ lines: orderLines(itemsToLines(items), x1 - x0), height: y1 - y0 });
      page.cleanup();
      onProgress?.((0.9 * i) / numPages);
      if (i % 5 === 0) await yieldToUi();
    }
    if (textPages === 0 || (textPages / numPages < 0.1 && totalChars / numPages < 50)) throw scannedPdfError();

    const { blocks, stats } = layoutLines(pages);
    if (!blocks.length) throw scannedPdfError();

    // metadata
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const xmpTitle = meta?.metadata?.get?.('dc:title');
    const xmpAuthor = meta?.metadata?.get?.('dc:creator');
    let title = pickTitle([info.Title, xmpTitle]);
    const author = pickAuthor([info.Author, xmpAuthor]);
    if (!title) {
      // Largest text on page 1 when it clearly stands out.
      const firstPage = blocks.filter((b) => b.page === 0 && b.text.length >= 3 && b.text.length <= 120);
      const big = firstPage.sort((a, b) => b.size - a.size)[0];
      if (big && big.size >= stats.bodySize * 1.5) title = big.text;
    }
    title ||= titleFromFileName(fileName);

    onProgress?.(0.92);
    const sections =
      (await outlineSections(doc, blocks, stats.bodySize).catch(() => null)) ?? headingSections(blocks, numPages) ?? pageSections(blocks, numPages);
    onProgress?.(0.96);
    const cover = await renderCover(doc).catch(() => undefined);
    return { title, author, cover, sections: fillTitles(sections) };
  } finally {
    void task.destroy();
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const RE_JUNK_TITLE =
  /^(?:untitled|document\d*|title|unknown|none|null|pdf|book|ebook|print|output|default|slide\s*\d*|microsoft\s+(?:word|powerpoint|excel)\b.*|.*\.(?:docx?|pdf|indd|tex|dvi|rtf|odt|pages|qxd|ps|txt|html?|xml|wpd|pub)|[\d_\s-]+|[a-f0-9]{16,}|.*\b(?:acrobat|distiller|pdfmaker|ghostscript|quartz)\b.*)$/i;

function firstString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(firstString).find(Boolean) ?? '';
  return '';
}

export function pickTitle(candidates: unknown[]): string {
  for (const c of candidates) {
    const t = cleanInline(firstString(c));
    if (t.length >= 2 && t.length <= 200 && !RE_JUNK_TITLE.test(t)) return t;
  }
  return '';
}

export function pickAuthor(candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const t = cleanInline(firstString(c));
    if (t.length >= 2 && t.length <= 150 && !/^(?:user|admin|administrator|owner|unknown|author|anonymous|default|test|windows user|microsoft.*|.*@.*)$/i.test(t)) return t;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

interface Mark {
  title: string;
  page: number;
  top: number; // Infinity = top of page
}

async function resolveDest(doc: PdfDoc, dest: OutlineNode['dest']): Promise<{ page: number; top: number } | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || !explicit.length) return null;
  const ref = explicit[0];
  let page: number | null = null;
  if (typeof ref === 'number') page = ref;
  else if (ref && typeof ref === 'object') page = await doc.getPageIndex(ref as Parameters<PdfDoc['getPageIndex']>[0]);
  if (page === null) return null;
  const kind = (explicit[1] as { name?: string } | undefined)?.name;
  let top = Infinity;
  if (kind === 'XYZ' && typeof explicit[3] === 'number') top = explicit[3];
  else if ((kind === 'FitH' || kind === 'FitBH') && typeof explicit[2] === 'number') top = explicit[2];
  return { page, top };
}

/** Sections from the PDF outline; null if there is no usable outline. */
async function outlineSections(doc: PdfDoc, blocks: PdfBlock[], bodySize: number): Promise<ParsedSection[] | null> {
  const outline = (await doc.getOutline()) as OutlineNode[] | null;
  if (!outline?.length) return null;
  let level: OutlineNode[] = outline;
  // Single root ("Book title") -> use its children.
  while (level.length === 1 && level[0].items?.length) level = level[0].items;
  const resolveAll = async (nodes: OutlineNode[]) => {
    const marks: Mark[] = [];
    for (const n of nodes) {
      const r = await resolveDest(doc, n.dest).catch(() => null);
      const title = cleanInline(n.title ?? '');
      if (r && title) marks.push({ title, page: r.page, top: r.top });
    }
    return marks;
  };
  let marks = await resolveAll(level);
  // Top level too coarse (e.g. a few "Parts" of 100 pages)? Include the next level.
  const numPages = doc.numPages;
  if (marks.length && numPages / marks.length > 40) {
    const flat: OutlineNode[] = [];
    for (const n of level) {
      flat.push(n);
      for (const c of n.items ?? []) flat.push(c);
    }
    if (flat.length > level.length) marks = await resolveAll(flat);
  }
  if (marks.length < 2) return null;
  marks.sort((a, b) => a.page - b.page || b.top - a.top);

  // Assign blocks to marks in reading order.
  const before = (b: PdfBlock, m: Mark) => b.page < m.page || (b.page === m.page && m.top !== Infinity && b.y > m.top + bodySize * 0.5);
  const buckets: { title: string; paras: string[] }[] = marks.map((m) => ({ title: m.title, paras: [] }));
  const front: string[] = [];
  let mi = -1;
  for (const b of blocks) {
    while (mi + 1 < marks.length && !before(b, marks[mi + 1])) mi++;
    if (mi < 0) front.push(b.text);
    else {
      const bucket = buckets[mi];
      // Skip a heading that repeats the outline title.
      if (bucket.paras.length === 0 && sameTitle(b.text, bucket.title)) continue;
      bucket.paras.push(b.text);
    }
  }
  const out: ParsedSection[] = [];
  let pendingTitle = '';
  for (const bk of buckets) {
    if (!bk.paras.length) {
      pendingTitle = pendingTitle ? `${pendingTitle}: ${bk.title}` : bk.title;
      continue;
    }
    out.push({ title: pendingTitle ? `${pendingTitle}: ${bk.title}` : bk.title, text: bk.paras.join('\n\n') });
    pendingTitle = '';
  }
  if (!out.length) return null;
  if (front.length) {
    const ft = front.join('\n\n');
    if (wordCount(ft) >= 40) out.unshift({ title: 'Front matter', text: ft });
    else out[0] = { title: out[0].title, text: `${ft}\n\n${out[0].text}` };
  }
  return out;
}

function sameTitle(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const x = n(a);
  const y = n(b);
  return !!x && !!y && (x === y || (x.length > 3 && y.endsWith(x)) || (y.length > 3 && x.endsWith(y)));
}

/** Sections from large-font / "Chapter N" headings; null if that doesn't give a sensible split. */
export function headingSections(blocks: PdfBlock[], numPages: number): ParsedSection[] | null {
  const headingSizes = [...new Set(blocks.filter((b) => b.kind === 'h').map((b) => Math.round(b.size)))].sort((a, b) => b - a);
  if (!headingSizes.length) return null;
  const asBlocks: Block[] = blocks.map((b) =>
    b.kind === 'h' ? { kind: 'h', text: b.text, level: Math.min(6, headingSizes.indexOf(Math.round(b.size)) + 1) } : { kind: 'p', text: b.text },
  );
  const sections = sectionsFromBlocks(dropTocRuns(asBlocks));
  if (sections.length < 2) return null;
  const words = sections.map((s) => wordCount(s.text));
  const avg = words.reduce((a, b) => a + b, 0) / sections.length;
  // Too fragmented (every page a "chapter", or tiny sections): not real chapters.
  if (avg < 150 || (sections.length > 60 && sections.length > numPages / 2)) return null;
  return sections;
}

/** One section, or chunks of PAGES_PER_CHUNK pages for long documents. */
export function pageSections(blocks: PdfBlock[], numPages: number): ParsedSection[] {
  if (numPages <= PAGES_PER_CHUNK * 1.5) return [{ title: '', text: blocks.map((b) => b.text).join('\n\n') }];
  const out: ParsedSection[] = [];
  for (let start = 0; start < numPages; start += PAGES_PER_CHUNK) {
    const end = Math.min(numPages, start + PAGES_PER_CHUNK);
    const text = blocks
      .filter((b) => b.page >= start && b.page < end)
      .map((b) => b.text)
      .join('\n\n');
    if (text) out.push({ title: `Pages ${start + 1}\u2013${end}`, text });
  }
  return out.length ? out : [{ title: '', text: '' }];
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

async function renderCover(doc: PdfDoc): Promise<Blob | undefined> {
  if (typeof document === 'undefined') return undefined;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 360 / Math.max(1, base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return undefined;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return new Promise<Blob | undefined>((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.8));
}
