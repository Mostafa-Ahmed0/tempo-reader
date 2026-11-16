import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { formatPageOf, nextPageStart, pageAccessibleLabel, pageAt, pageRange, prevPageStart, type PageMap } from '../core/pages';
import { pageMeasure, useSettings } from '../core/settings';
import type { TokenizedBook } from '../core/types';
import { renderWords, textBlocks } from './Controls';
import type { Frame, ReaderEngine } from './engine';
import { clusterRange, frameFocusInWords } from './frameLayout';
import { useFrameSelector } from './hooks';
import { ReaderIcon } from './ReaderIcon';

/** Name of the CSS Custom Highlight used for the focus letters (see reader.css `::highlight(rd-focus)`). */
const FOCUS_HIGHLIGHT = 'rd-focus';

type HighlightCtor = new (...ranges: AbstractRange[]) => { add(r: AbstractRange): void; clear(): void };
type Registry = { set(name: string, h: unknown): void; delete(name: string): void };

function highlightApi(): { Ctor: HighlightCtor; registry: Registry } | null {
  const g = globalThis as { Highlight?: HighlightCtor; CSS?: { highlights?: Registry } };
  return g.Highlight && g.CSS?.highlights ? { Ctor: g.Highlight, registry: g.CSS.highlights } : null;
}

const noop = () => {};

/**
 * Colour the focus letters of one word span. With the CSS Custom Highlight API the text stays one
 * untouched run (shaping of Arabic/Indic scripts is kept and nothing in the DOM changes); without it the
 * letters are wrapped in spans for as long as the word is current. Returns the undo function.
 */
function markFocus(el: HTMLElement, letters: number[], hl: { add(r: AbstractRange): void; clear(): void } | null): () => void {
  const node = el.firstChild;
  if (!(node instanceof Text) || !letters.length) return noop;
  const word = node.data;
  const ranges = letters
    .map((cp) => clusterRange(word, cp))
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return noop;
  if (hl && typeof document.createRange === 'function') {
    for (const [s, e] of ranges) {
      const r = document.createRange();
      r.setStart(node, s);
      r.setEnd(node, e);
      hl.add(r);
    }
    return () => hl.clear();
  }
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const [s, e] of ranges) {
    if (s < at) continue;
    if (s > at) frag.append(word.slice(at, s));
    const mark = document.createElement('span');
    mark.className = 'rd-page__focus';
    mark.textContent = word.slice(s, e);
    frag.append(mark);
    at = e;
  }
  if (at < word.length) frag.append(word.slice(at));
  el.replaceChildren(frag);
  return () => {
    el.textContent = word;
  };
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Keep `el` inside a comfortable band of the scroll box (from 12 % to 75 % of its height). Scrolls only
 * when the word leaves the band, then places it at ~30 %: while playing that is one calm, smooth scroll
 * every few lines instead of a jump per word. `instant` for the first placement on a page.
 */
function keepInView(box: HTMLElement, el: HTMLElement, instant: boolean) {
  const h = box.clientHeight;
  if (!h) return;
  const view = box.scrollTop;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + view;
  if (top >= view + h * 0.12 && top + el.offsetHeight <= view + h * 0.75) return;
  const target = Math.max(0, Math.min(box.scrollHeight - h, top - h * 0.3));
  if (Math.abs(target - view) < 2) return;
  // a word already outside the visible box (seek, or a smooth scroll that never ran, e.g. in a hidden
  // WebView) is placed at once; otherwise one smooth scroll, not re-issued on every word while it runs
  const outside = top + el.offsetHeight < view || top > view + h;
  if (instant || outside || reducedMotion() || typeof box.scrollTo !== 'function') {
    box.scrollTop = target;
    smoothUntil.delete(box);
    return;
  }
  const now = performance.now();
  if ((smoothUntil.get(box) ?? 0) > now) return;
  smoothUntil.set(box, now + SMOOTH_MS);
  box.scrollTo({ top: target, behavior: 'smooth' });
}

/** Rough duration of a browser smooth scroll; no new one is started for the same box meanwhile. */
const SMOOTH_MS = 450;
const smoothUntil = new WeakMap<HTMLElement, number>();
/** After the reader scrolls the page by hand, auto-scroll leaves it alone for this long. */
export const MANUAL_SCROLL_HOLD_MS = 2500;

/**
 * Page view: the whole current page (same pages as the page indicator) as flowing text, with the current
 * word or word group highlighted like the word view highlights it. Re-renders only on a page change;
 * the highlight is moved imperatively on every frame (a class on 1–3 spans and the focus letters).
 */
export const PageView = memo(function PageView({
  engine,
  tok,
  pages,
  dir,
  onSeek,
}: {
  engine: ReaderEngine;
  tok: TokenizedBook;
  pages: PageMap;
  dir: 'ltr' | 'rtl';
  /** A word was tapped (the reader decides whether that jumps). */
  onSeek: (index: number) => void;
}) {
  const total = engine.total;
  const page = useFrameSelector(engine, (f) => pageAt(pages, Math.min(f.index, Math.max(0, total - 1))));
  const [from, to] = pageRange(pages, page, total);
  const mode = useSettings((s) => s.highlightMode);
  const wordsPerLine = useSettings((s) => s.pageWordsPerLine);
  const boxRef = useRef<HTMLDivElement>(null);
  // until when auto-scroll holds back because the reader scrolled by hand (wheel, touch, scrollbar drag)
  const manualUntil = useRef(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let dragging = false;
    const hold = () => (manualUntil.current = performance.now() + MANUAL_SCROLL_HOLD_MS);
    const onDown = (e: PointerEvent) => {
      if (e.target === box) dragging = true; // on the box itself, not a word: its scrollbar
    };
    const onUp = () => (dragging = false);
    const onScroll = () => {
      if (dragging) hold();
    };
    box.addEventListener('wheel', hold, { passive: true });
    box.addEventListener('touchmove', hold, { passive: true });
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      box.removeEventListener('wheel', hold);
      box.removeEventListener('touchmove', hold);
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const body = useMemo(
    () =>
      textBlocks(engine, tok, from, to).map((b) => (
        <div key={b.key} className="rd-ctx__block">
          {b.heading ? <h3 className="rd-ctx__heading">{b.heading}</h3> : null}
          <p className="rd-ctx__p" dir="auto">
            {renderWords(tok.words, b.from, b.to, -1, 0)}
          </p>
        </div>
      )),
    [engine, tok, from, to],
  );

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const spans = box.querySelectorAll<HTMLElement>('[data-i]'); // in order: spans[i - from]
    const api = highlightApi();
    const hl = api ? new api.Ctor() : null;
    if (api && hl) api.registry.set(FOCUS_HIGHLIGHT, hl);
    let marked: HTMLElement[] = [];
    let undoFocus = noop;
    let first = true;
    const clear = () => {
      for (const el of marked) el.classList.remove('is-current');
      marked = [];
      undoFocus();
      undoFocus = noop;
    };
    const apply = (f: Frame) => {
      clear();
      const lo = Math.max(f.index, from);
      const hi = Math.min(f.index + f.count, to);
      for (let i = lo; i < hi; i++) {
        const el = spans[i - from];
        if (el) {
          el.classList.add('is-current');
          marked.push(el);
        }
      }
      if (!marked.length) return; // the frame is on another page: this view is about to re-render
      const focus = frameFocusInWords(engine.words, f.index, f.count, mode);
      const fe = focus && focus.word >= from && focus.word < to ? spans[focus.word - from] : undefined;
      if (focus && fe) undoFocus = markFocus(fe, focus.letters, hl);
      if (first || performance.now() >= manualUntil.current) keepInView(box, marked[0], first);
      first = false;
    };
    apply(engine.getFrame());
    const off = engine.onFrame(apply);
    return () => {
      off();
      clear();
      if (api) api.registry.delete(FOCUS_HIGHLIGHT);
    };
  }, [engine, from, to, mode, body]);

  const prev = prevPageStart(pages, from);
  const next = nextPageStart(pages, from, total);

  return (
    <section className="rd-page" aria-label={`Page view, ${pageAccessibleLabel(pages, from)}`}>
      {/* part of the reader's chrome: fades with it while playing */}
      <div className="rd-page__bar rd-reader__chrome">
        <button
          type="button"
          className="btn btn--ghost btn--sm btn--icon"
          aria-label="Previous page"
          title="Previous page (Page Up)"
          disabled={prev === null}
          onClick={() => prev !== null && engine.seek(prev)}
        >
          <ReaderIcon name={dir === 'rtl' ? 'sentence-forward' : 'sentence-back'} />
        </button>
        <span className="rd-page__num">{formatPageOf(pages, from)}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm btn--icon"
          aria-label="Next page"
          title="Next page (Page Down)"
          disabled={next === null}
          onClick={() => next !== null && engine.seek(next)}
        >
          <ReaderIcon name={dir === 'rtl' ? 'sentence-back' : 'sentence-forward'} />
        </button>
      </div>
      <div
        ref={boxRef}
        className="rd-page__text"
        dir={dir}
        style={{ '--rd-measure': pageMeasure(wordsPerLine) } as CSSProperties}
        onClick={(e) => {
          const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
          if (t) onSeek(Number(t.dataset.i));
        }}
      >
        {body}
      </div>
    </section>
  );
});

/**
 * About how many words fit on one line of the page view on this screen right now (the box width minus
 * the side gutters, in average words of the page font, see PAGE_EM_PER_WORD), or null when the page view
 * is not on screen. Lets the settings say honestly when the screen, not the setting, limits the width.
 */
export function pageLineFit(): number | null {
  const box = document.querySelector<HTMLElement>('.rd-page__text');
  if (!box) return null;
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;width:${pageMeasure(1)}`;
  box.append(probe);
  const wordPx = probe.getBoundingClientRect().width;
  probe.remove();
  const gutter = 2 * Number.parseFloat(getComputedStyle(box).getPropertyValue('--gutter') || '16');
  const room = box.clientWidth - (Number.isFinite(gutter) ? gutter : 32);
  return wordPx > 0 && room > 0 ? Math.max(1, Math.floor(room / wordPx)) : null;
}
