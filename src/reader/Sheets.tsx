import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { addBookmark, deleteBookmark, listBookmarks } from '../core/db';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  PUNCTUATION_PAUSE_MAX,
  PUNCTUATION_PAUSE_MIN,
  WPM_MAX,
  WPM_MIN,
  useSettings,
  type FontFamily,
  type HighlightMode,
  type Settings,
  type ThemeName,
} from '../core/settings';
import { estimateMinutes, formatDuration } from '../core/text';
import type { Bookmark, TokenizedBook } from '../core/types';
import { Button, IconButton, Modal, Slider, Toggle, toast } from '../ui';
import { chapterIndexAt } from './Controls';
import type { ReaderEngine } from './engine';
import { floorValue } from './pacing';
import { WordDisplay } from './WordDisplay';

// ---------------------------------------------------------------- small form pieces

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="rd-seg">
      <legend className="rd-seg__legend">{label}</legend>
      <div className="rd-seg__track">
        {options.map((o) => (
          <label key={String(o.value)} className="rd-seg__opt" title={o.title}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <label className="rd-numfield">
      <span className="rd-numfield__label">{label}</span>
      <span className="rd-numfield__box">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            const n = Number(e.currentTarget.value);
            if (e.currentTarget.value !== '' && n >= min && n <= max) onChange(n);
          }}
          onBlur={() => {
            focused.current = false;
            const n = Number(draft);
            const v = draft.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
            onChange(v);
            setDraft(String(v));
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {suffix ? <span className="rd-numfield__suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- quick settings

const COLOR_PRESETS = [
  { value: '#ff4d4d', name: 'Red' },
  { value: '#ff9f1c', name: 'Orange' },
  { value: '#2ec4b6', name: 'Teal' },
  { value: '#3a86ff', name: 'Blue' },
  { value: '#c77dff', name: 'Violet' },
];

export function QuickSettings({ open, onClose, previewText }: { open: boolean; onClose: () => void; previewText: string }) {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => s.set(patch);
  const isPreset = COLOR_PRESETS.some((c) => c.value.toLowerCase() === s.highlightColor.toLowerCase());

  return (
    <Modal open={open} onClose={onClose} title="Reading settings" className="rd-qs">
      <div className="rd-qs__preview">
        <WordDisplay text={previewText || 'Reading'} />
      </div>

      <section className="rd-qs__group" aria-label="Highlight">
        <Segmented<HighlightMode>
          label="Highlight"
          value={s.highlightMode}
          onChange={(v) => set({ highlightMode: v })}
          options={[
            { value: 'orp', label: 'Focus', title: 'Optimal recognition point' },
            { value: 'middle', label: 'Middle' },
            { value: 'first-middle', label: 'First+mid' },
            { value: 'none', label: 'None' },
          ]}
        />
        <fieldset className="rd-seg">
          <legend className="rd-seg__legend">Highlight colour</legend>
          <div className="rd-swatches">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                className="rd-swatch"
                style={{ background: c.value }}
                aria-label={c.name}
                aria-pressed={c.value.toLowerCase() === s.highlightColor.toLowerCase()}
                onClick={() => set({ highlightColor: c.value })}
              />
            ))}
            <label className={`rd-swatch rd-swatch--custom${isPreset ? '' : ' is-on'}`} title="Custom colour">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(s.highlightColor) ? s.highlightColor : '#ff4d4d'} aria-label="Custom highlight colour" onChange={(e) => set({ highlightColor: e.currentTarget.value })} />
            </label>
          </div>
        </fieldset>
        <Toggle label="Focus guides" description="Tick marks above and below the focus letter" checked={s.showFocusGuides} onChange={(v) => set({ showFocusGuides: v })} />
      </section>

      <section className="rd-qs__group" aria-label="Text">
        <Slider label="Font size" value={s.fontSize} min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step={2} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
        <Segmented<FontFamily>
          label="Font"
          value={s.fontFamily}
          onChange={(v) => set({ fontFamily: v })}
          options={[
            { value: 'sans', label: <span style={{ fontFamily: 'var(--font-sans)' }}>Sans</span> },
            { value: 'serif', label: <span style={{ fontFamily: 'var(--font-serif)' }}>Serif</span> },
            { value: 'mono', label: <span style={{ fontFamily: 'var(--font-mono)' }}>Mono</span> },
            { value: 'dyslexic', label: <span style={{ fontFamily: 'var(--font-dyslexic)' }}>Legible</span>, title: 'Dyslexia-friendly' },
          ]}
        />
        <Segmented<1 | 2 | 3>
          label="Words per frame"
          value={s.chunkSize}
          onChange={(v) => set({ chunkSize: v })}
          options={[
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
          ]}
        />
      </section>

      <section className="rd-qs__group" aria-label="Pacing">
        <Toggle label="Smart pacing" description="Pause on punctuation, long words and paragraph ends; average speed is kept" checked={s.smartPacing} onChange={(v) => set({ smartPacing: v })} />
        {s.smartPacing ? (
          <Slider
            label="Sentence pause"
            value={s.punctuationPause}
            min={PUNCTUATION_PAUSE_MIN}
            max={PUNCTUATION_PAUSE_MAX}
            step={0.25}
            format={(v) => `×${v.toFixed(2)}`}
            onChange={(v) => set({ punctuationPause: v })}
          />
        ) : null}
        <Toggle label="Soft start" description="Ease into full speed after pressing play" checked={s.softStart} onChange={(v) => set({ softStart: v })} />
        <Slider label="Rewind on resume" value={s.rewindOnResume} min={0} max={20} format={(v) => (v ? `${v} words` : 'Off')} onChange={(v) => set({ rewindOnResume: v })} />
        <Toggle label="Show text when paused" checked={s.showContextOnPause} onChange={(v) => set({ showContextOnPause: v })} />
      </section>

      <section className="rd-qs__group" aria-label="Speed training">
        <Toggle label="Speed training" description="Start slower and speed up gradually while you read" checked={s.rampEnabled} onChange={(v) => set({ rampEnabled: v })} />
        {s.rampEnabled ? (
          <div className="rd-qs__grid">
            <NumberField label="Start" suffix="wpm" value={s.rampStartWpm} min={WPM_MIN} max={WPM_MAX} step={10} onChange={(v) => set({ rampStartWpm: v })} />
            <NumberField label="Target" suffix="wpm" value={s.rampTargetWpm} min={WPM_MIN} max={WPM_MAX} step={10} onChange={(v) => set({ rampTargetWpm: v })} />
            <NumberField label="Step" suffix="wpm" value={s.rampStepWpm} min={1} max={500} onChange={(v) => set({ rampStepWpm: v })} />
            <NumberField label="Every" suffix="s" value={s.rampIntervalSec} min={5} max={3600} step={5} onChange={(v) => set({ rampIntervalSec: v })} />
          </div>
        ) : null}
      </section>

      <section className="rd-qs__group" aria-label="Appearance">
        <Segmented<ThemeName>
          label="Theme"
          value={s.theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'sepia', label: 'Sepia' },
            { value: 'black', label: 'Black' },
          ]}
        />
        <Toggle label="Keep screen on" description="While playing" checked={s.keepAwake} onChange={(v) => set({ keepAwake: v })} />
      </section>
    </Modal>
  );
}

// ---------------------------------------------------------------- bookmarks

/** ~15 words around `i`, starting at most 3 words back but never before the paragraph start `minFrom`. */
export function excerptAt(words: readonly string[], i: number, minFrom = 0): string {
  const from = Math.max(0, minFrom, i - 3);
  const text = words.slice(from, Math.min(words.length, i + 12)).join(' ');
  return `${from > 0 ? '…' : ''}${text}${i + 12 < words.length ? '…' : ''}`;
}

export async function createBookmark(bookId: string, engine: ReaderEngine): Promise<Bookmark> {
  const pos = Math.min(engine.position, engine.total - 1);
  const para = floorValue(engine.analysis.paragraphStarts, pos, 0);
  return addBookmark({ bookId, position: Math.max(0, pos), excerpt: excerptAt(engine.words, pos, para), note: '' });
}

export function BookmarksSheet({ open, onClose, bookId, engine, tok }: { open: boolean; onClose: () => void; bookId: string; engine: ReaderEngine; tok: TokenizedBook }) {
  const [list, setList] = useState<Bookmark[] | null>(null);
  const refresh = () => listBookmarks(bookId).then(setList, () => setList([]));
  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookId]);

  const add = async () => {
    await createBookmark(bookId, engine);
    toast('Bookmark added', { kind: 'success' });
    void refresh();
  };
  const remove = async (b: Bookmark) => {
    await deleteBookmark(b.id);
    void refresh();
    toast('Bookmark deleted', {
      action: {
        label: 'Undo',
        onClick: () => void addBookmark({ bookId: b.bookId, position: b.position, excerpt: b.excerpt, note: b.note }).then(refresh),
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bookmarks"
      footer={
        <Button variant="primary" onClick={add} data-autofocus>
          Bookmark this spot
        </Button>
      }
    >
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted">No bookmarks yet. Add one to come back to this spot later.</p>
      ) : (
        <ul className="rd-blist">
          {list.map((b) => {
            const ch = chapterIndexAt(tok.chapters, b.position);
            const pct = engine.total ? Math.floor((b.position / engine.total) * 100) : 0;
            return (
              <li key={b.id} className="rd-blist__item">
                <button
                  type="button"
                  className="rd-blist__jump"
                  onClick={() => {
                    engine.seek(b.position);
                    onClose();
                  }}
                >
                  <span className="rd-blist__meta">
                    {pct}%{ch >= 0 && tok.chapters.length > 1 ? ` · ${tok.chapters[ch].title}` : ''} · {new Date(b.createdAt).toLocaleDateString()}
                  </span>
                  <span className="rd-blist__excerpt" dir="auto">
                    {b.excerpt}
                  </span>
                </button>
                <IconButton icon="trash" label="Delete bookmark" size="sm" onClick={() => void remove(b)} />
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- chapters

export function ChaptersSheet({ open, onClose, engine, tok }: { open: boolean; onClose: () => void; engine: ReaderEngine; tok: TokenizedBook }) {
  const current = chapterIndexAt(tok.chapters, Math.min(engine.position, engine.total - 1));
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus();
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Chapters">
      <ul className="rd-clist" ref={listRef}>
        {tok.chapters.map((c, i) => {
          const next = tok.chapters[i + 1]?.wordIndex ?? engine.total;
          return (
            <li key={`${c.wordIndex}`}>
              <button
                type="button"
                className="rd-clist__item"
                aria-current={i === current ? 'true' : undefined}
                onClick={() => {
                  engine.seek(c.wordIndex);
                  onClose();
                }}
              >
                <span className="rd-clist__title" dir="auto">
                  {c.title}
                </span>
                <span className="rd-clist__meta">{formatDuration(estimateMinutes(next - c.wordIndex, engine.getState().wpm) * 60000)} · {engine.total ? Math.floor((c.wordIndex / engine.total) * 100) : 0}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

// ---------------------------------------------------------------- keyboard help

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← / →', 'Previous / next sentence'],
  ['Shift + ← / →', 'Previous / next paragraph'],
  ['↑ / ↓', 'Faster / slower (±10 wpm)'],
  ['B', 'Add bookmark'],
  ['C', 'Chapters'],
  ['S', 'Reading settings'],
  ['?', 'This help'],
  ['Esc', 'Back to library'],
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" placement="center">
      <dl className="rd-keys">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="rd-keys__row">
            <dt>
              {k.split(' ').map((part, i) => (part === '+' || part === '/' ? <span key={i}> {part} </span> : <kbd key={i}>{part}</kbd>))}
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
