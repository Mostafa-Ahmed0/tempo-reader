import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSettings } from '../core/settings';
import { previewFrames } from '../reader/pacing';
import { WordDisplay } from '../reader/WordDisplay';
import { Icon } from '../ui';

export const PREVIEW_TEXT =
  'Reading one word at a time keeps your eyes still, so the words come to you. Notice the coloured letter: rest your gaze there, and let the sentence flow. Faster? Slower? Adjust and feel the difference.';
const PREVIEW_WORDS = PREVIEW_TEXT.split(/\s+/).filter(Boolean);

/** Largest word size the preview renders, as a share of the viewport height (keeps the sticky header ≤ ~25 %). */
const MAX_PREVIEW_VH = 0.065;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/**
 * Sticky RSVP preview cycling through a sample sentence with the reader's own pacing
 * (`previewFrames` from src/reader/pacing) and the reader's `WordDisplay`.
 */
export function LivePreview() {
  const wpm = useSettings((s) => s.wpm);
  const chunkSize = useSettings((s) => s.chunkSize);
  const smartPacing = useSettings((s) => s.smartPacing);
  const punctuationPause = useSettings((s) => s.punctuationPause);
  const fontSize = useSettings((s) => s.fontSize);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const frames = useMemo(
    () => previewFrames(PREVIEW_WORDS, { wpm, smartPacing, punctuationPause, chunkSize }),
    [wpm, smartPacing, punctuationPause, chunkSize],
  );
  const [index, setIndex] = useState(0);
  const i = Math.min(index, Math.max(0, frames.length - 1));
  const vh = useViewportHeight();
  // WordDisplay reads the size from settings. Inside the preview only, a CSS override caps the rendered
  // size (see .tm-preview__viewport--capped): WordDisplay then measures the real, capped glyphs, so the
  // focus letter stays aligned (a CSS zoom/transform would break its measurements).
  const maxSize = Math.max(24, Math.round(vh * MAX_PREVIEW_VH));
  const capped = fontSize > maxSize;
  const scale = capped ? maxSize / fontSize : 1;

  useEffect(() => {
    if (!playing || !frames.length) return;
    const atEnd = i >= frames.length - 1;
    const t = setTimeout(() => setIndex(atEnd ? 0 : i + 1), frames[i].durationMs + (atEnd ? 900 : 0));
    return () => clearTimeout(t);
  }, [playing, i, frames]);

  // pause while the tab is hidden
  useEffect(() => {
    const onVis = () => document.hidden && setPlaying(false);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <section className="tm-preview" aria-label="Live preview">
      <div
        className={`tm-preview__viewport${capped ? ' tm-preview__viewport--capped' : ''}`}
        style={capped ? ({ '--tm-preview-size': `${maxSize}px` } as CSSProperties) : undefined}
      >
        {/* remount when the cap changes so WordDisplay re-measures the newly sized glyphs */}
        <WordDisplay key={capped ? maxSize : 'full'} text={frames[i]?.text ?? ''} className="tm-preview__stage" />
      </div>
      <div className="tm-preview__bar">
        <button
          type="button"
          className="tm-preview__play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          aria-pressed={playing}
          title={playing ? 'Pause preview' : 'Play preview'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <span className="tm-preview__label">
          Preview · <strong>{wpm} wpm</strong>
          {chunkSize > 1 ? ` · ${chunkSize} words` : ''}
          {scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''}
        </span>
        <span className="tm-preview__progress" aria-hidden="true">
          <span style={{ width: `${frames.length ? ((i + 1) / frames.length) * 100 : 0}%` }} />
        </span>
      </div>
    </section>
  );
}
