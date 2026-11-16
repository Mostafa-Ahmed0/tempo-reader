import { useRef, type KeyboardEvent } from 'react';
import type { ReaderView } from './Reader';
import { ReaderIcon } from './ReaderIcon';

const OPTIONS: { value: ReaderView; label: string; icon: 'word-view' | 'page-view' }[] = [
  { value: 'word', label: 'Word', icon: 'word-view' },
  { value: 'page', label: 'Page', icon: 'page-view' },
];

/**
 * Word | Page switch: a two-option radiogroup drawn as a track whose thumb slides to the chosen
 * side and stays there. Click/tap a side, or focus it and use the arrow keys (roving tabindex).
 * The reader's own P shortcut toggles it from anywhere.
 */
export function ViewSwitch({ view, onChange }: { view: ReaderView; onChange: (v: ReaderView) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: ReaderView | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Home') next = 'word';
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'End') next = 'page';
    if (!next) return;
    // handled here: the reader's window shortcuts (arrows = sentence / speed) skip prevented events
    e.preventDefault();
    onChange(next);
    refs.current[next === 'word' ? 0 : 1]?.focus();
  };

  return (
    <div
      className={`rd-viewswitch${view === 'page' ? ' is-page' : ''}`}
      role="radiogroup"
      aria-label="Reading view"
      onKeyDown={onKeyDown}
      // a tap on the switch must not also toggle playback on the stage behind it
      onClick={(e) => e.stopPropagation()}
    >
      <span className="rd-viewswitch__thumb" aria-hidden="true" />
      {OPTIONS.map((o, i) => {
        const checked = view === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="rd-viewswitch__opt"
            title={`${o.label} view (P)`}
            onClick={() => onChange(o.value)}
          >
            <ReaderIcon name={o.icon} size={18} />
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
