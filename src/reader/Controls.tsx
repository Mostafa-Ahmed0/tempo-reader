import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { WPM_MAX, WPM_MIN, useSettings } from '../core/settings';
import { estimateMinutes, formatDuration } from '../core/text';
import type { TokenizedBook } from '../core/types';
import type { ReaderEngine } from './engine';
import { useEngineState, useFrameSelector, useHoldRepeat } from './hooks';
import { floorIndex } from './pacing';
import { ReaderIcon } from './ReaderIcon';
import { WordDisplay } from './WordDisplay';

const clampWpm = (v: number) => Math.round(Math.min(WPM_MAX, Math.max(WPM_MIN, v)));

/** The only component that re-renders on every frame. */
export const LiveWord = memo(function LiveWord({ engine, dir }: { engine: ReaderEngine; dir: 'ltr' | 'rtl' }) {
  const text = useFrameSelector(engine, (f) => f.text);
  return <WordDisplay text={text} dir={dir} />;
});

/** Thin always-visible progress line; updated imperatively, never re-renders. */
export const ProgressLine = memo(function ProgressLine({ engine }: { engine: ReaderEngine }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const set = () => {
      const el = ref.current;
      if (el) el.style.transform = `scaleX(${engine.total ? engine.position / engine.total : 0})`;
    };
    set();
    return engine.onFrame(set);
  }, [engine]);
  return (
    <div className="rd-reader__line" aria-hidden="true">
      <div ref={ref} className="rd-reader__line-fill" />
    </div>
  );
});

export function chapterIndexAt(chapters: TokenizedBook['chapters'], i: number): number {
  let lo = 0;
  let hi = chapters.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chapters[mid].wordIndex <= i) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const pctText = (index: number, total: number) => `${total ? Math.floor((index / total) * 100) : 0}%`;

/** Whole-book scrubber: drag to seek; shows chapter + % while dragging. */
export function Scrubber({ engine, tok }: { engine: ReaderEngine; tok: TokenizedBook }) {
  const total = engine.total;
  const playing = useEngineState(engine).playing;
  // While playing, quantise to 0.1 % so this re-renders ~1000 times per book, not once per word.
  const shown = useFrameSelector(engine, (f) =>
    engine.getState().playing && total ? Math.round((Math.floor((f.index / total) * 1000) / 1000) * total) : f.index,
  );
  void playing;
  // the engine seeks live while dragging, so the shown position is the drag position
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDragging(false); // the pointer may be released outside the slider
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging]);
  const max = Math.max(0, total - 1);
  const value = Math.min(max, shown);
  const step = Math.max(1, Math.round(total / 1000));
  const ch = chapterIndexAt(tok.chapters, value);
  const pct = max ? (value / max) * 100 : 0;

  return (
    <div className="rd-scrubber">
      <input
        type="range"
        className="slider__input rd-scrubber__input"
        min={0}
        max={max}
        step={step}
        value={value}
        aria-label="Position in book"
        aria-valuetext={`${pctText(value, total)}${ch >= 0 ? `, ${tok.chapters[ch].title}` : ''}`}
        style={{ '--fill': `${pct}%` } as CSSProperties}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        onChange={(e) => engine.seek(Number(e.currentTarget.value))}
      />
      {dragging ? (
        <div className="rd-scrubber__bubble" style={{ '--pos': `${pct}%` } as CSSProperties} aria-hidden="true">
          <span className="rd-scrubber__bubble-pct">{pctText(value, total)}</span>
          {ch >= 0 ? <span className="rd-scrubber__bubble-ch">{tok.chapters[ch].title}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** "37% · 2 h 05 min left · Chapter 3" */
export function ProgressStats({ engine, tok }: { engine: ReaderEngine; tok: TokenizedBook }) {
  const total = engine.total;
  const { wpm } = useEngineState(engine);
  // re-render when the position moves by 1/2000 of the book (not per word); exact values are read at render
  useFrameSelector(engine, (f) => (total ? Math.floor((f.index / total) * 2000) : 0));
  const exact = engine.position;
  const ch = chapterIndexAt(tok.chapters, Math.min(exact, total - 1));
  const left = formatDuration(estimateMinutes(Math.max(0, total - exact), wpm) * 60000);
  return (
    <div className="rd-reader__stats">
      <span className="rd-reader__pct">{pctText(exact, total)}</span>
      <span className="rd-reader__dot" aria-hidden="true">
        ·
      </span>
      <span>{left} left</span>
      {ch >= 0 && tok.chapters.length > 1 ? (
        <>
          <span className="rd-reader__dot" aria-hidden="true">
            ·
          </span>
          <span className="rd-reader__chapter" title={tok.chapters[ch].title}>
            {tok.chapters[ch].title}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** WPM slider + number field + −/+ (hold to repeat). All commit to settings and to the engine. */
export function SpeedControl({ engine }: { engine: ReaderEngine }) {
  const { wpm, training, trainingDone } = useEngineState(engine);
  const target = useSettings((s) => s.rampTargetWpm);
  const setSettings = useSettings((s) => s.set);
  const id = useId();

  const change = (v: number) => {
    if (!Number.isFinite(v)) return;
    const w = clampWpm(v);
    setSettings({ wpm: w });
    engine.setWpm(w);
  };
  const minus = useHoldRepeat(() => change(engine.getState().wpm - 10));
  const plus = useHoldRepeat(() => change(engine.getState().wpm + 10));

  const [draft, setDraft] = useState(String(wpm));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(wpm));
  }, [wpm]);

  const pct = ((wpm - WPM_MIN) / (WPM_MAX - WPM_MIN)) * 100;
  return (
    <div className="rd-speed">
      <div className="rd-speed__row">
        <button type="button" className="btn btn--ghost btn--md btn--icon rd-speed__step" aria-label="Slower (−10 wpm)" title="Slower (↓)" {...minus}>
          <ReaderIcon name="minus" />
        </button>
        <input
          id={`${id}-range`}
          type="range"
          className="slider__input rd-speed__range"
          min={WPM_MIN}
          max={WPM_MAX}
          step={10}
          value={wpm}
          aria-label="Words per minute"
          aria-valuetext={`${wpm} words per minute`}
          style={{ '--fill': `${pct}%` } as CSSProperties}
          onChange={(e) => change(Number(e.currentTarget.value))}
        />
        <button type="button" className="btn btn--ghost btn--md btn--icon rd-speed__step" aria-label="Faster (+10 wpm)" title="Faster (↑)" {...plus}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <label className="rd-speed__num">
          <input
            type="number"
            inputMode="numeric"
            min={WPM_MIN}
            max={WPM_MAX}
            step={10}
            value={draft}
            aria-label="Words per minute (type a value)"
            onFocus={(e) => {
              focused.current = true;
              e.currentTarget.select();
            }}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setDraft(v);
              const n = Number(v);
              if (v !== '' && Number.isInteger(n) && n >= WPM_MIN && n <= WPM_MAX) change(n);
            }}
            onBlur={() => {
              focused.current = false;
              const n = Number(draft);
              if (draft.trim() !== '' && Number.isFinite(n)) change(n);
              setDraft(String(clampWpm(draft.trim() !== '' && Number.isFinite(n) ? n : engine.getState().wpm)));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(String(engine.getState().wpm));
                e.currentTarget.blur();
                e.stopPropagation();
              }
            }}
          />
          <span aria-hidden="true">wpm</span>
        </label>
      </div>
      {training ? (
        <p className="rd-speed__training" role="status">
          <span className="rd-speed__training-dot" aria-hidden="true" />
          {trainingDone ? `Speed training: target ${target} wpm reached` : `Speed training · ${wpm} → ${target} wpm`}
        </p>
      ) : null}
    </div>
  );
}

/** Surrounding paragraphs as normal text, shown while paused. Renders only a window around the position. */
export function ContextView({ engine, tok, dir, onSeek }: { engine: ReaderEngine; tok: TokenizedBook; dir: 'ltr' | 'rtl'; onSeek: (i: number) => void }) {
  const index = useFrameSelector(engine, (f) => Math.min(f.index, engine.total - 1));
  const count = useFrameSelector(engine, (f) => Math.max(1, f.count));
  const boxRef = useRef<HTMLDivElement>(null);
  const { paragraphStarts, chapterStarts } = engine.analysis;
  const total = engine.total;

  // window: 2 paragraphs before, 2 after, but never more than ~350 words on either side
  const p = Math.max(0, floorIndex(paragraphStarts, index));
  const pFirst = Math.max(0, p - 2);
  const pLast = Math.min(paragraphStarts.length - 1, p + 2);
  const start = Math.max(paragraphStarts[pFirst] ?? 0, index - 350);
  const endPara = pLast + 1 < paragraphStarts.length ? paragraphStarts[pLast + 1] : total;
  const end = Math.min(endPara, index + 350);

  const blocks: { key: number; heading?: string; from: number; to: number }[] = [];
  for (let k = Math.max(0, floorIndex(paragraphStarts, start)); k < paragraphStarts.length && paragraphStarts[k] < end; k++) {
    const ps = paragraphStarts[k];
    const pe = k + 1 < paragraphStarts.length ? paragraphStarts[k + 1] : total;
    const from = Math.max(ps, start);
    const to = Math.min(pe, end);
    if (to <= from) continue;
    const ci = from === ps ? floorIndex(chapterStarts, ps) : -1;
    const heading = ci >= 0 && chapterStarts[ci] === ps ? tok.chapters.find((c) => c.wordIndex === ps)?.title : undefined;
    blocks.push({ key: ps, heading, from, to });
  }

  useLayoutEffect(() => {
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>('.rd-ctx__w.is-current');
    if (!box || !el) return;
    box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2);
  }, [index]);

  return (
    <div
      ref={boxRef}
      className="rd-ctx"
      dir={dir}
      onClick={(e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (t) {
          e.stopPropagation();
          onSeek(Number(t.dataset.i));
        }
      }}
    >
      {start > 0 ? <p className="rd-ctx__more" aria-hidden="true">…</p> : null}
      {blocks.map((b) => (
        <div key={b.key} className="rd-ctx__block">
          {b.heading ? <h3 className="rd-ctx__heading">{b.heading}</h3> : null}
          <p className="rd-ctx__p" dir="auto">
            {renderWords(tok.words, b.from, b.to, index, count)}
          </p>
        </div>
      ))}
      {end < total ? <p className="rd-ctx__more" aria-hidden="true">…</p> : null}
    </div>
  );
}

function renderWords(words: readonly string[], from: number, to: number, cur: number, count: number) {
  const out = [];
  for (let i = from; i < to; i++) {
    const current = i >= cur && i < cur + count;
    out.push(
      <span key={i} data-i={i} className={current ? 'rd-ctx__w is-current' : 'rd-ctx__w'} aria-current={current ? 'true' : undefined}>
        {words[i]}
      </span>,
      ' ',
    );
  }
  return out;
}
