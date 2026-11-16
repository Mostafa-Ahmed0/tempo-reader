import { memo, useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useSettings } from '../core/settings';
import { clusterRange, frameFocus, textDirection } from './frameLayout';
import './word-display.css';

export interface WordDisplayProps {
  /** One RSVP frame: a single token, or 2–3 tokens separated by single spaces. */
  text: string;
  className?: string;
  /**
   * Reading direction of the surrounding text. Decides on which side the anchor line sits
   * (≈37–40 % from the start edge). Defaults to the direction of `text` itself; the reader passes
   * the book's dominant direction so the anchor never jumps for an odd foreign word.
   */
  dir?: 'ltr' | 'rtl';
}

/** Anchor position as a fraction of the stage width, measured from the reading-start edge. */
const anchorFraction = (width: number) => (width < 640 ? 0.37 : 0.4);
/** Minimum free space between a word and the stage edge, px. */
const EDGE_PAD = 6;
/** Long tokens shrink at most to this share of the chosen size before the anchor is allowed to slide. */
const MIN_SCALE = 0.6;

const supportsTextClip =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('background-clip', 'text') || CSS.supports('-webkit-background-clip', 'text')
    : false;

/**
 * One RSVP frame, drawn with the current settings (highlight mode/colour, font, size, guides).
 *
 * Technique (same for every script): the frame is ONE unbroken text run, so kerning, ligatures and
 * Arabic/Persian/Hebrew/Indic shaping are untouched. After layout we measure the focus letter with a
 * DOM Range, translate the run so the letter's centre lands on the anchor line, and colour the letter
 * with a hard-stop gradient clipped to the glyphs (`background-clip: text`). Too-long frames are
 * shrunk until they fit on both sides of the anchor. All of this happens in a layout effect, before
 * paint, so there is no visible jitter between words.
 */
export const WordDisplay = memo(function WordDisplay({ text, className, dir }: WordDisplayProps) {
  const mode = useSettings((s) => s.highlightMode);
  const fontSize = useSettings((s) => s.fontSize);
  const fontFamily = useSettings((s) => s.fontFamily);
  const guides = useSettings((s) => s.showFocusGuides);
  const color = useSettings((s) => s.highlightColor);

  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const stageDir = dir ?? textDirection(text);

  const layout = useCallback(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    const word = wordRef.current;
    if (!box || !line || !word) return;
    const boxW = box.clientWidth;
    const frac = anchorFraction(boxW);
    const anchorX = Math.round(boxW * (stageDir === 'rtl' ? 1 - frac : frac));
    box.style.setProperty('--rsvp-anchor', `${anchorX}px`);

    const node = word.firstChild;
    const { anchor, highlight } = frameFocus(text, mode);
    word.style.fontSize = `${fontSize}px`;
    if (!(node instanceof Text) || anchor < 0 || boxW === 0 || typeof document.createRange !== 'function') {
      line.style.transform = `translate3d(${anchorX}px,0,0)`;
      word.style.backgroundImage = '';
      word.classList.remove('rd-rsvp__word--clip');
      return;
    }

    const range = document.createRange();
    const rectOf = (cp: number): [number, number] | null => {
      const [s, e] = clusterRange(text, cp);
      if (e <= s) return null;
      range.setStart(node, s);
      range.setEnd(node, e);
      const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
      if (!r || (r.width === 0 && r.left === 0)) return null;
      return [r.left, r.right];
    };

    const measure = () => {
      const wr = word.getBoundingClientRect();
      const a = rectOf(anchor);
      const centre = a ? (a[0] + a[1]) / 2 - wr.left : wr.width / 2;
      return { left: wr.left, width: wr.width, centre };
    };

    let m = measure();
    // scale at which the frame fits with its focus letter on the anchor
    const roomAnchored = Math.min((anchorX - EDGE_PAD) / Math.max(1, m.centre), (boxW - anchorX - EDGE_PAD) / Math.max(1, m.width - m.centre));
    if (roomAnchored < 1) {
      // Very long tokens: rather than shrinking below MIN_SCALE to keep the anchor, shrink to MIN_SCALE
      // (or to the full stage width if even that is too wide) and let the word slide off the anchor.
      const roomFull = (boxW - 2 * EDGE_PAD) / Math.max(1, m.width);
      const scale = roomAnchored >= MIN_SCALE ? roomAnchored : Math.min(1, Math.max(roomAnchored, Math.min(MIN_SCALE, roomFull)));
      // Font scaling is not perfectly linear (hinting), so shave a little extra and measure again.
      word.style.fontSize = `${Math.max(8, Math.floor(fontSize * scale * 0.97 * 10) / 10)}px`;
      m = measure();
    }
    // focus letter on the anchor, unless that would push the word past an edge (only after sliding)
    const shift = Math.min(Math.max(anchorX - m.centre, EDGE_PAD), Math.max(EDGE_PAD, boxW - EDGE_PAD - m.width));
    // All reads happen before the transform write: offsets are relative to the word's own box.
    const spans =
      highlight.length && supportsTextClip
        ? highlight
            .map(rectOf)
            .filter((r): r is [number, number] => r !== null)
            .map(([l, r]) => [l - m.left, r - m.left] as [number, number])
            .sort((x, y) => x[0] - y[0])
        : [];
    line.style.transform = `translate3d(${shift.toFixed(2)}px,0,0)`;
    if (!spans.length) {
      word.style.backgroundImage = '';
      word.classList.remove('rd-rsvp__word--clip');
      return;
    }
    const stops: string[] = ['var(--rsvp-ink) 0px'];
    for (const [l, r] of spans) {
      stops.push(`var(--rsvp-ink) ${l.toFixed(2)}px`, `var(--focus) ${l.toFixed(2)}px`, `var(--focus) ${r.toFixed(2)}px`, `var(--rsvp-ink) ${r.toFixed(2)}px`);
    }
    stops.push('var(--rsvp-ink) 100%');
    word.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
    word.classList.add('rd-rsvp__word--clip');
    // color is read so the effect re-runs when it changes (the gradient uses var(--focus))
    void color;
  }, [text, mode, fontSize, stageDir, color]);

  useLayoutEffect(layout, [layout, fontFamily]);

  // Re-measure on resize and when web fonts finish loading (glyph widths change).
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const run = () => layoutRef.current();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null;
    ro?.observe(box);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', run);
    fonts?.ready?.then(run).catch(() => {});
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', run);
    };
  }, []);

  return (
    <div
      ref={boxRef}
      className={['rd-rsvp', guides && 'rd-rsvp--guides', className].filter(Boolean).join(' ')}
      style={{ '--rsvp-size': `${fontSize}px`, fontFamily: `var(--font-${fontFamily})` } as CSSProperties}
      aria-hidden="true"
    >
      {guides ? (
        <>
          <span className="rd-rsvp__guide rd-rsvp__guide--top" />
          <span className="rd-rsvp__guide rd-rsvp__guide--bottom" />
        </>
      ) : null}
      <div ref={lineRef} className="rd-rsvp__line">
        <span ref={wordRef} className="rd-rsvp__word" dir="auto">
          {text}
        </span>
      </div>
    </div>
  );
});
