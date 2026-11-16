/** EPUB 2/3: container.xml -> OPF -> manifest/spine, nav.xhtml / toc.ncx for titles. */
import type { ParsedBook, ParsedSection } from '../core/types';
import { ParseError, corrupt, drmError } from './errors';
import { byLocalName, childrenByLocalName, domToBlocks, firstByLocalName, bodyOf, parseMarkup, parseXml } from './html';
import { type Block, cleanInline, prettifyHeading, titleFromFileName, wordCount, yieldToUi } from './textUtils';
import { openZip, resolveZipPath, type ZipArchive } from './zip';

interface ManifestItem {
  id: string;
  href: string; // resolved zip path
  mediaType: string;
  properties: string;
}

interface TocEntry {
  title: string;
  path: string; // resolved zip path, no fragment
  fragment: string | null;
  depth: number;
}

/** Font obfuscation algorithms: these do not protect content. */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];

/**
 * DRM = META-INF/encryption.xml encrypting something other than fonts with a real cipher
 * (Adobe ADEPT, Readium LCP, Apple FairPlay, ...). Font obfuscation is harmless and ignored.
 */
export async function checkEpubDrm(zip: ZipArchive): Promise<void> {
  if (!zip.has('META-INF/encryption.xml')) return;
  const xml = await zip.text('META-INF/encryption.xml');
  const isFont = (uri: string) => /\.(otf|ttf|woff2?|eot)$/i.test(uri.split('#')[0]) || /fonts?\//i.test(uri);
  let doc: Document | null = null;
  try {
    doc = parseXml(xml);
  } catch {
    doc = null;
  }
  if (!doc) {
    // Unparseable: fall back to looking at the algorithms used.
    const algos = [...xml.matchAll(/Algorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((a) => !/xmldsig|c14n|xml-exc/i.test(a));
    if (algos.some((a) => !FONT_OBFUSCATION.includes(a))) throw drmError('ebook');
    return;
  }
  for (const data of byLocalName(doc, 'EncryptedData')) {
    const algo = firstByLocalName(data, 'EncryptionMethod')?.getAttribute('Algorithm') ?? '';
    const uri = firstByLocalName(data, 'CipherReference')?.getAttribute('URI') ?? '';
    if (FONT_OBFUSCATION.includes(algo)) continue;
    if (isFont(uri)) continue;
    throw drmError('ebook');
  }
}

function text(el: Element | null | undefined): string {
  return cleanInline(el?.textContent ?? '');
}

/** EPUB3 nav document -> flat TOC. */
function parseNav(doc: Document, navPath: string): TocEntry[] {
  const navs = byLocalName(doc, 'nav');
  const toc = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') ?? n.getAttribute('type') ?? '')) ?? navs[0];
  if (!toc) return [];
  const out: TocEntry[] = [];
  const walkList = (ol: Element, depth: number) => {
    for (const li of childrenByLocalName(ol, 'li')) {
      const a = childrenByLocalName(li, 'a')[0] ?? childrenByLocalName(li, 'span')[0];
      const href = a?.getAttribute('href');
      const title = text(a);
      if (a && href && title) {
        const [p, frag] = href.split('#');
        out.push({ title, path: p ? resolveZipPath(navPath, p) : navPath, fragment: frag ? safeDecode(frag) : null, depth });
      }
      for (const sub of childrenByLocalName(li, 'ol')) walkList(sub, depth + 1);
    }
  };
  for (const ol of childrenByLocalName(toc, 'ol')) walkList(ol, 0);
  return out;
}

/** EPUB2 NCX -> flat TOC. */
function parseNcx(doc: Document, ncxPath: string): TocEntry[] {
  const out: TocEntry[] = [];
  const navMap = firstByLocalName(doc, 'navMap');
  if (!navMap) return out;
  const walk = (el: Element, depth: number) => {
    for (const np of childrenByLocalName(el, 'navPoint')) {
      const label = text(firstByLocalName(childrenByLocalName(np, 'navLabel')[0] ?? np, 'text'));
      const src = childrenByLocalName(np, 'content')[0]?.getAttribute('src');
      if (label && src) {
        const [p, frag] = src.split('#');
        out.push({ title: label, path: resolveZipPath(ncxPath, p), fragment: frag ? safeDecode(frag) : null, depth });
      }
      walk(np, depth + 1);
    }
  };
  walk(navMap, 0);
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const RE_COPYRIGHT = /copyright|\u00A9|all rights reserved|isbn|published by|first (?:published|edition)|printed in|library of congress|cataloging/gi;

/** Short front/back-matter page that is only copyright boilerplate. */
function isCopyrightOnly(blocks: Block[]): boolean {
  const all = blocks.map((b) => b.text).join(' ');
  if (wordCount(all) > 250) return false;
  const hits = new Set((all.match(RE_COPYRIGHT) ?? []).map((h) => h.toLowerCase()));
  return hits.size >= 2;
}

/** A printed table of contents page: most paragraphs are TOC titles. */
function isTocPage(blocks: Block[], tocTitles: Set<string>): boolean {
  const paras = blocks.filter((b) => b.kind === 'p');
  if (paras.length < 3 || tocTitles.size < 3) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[\s.\d]+$/, '').trim();
  const hits = paras.filter((p) => tocTitles.has(norm(p.text))).length;
  return hits / paras.length >= 0.6;
}

export async function parseEpubBytes(bytes: Uint8Array, fileName: string, onProgress?: (f: number) => void): Promise<ParsedBook> {
  const zip = await openZip(bytes, 'EPUB');
  await checkEpubDrm(zip);

  // container.xml -> OPF path (fallback: first .opf in the archive)
  let opfPath: string | null = null;
  if (zip.has('META-INF/container.xml')) {
    try {
      const c = parseXml(await zip.text('META-INF/container.xml'));
      opfPath = firstByLocalName(c, 'rootfile')?.getAttribute('full-path') ?? null;
    } catch {
      /* fall through */
    }
  }
  if (!opfPath || !zip.has(opfPath)) opfPath = zip.names.find((n) => n.toLowerCase().endsWith('.opf')) ?? null;
  if (!opfPath) throw corrupt('EPUB');
  opfPath = zip.find(opfPath) ?? opfPath;

  let opf: Document;
  try {
    opf = parseXml(await zip.text(opfPath));
  } catch (e) {
    throw corrupt('EPUB', e);
  }

  // metadata
  const metadata = firstByLocalName(opf, 'metadata');
  const title = metadata ? text(firstByLocalName(metadata, 'title')) : '';
  const creators = metadata ? byLocalName(metadata, 'creator') : [];
  // Prefer creators with role aut (EPUB2 attribute or EPUB3 refines)
  const refines = new Map<string, string>();
  if (metadata)
    for (const m of byLocalName(metadata, 'meta')) {
      if (m.getAttribute('property') === 'role' && m.getAttribute('refines')) refines.set(m.getAttribute('refines')!.slice(1), text(m));
    }
  const authors = creators
    .filter((c) => {
      const role = c.getAttribute('opf:role') ?? c.getAttribute('role') ?? refines.get(c.getAttribute('id') ?? '') ?? 'aut';
      return role === 'aut';
    })
    .map((c) => text(c))
    .filter(Boolean);
  const author = (authors.length ? authors : creators.map((c) => text(c)).filter(Boolean)).slice(0, 3).join(', ') || undefined;

  // manifest
  const manifest = new Map<string, ManifestItem>();
  for (const it of byLocalName(opf, 'item')) {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href: resolveZipPath(opfPath, href),
      mediaType: (it.getAttribute('media-type') ?? '').toLowerCase(),
      properties: it.getAttribute('properties') ?? '',
    });
  }

  // spine
  const spineEl = firstByLocalName(opf, 'spine');
  const spine: { item: ManifestItem; linear: boolean }[] = [];
  if (spineEl) {
    for (const ref of childrenByLocalName(spineEl, 'itemref')) {
      const item = manifest.get(ref.getAttribute('idref') ?? '');
      if (item) spine.push({ item, linear: ref.getAttribute('linear') !== 'no' });
    }
  }
  if (!spine.length) {
    // Broken OPF: fall back to all XHTML documents in manifest order.
    for (const item of manifest.values()) if (/html/.test(item.mediaType)) spine.push({ item, linear: true });
  }
  if (!spine.length) throw corrupt('EPUB');

  // TOC: EPUB3 nav first, then NCX
  let toc: TocEntry[] = [];
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.properties));
  if (navItem && zip.has(navItem.href)) {
    try {
      toc = parseNav(parseMarkup(await zip.text(navItem.href), true), navItem.href);
    } catch {
      toc = [];
    }
  }
  if (!toc.length) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => m.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem && zip.has(ncxItem.href)) {
      try {
        toc = parseNcx(parseXml(await zip.text(ncxItem.href)), ncxItem.href);
      } catch {
        toc = [];
      }
    }
  }
  const tocByPath = new Map<string, TocEntry[]>();
  for (const t of toc) {
    const key = (zip.find(t.path) ?? t.path).toLowerCase();
    if (!tocByPath.has(key)) tocByPath.set(key, []);
    tocByPath.get(key)!.push(t);
  }
  const tocTitles = new Set(toc.map((t) => t.title.toLowerCase().replace(/[\s.\d]+$/, '').trim()));

  // guide references (EPUB2) for toc/cover pages
  const guideSkip = new Set<string>();
  for (const ref of byLocalName(opf, 'reference')) {
    const type = (ref.getAttribute('type') ?? '').toLowerCase();
    const href = ref.getAttribute('href');
    if (href && (type === 'toc' || type === 'cover')) guideSkip.add(resolveZipPath(opfPath, href).toLowerCase());
  }

  // Walk the spine.
  const sections: ParsedSection[] = [];
  let anyText = false;
  for (let i = 0; i < spine.length; i++) {
    onProgress?.(0.05 + (0.9 * i) / spine.length);
    if (i % 10 === 9) await yieldToUi();
    const { item, linear } = spine[i];
    if (item === navItem || /\bnav\b/.test(item.properties)) continue;
    if (!/html|xml/.test(item.mediaType) && !/\.x?html?$/i.test(item.href)) continue;
    const real = zip.find(item.href);
    if (!real) continue;
    let doc: Document;
    try {
      doc = parseMarkup(await zip.text(real), true);
    } catch {
      continue;
    }
    const anchors = new Map<string, number>();
    const blocks = domToBlocks(bodyOf(doc), { anchors });
    if (!blocks.length) continue; // cover image page, blank page
    anyText = true;
    const entries = tocByPath.get(real.toLowerCase()) ?? [];
    const isFrontOrBack = i < Math.max(3, spine.length * 0.2) || i > spine.length * 0.9 || !linear;
    if (entries.length === 0 && isFrontOrBack) {
      if (isCopyrightOnly(blocks)) continue;
      if (guideSkip.has(real.toLowerCase()) && isTocPage(blocks, tocTitles)) continue;
    }
    if (isTocPage(blocks, tocTitles) && entries.length <= 1 && wordCount(blocks.map((b) => b.text).join(' ')) < 2000) continue;

    // Split points within this file: TOC entries with fragments (first one without fragment = file start).
    const splits: { at: number; title: string }[] = [];
    for (const e of entries) {
      const at = e.fragment ? anchors.get(e.fragment) : 0;
      if (at === undefined) continue;
      if (splits.some((s) => s.at === at)) continue;
      splits.push({ at: Math.min(at, blocks.length), title: e.title });
    }
    // In the TOC but no fragment resolved: the whole file is that entry.
    if (splits.length === 0 && entries.length) splits.push({ at: 0, title: entries[0].title });
    splits.sort((a, b) => a.at - b.at);

    const blocksToText = (bs: Block[], title: string) => {
      // Drop a leading heading that just repeats the section title.
      let start = 0;
      if (bs[0]?.kind === 'h' && sameTitle(bs[0].text, title)) start = 1;
      return bs
        .slice(start)
        .map((b) => b.text)
        .join('\n\n');
    };

    if (splits.length === 0) {
      const heading = blocks.find((b) => b.kind === 'h');
      const leadingHeading = blocks[0]?.kind === 'h' ? blocks[0] : null;
      if (toc.length && !leadingHeading && sections.length) {
        // Continuation of the previous chapter (books split into several files).
        const prev = sections[sections.length - 1];
        const body = blocksToText(blocks, prev.title);
        sections[sections.length - 1] = { title: prev.title, text: prev.text ? `${prev.text}\n\n${body}` : body };
        continue;
      }
      const title = heading && blocks.indexOf(heading) < 3 ? prettifyHeading(heading.text) : '';
      sections.push({ title, text: blocksToText(blocks, title) });
      continue;
    }
    if (splits[0].at > 0) {
      const pre = blocks.slice(0, splits[0].at);
      const preText = pre.map((b) => b.text).join('\n\n');
      if (sections.length && wordCount(preText) > 0) {
        const prev = sections[sections.length - 1];
        sections[sections.length - 1] = { title: prev.title, text: prev.text ? `${prev.text}\n\n${preText}` : preText };
      } else if (preText) {
        sections.push({ title: '', text: preText });
      }
    }
    for (let s = 0; s < splits.length; s++) {
      const end = s + 1 < splits.length ? splits[s + 1].at : blocks.length;
      const part = blocks.slice(splits[s].at, end);
      const body = blocksToText(part, splits[s].title);
      if (!body && s + 1 < splits.length) {
        // Empty section (e.g. "Part One" right before "Chapter 1"): merge the title into the next one.
        splits[s + 1] = { at: splits[s + 1].at, title: `${splits[s].title}: ${splits[s + 1].title}` };
        continue;
      }
      sections.push({ title: splits[s].title, text: body });
    }
  }

  if (!anyText || !sections.some((s) => s.text.trim())) {
    throw new ParseError('empty', 'This EPUB has no readable text (it may contain only images, e.g. a comic or scanned book).');
  }
  const nonEmpty = sections.filter((s) => s.text.trim());
  let n = 0;
  const finalSections = nonEmpty.map((s) => {
    n++;
    return { title: s.title || `Section ${n}`, text: s.text };
  });

  onProgress?.(0.97);
  const cover = await findCover(zip, opf, manifest, opfPath).catch(() => undefined);
  return { title: title || titleFromFileName(fileName), author, cover, sections: finalSections.length ? finalSections : [{ title: 'Section 1', text: '' }] };
}

function sameTitle(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return !!a && !!b && (n(a) === n(b) || n(b).endsWith(n(a)) || n(a).endsWith(n(b)));
}

const IMAGE_TYPES = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;

async function findCover(zip: ZipArchive, opf: Document, manifest: Map<string, ManifestItem>, opfPath: string): Promise<Blob | undefined> {
  const items = [...manifest.values()];
  let cover = items.find((m) => /\bcover-image\b/.test(m.properties));
  if (!cover) {
    const metaCover = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    if (metaCover) cover = manifest.get(metaCover) ?? items.find((m) => m.href.endsWith(metaCover));
  }
  if (!cover) cover = items.find((m) => IMAGE_TYPES.test(m.mediaType) && /cover/i.test(m.id + ' ' + m.href));
  if (!cover) {
    // Guide cover page -> first <img>
    const ref = byLocalName(opf, 'reference').find((r) => (r.getAttribute('type') ?? '').toLowerCase() === 'cover');
    const href = ref?.getAttribute('href');
    if (href) {
      const pagePath = resolveZipPath(opfPath, href);
      if (zip.has(pagePath)) {
        const page = parseMarkup(await zip.text(pagePath), true);
        const img = byLocalName(page, 'img')[0] ?? byLocalName(page, 'image')[0];
        const src = img?.getAttribute('src') ?? img?.getAttribute('xlink:href') ?? img?.getAttribute('href');
        if (src) {
          const p = resolveZipPath(pagePath, src);
          cover = items.find((m) => m.href.toLowerCase() === p.toLowerCase()) ?? { id: 'cover', href: p, mediaType: '', properties: '' };
        }
      }
    }
  }
  if (!cover || !zip.has(cover.href)) return undefined;
  if (cover.mediaType && !IMAGE_TYPES.test(cover.mediaType)) return undefined;
  const data = await zip.bytes(cover.href);
  return new Blob([data as BlobPart], { type: cover.mediaType || sniffImageType(data) });
}

export function sniffImageType(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) return 'image/webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return 'application/octet-stream';
}
