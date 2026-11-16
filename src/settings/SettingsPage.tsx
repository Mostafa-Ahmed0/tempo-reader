import { useEffect, useId, useState, type CSSProperties } from 'react';
import { version as APP_VERSION } from '../../package.json';
import {
  DEFAULT_SETTINGS,
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
import { focusIndexes } from '../core/text';
import { Button, Modal, PageHeader, Slider, toast, Toggle } from '../ui';
import { loadParsers } from '../library/importer';
import { formatList } from '../library/logic';
import { XIcon } from '../library/XIcon';
import { NumberField, RadioGroup, Row, Section } from './controls';
import { DataSection } from './DataSection';
import { LivePreview } from './LivePreview';
import '../library/controls.css';
import './settings.css';

export const HIGHLIGHT_PRESETS: { value: string; name: string }[] = [
  { value: '#ff4d4d', name: 'Red' },
  { value: '#ff8a3d', name: 'Orange' },
  { value: '#e9b872', name: 'Amber' },
  { value: '#3ccf7a', name: 'Green' },
  { value: '#3fa9ff', name: 'Blue' },
  { value: '#b77dff', name: 'Violet' },
  { value: '#ff5fa2', name: 'Pink' },
];

const MODES: { value: HighlightMode; name: string; help: string }[] = [
  { value: 'orp', name: 'Recognition point', help: 'Slightly left of centre, where the eye recognises a word fastest. Recommended.' },
  { value: 'middle', name: 'Middle letter', help: 'The exact centre letter of each word.' },
  { value: 'first-middle', name: 'First + middle', help: 'Marks the first letter and the centre letter, giving two anchors.' },
  { value: 'none', name: 'No highlight', help: 'Plain words, still aligned on the same point.' },
];

const THEMES: { value: ThemeName; name: string }[] = [
  { value: 'dark', name: 'Dark' },
  { value: 'light', name: 'Light' },
  { value: 'sepia', name: 'Sepia' },
  { value: 'black', name: 'Black' },
];

const FONTS: { value: FontFamily; name: string }[] = [
  { value: 'sans', name: 'Sans' },
  { value: 'serif', name: 'Serif' },
  { value: 'mono', name: 'Mono' },
  { value: 'dyslexic', name: 'Legible' },
];

function ModeExample({ word, mode }: { word: string; mode: HighlightMode }) {
  const idx = new Set(focusIndexes(word, mode));
  return (
    <span className="mode-example" aria-hidden="true">
      {Array.from(word).map((ch, i) => (
        <span key={i} className={idx.has(i) ? 'is-focus' : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const set = s.set;
  const [resetOpen, setResetOpen] = useState(false);
  const [formats, setFormats] = useState<string[] | null>(null);
  const ids = {
    wpm: useId(),
    chunk: useId(),
    mode: useId(),
    color: useId(),
    theme: useId(),
    font: useId(),
    rampStart: useId(),
    rampTarget: useId(),
    rampStep: useId(),
    rampInterval: useId(),
    goal: useId(),
    rewind: useId(),
  };

  useEffect(() => {
    let alive = true;
    loadParsers().then(
      (p) => alive && setFormats(p.SUPPORTED_EXTENSIONS),
      () => alive && setFormats([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  const customColor = !HIGHLIGHT_PRESETS.some((p) => p.value.toLowerCase() === s.highlightColor.toLowerCase());
  const rampDisabled = !s.rampEnabled;
  const p = (patch: Partial<Settings>) => set(patch);

  return (
    <div className="page settings">
      <PageHeader title="Settings" subtitle="Changes apply immediately and are saved on this device." />
      <LivePreview />

      <Section id="reading" title="Reading">
        <div className="set-row set-row--stack">
          <div className="wpm-row">
            <Slider
              id={ids.wpm}
              label="Default speed"
              value={s.wpm}
              min={WPM_MIN}
              max={WPM_MAX}
              step={10}
              onChange={(v) => p({ wpm: v })}
              format={(v) => `${v} wpm`}
              className="wpm-row__slider"
            />
            <NumberField value={s.wpm} min={WPM_MIN} max={WPM_MAX} step={1} unit="wpm" ariaLabel="Default speed, exact value" onCommit={(v) => p({ wpm: v })} />
          </div>
          <span className="set-row__help">Most people start around 250–350 wpm. You can also change speed while reading.</span>
        </div>

        <Row label="Words per frame" labelId={ids.chunk} help="Show one word at a time, or short groups of two or three.">
          <RadioGroup
            labelledBy={ids.chunk}
            value={s.chunkSize}
            onChange={(v) => p({ chunkSize: v })}
            options={[1, 2, 3].map((n) => ({ value: n as 1 | 2 | 3, label: String(n), ariaLabel: `${n} ${n === 1 ? 'word' : 'words'}` }))}
          />
        </Row>

        <Toggle
          label="Smart pacing"
          description="Longer pauses at punctuation, long words and paragraph ends."
          checked={s.smartPacing}
          onChange={(v) => p({ smartPacing: v })}
        />
        <div className={`set-row set-row--stack${s.smartPacing ? '' : ' tm-is-dim'}`}>
          <Slider
            label="Pause at sentence ends"
            value={s.punctuationPause}
            min={PUNCTUATION_PAUSE_MIN}
            max={PUNCTUATION_PAUSE_MAX}
            step={0.25}
            onChange={(v) => p({ punctuationPause: v })}
            format={(v) => `${v.toFixed(2).replace(/0$/, '')}×`}
          />
          <span className="set-row__help">
            How much longer the last word of a sentence stays on screen{s.smartPacing ? '.' : ' (used when smart pacing is on).'}
          </span>
        </div>
        <Toggle label="Soft start" description="Ease up to full speed over the first few words after you press play." checked={s.softStart} onChange={(v) => p({ softStart: v })} />
        <Row label="Rewind on resume" htmlFor={ids.rewind} help="Words to step back when you continue after a pause, so you regain the thread.">
          <NumberField id={ids.rewind} value={s.rewindOnResume} min={0} max={100} unit="words" onCommit={(v) => p({ rewindOnResume: v })} />
        </Row>
      </Section>

      <Section id="focus" title="Focus letter" description="One letter of every word is highlighted so your eyes have a fixed point to rest on.">
        <div className="set-row set-row--stack">
          <span id={ids.mode} className="set-row__label">
            Highlight
          </span>
          <RadioGroup
            variant="cards"
            labelledBy={ids.mode}
            value={s.highlightMode}
            onChange={(v) => p({ highlightMode: v })}
            className="mode-cards"
            options={MODES.map((m) => ({
              value: m.value,
              label: (
                <span className="mode-card">
                  <span className="mode-card__head">
                    <span className="mode-card__name">{m.name}</span>
                    <ModeExample word="reading" mode={m.value} />
                  </span>
                  <span className="mode-card__help">{m.help}</span>
                </span>
              ),
            }))}
          />
        </div>

        <div className="set-row set-row--stack">
          <span id={ids.color} className="set-row__label">
            Highlight colour
          </span>
          <div className="tm-swatches">
            <RadioGroup
              variant="cards"
              labelledBy={ids.color}
              value={customColor ? '' : s.highlightColor.toLowerCase()}
              onChange={(v) => v && p({ highlightColor: v })}
              className="swatch-group"
              options={HIGHLIGHT_PRESETS.map((c) => ({
                value: c.value,
                ariaLabel: c.name,
                className: 'tm-swatch',
                label: <span className="tm-swatch__dot" style={{ background: c.value }} />,
              }))}
            />
            <label className={`tm-swatch tm-swatch--custom${customColor ? ' is-selected' : ''}`} title="Custom colour">
              <span className="tm-swatch__dot" style={customColor ? { background: s.highlightColor } : undefined} />
              <input
                type="color"
                className="tm-swatch__input"
                value={/^#[0-9a-f]{6}$/i.test(s.highlightColor) ? s.highlightColor : '#ff4d4d'}
                onChange={(e) => p({ highlightColor: e.target.value })}
                aria-label="Custom highlight colour"
              />
            </label>
          </div>
        </div>
        <Toggle label="Focus guides" description="Small tick marks above and below the focus letter." checked={s.showFocusGuides} onChange={(v) => p({ showFocusGuides: v })} />
      </Section>

      <Section id="appearance" title="Appearance">
        <div className="set-row set-row--stack">
          <span id={ids.theme} className="set-row__label">
            Theme
          </span>
          <RadioGroup
            variant="cards"
            labelledBy={ids.theme}
            value={s.theme}
            onChange={(v) => p({ theme: v })}
            className="theme-cards"
            options={THEMES.map((t) => ({
              value: t.value,
              className: `theme-card theme-card--${t.value}`,
              label: (
                <>
                  <span className="theme-card__preview" aria-hidden="true">
                    <span className="theme-card__word">
                      re<b style={{ color: s.highlightColor }}>a</b>d
                    </span>
                  </span>
                  <span className="theme-card__name">{t.name}</span>
                </>
              ),
            }))}
          />
        </div>
        <div className="set-row set-row--stack">
          <span id={ids.font} className="set-row__label">
            Reading font
          </span>
          <RadioGroup
            variant="cards"
            labelledBy={ids.font}
            value={s.fontFamily}
            onChange={(v) => p({ fontFamily: v })}
            className="font-cards"
            options={FONTS.map((f) => ({
              value: f.value,
              className: 'font-card',
              label: (
                <>
                  <span className="font-card__sample" style={{ fontFamily: `var(--font-${f.value})` } as CSSProperties} aria-hidden="true">
                    Aa
                  </span>
                  <span className="font-card__name">{f.name}</span>
                </>
              ),
            }))}
          />
          {s.fontFamily === 'dyslexic' ? <span className="set-row__help">Uses OpenDyslexic, Atkinson Hyperlegible or Lexend when installed on this device, otherwise Verdana.</span> : null}
        </div>
        <Slider label="Word size" value={s.fontSize} min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step={2} onChange={(v) => p({ fontSize: v })} format={(v) => `${v} px`} />
      </Section>

      <Section
        id="training"
        title="Speed training"
        description="Starts each reading session at a comfortable speed and raises it step by step while you read, until it reaches your target."
      >
        <Toggle label="Speed training" checked={s.rampEnabled} onChange={(v) => p({ rampEnabled: v })} />
        <div className="ramp-grid">
          <div className="tm-field">
            <label htmlFor={ids.rampStart}>Start at</label>
            <NumberField
              id={ids.rampStart}
              value={s.rampStartWpm}
              min={WPM_MIN}
              max={WPM_MAX}
              step={5}
              unit="wpm"
              disabled={rampDisabled}
              validate={(v) => (v >= s.rampTargetWpm ? `Must be below the target (${s.rampTargetWpm} wpm).` : null)}
              onCommit={(v) => p({ rampStartWpm: v })}
            />
          </div>
          <div className="tm-field">
            <label htmlFor={ids.rampTarget}>Target</label>
            <NumberField
              id={ids.rampTarget}
              value={s.rampTargetWpm}
              min={WPM_MIN}
              max={WPM_MAX}
              step={5}
              unit="wpm"
              disabled={rampDisabled}
              validate={(v) => (v <= s.rampStartWpm ? `Must be above the start (${s.rampStartWpm} wpm).` : null)}
              onCommit={(v) => p({ rampTargetWpm: v })}
            />
          </div>
          <div className="tm-field">
            <label htmlFor={ids.rampStep}>Increase by</label>
            <NumberField id={ids.rampStep} value={s.rampStepWpm} min={1} max={500} unit="wpm" disabled={rampDisabled} onCommit={(v) => p({ rampStepWpm: v })} />
          </div>
          <div className="tm-field">
            <label htmlFor={ids.rampInterval}>Every</label>
            <NumberField id={ids.rampInterval} value={s.rampIntervalSec} min={5} max={3600} step={5} unit="sec" disabled={rampDisabled} onCommit={(v) => p({ rampIntervalSec: v })} />
          </div>
        </div>
        {s.rampEnabled && s.rampTargetWpm > s.rampStartWpm ? (
          <p className="set-row__help ramp-summary">
            {s.rampStartWpm} → {s.rampTargetWpm} wpm in about{' '}
            {formatRampTime(Math.ceil((s.rampTargetWpm - s.rampStartWpm) / Math.max(1, s.rampStepWpm)) * s.rampIntervalSec)} of reading.
          </p>
        ) : null}
        {s.rampStartWpm >= s.rampTargetWpm ? (
          <p className="tm-numfield__error" role="alert">
            The start speed must be below the target speed.
          </p>
        ) : null}
      </Section>

      <Section id="habits" title="Habits">
        <Row label="Daily goal" htmlFor={ids.goal} help="Minutes of reading per day, shown as a ring on the Stats page. 0 turns the goal off.">
          <NumberField id={ids.goal} value={s.dailyGoalMinutes} min={0} max={600} unit="min" onCommit={(v) => p({ dailyGoalMinutes: v })} />
        </Row>
        <Toggle label="Keep screen awake" description="Stops the screen from dimming while words are playing." checked={s.keepAwake} onChange={(v) => p({ keepAwake: v })} />
        <Toggle
          label="Show context on pause"
          description="When you pause, show the surrounding sentence so you can find your place."
          checked={s.showContextOnPause}
          onChange={(v) => p({ showContextOnPause: v })}
        />
      </Section>

      <DataSection />

      <Section id="about" title="About">
        <dl className="tm-about">
          <div>
            <dt>Version</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div>
            <dt>Supported formats</dt>
            <dd>{formats === null ? 'Loading…' : formats.length ? formatList(formats) : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Privacy</dt>
            <dd>Your books never leave this device. No account, no tracking.</dd>
          </div>
        </dl>
      </Section>

      <div className="set-reset">
        <Button variant="ghost" onClick={() => setResetOpen(true)}>
          <XIcon name="refresh" size={18} />
          Reset settings to defaults
        </Button>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset all settings?"
        placement="center"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                s.reset();
                setResetOpen(false);
                toast('Settings reset to defaults');
              }}
            >
              Reset
            </Button>
          </>
        }
      >
        <p>
          Speed, focus letter, appearance, training and habit settings go back to their defaults ({DEFAULT_SETTINGS.wpm} wpm, dark theme). Your
          books, progress and stats are not touched.
        </p>
      </Modal>
    </div>
  );
}

function formatRampTime(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}
