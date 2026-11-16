import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { addSession, savePosition } from '../core/db';
import { registerBackHandler } from '../platform/backButton';
import { useSettings, type Settings } from '../core/settings';
import { nextPageStart, pageMapOf, prevPageStart } from '../core/pages';
import { formatDuration } from '../core/text';
import type { Book, TokenizedBook } from '../core/types';
import { Button, Icon, IconButton, toast } from '../ui';
import { ContextView, LiveWord, ProgressLine, ProgressStats, Scrubber, SpeedControl } from './Controls';
import { ReaderEngine, type EngineOptions } from './engine';
import { dominantDirection } from './frameLayout';
import { useEngineState, useWakeLock } from './hooks';
import { PageView } from './PageView';
import { ViewSwitch } from './ViewSwitch';
import { ReaderIcon } from './ReaderIcon';
import { BookmarksSheet, ChaptersSheet, createBookmark, QuickSettings, ShortcutsHelp } from './Sheets';

/** Readings shorter than this are not stored as sessions. */
export const MIN_SESSION_MS = 5000;
/** A pause longer than this closes the current reading session. */
export const SESSION_IDLE_MS = 120_000;
const SAVE_EVERY_MS = 5000;
const HIDE_CHROME_AFTER_PLAY_MS = 1200;
const HIDE_CHROME_AFTER_POKE_MS = 2500;

export function engineOptions(s: Settings): EngineOptions {
  return {
    wpm: s.wpm,
    chunkSize: s.chunkSize,
    smartPacing: s.smartPacing,
    punctuationPause: s.punctuationPause,
    softStart: s.softStart,
    rewindOnResume: s.rewindOnResume,
    rampEnabled: s.rampEnabled,
    rampStartWpm: s.rampStartWpm,
    rampTargetWpm: s.rampTargetWpm,
    rampStepWpm: s.rampStepWpm,
    rampIntervalSec: s.rampIntervalSec,
  };
}

type SheetName = 'settings' | 'bookmarks' | 'chapters' | 'help';
/** 'word' = RSVP (the default every time a book is opened), 'page' = the whole current page as text. */
export type ReaderView = 'word' | 'page';

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(el.type);
}

export function Reader({ book, tok }: { book: Book; tok: TokenizedBook }) {
  const navigate = useNavigate();
  // created once per book; later settings changes are pushed in via setOptions
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => new ReaderEngine(tok, engineOptions(useSettings.getState()), book.position), [tok, book.id]);
  const dir = useMemo(() => dominantDirection(tok.words), [tok]);
  // real pages when the book has them (PDF), else the estimate; in the reader's own word space
  const pages = useMemo(() => pageMapOf({ wordCount: tok.words.length, pageStarts: book.pageStarts }), [tok, book.pageStarts]);
  const state = useEngineState(engine);

  // ---------------------------------------------------------------- settings → engine
  const chunkSize = useSettings((s) => s.chunkSize);
  const smartPacing = useSettings((s) => s.smartPacing);
  const punctuationPause = useSettings((s) => s.punctuationPause);
  const softStart = useSettings((s) => s.softStart);
  const rewindOnResume = useSettings((s) => s.rewindOnResume);
  const rampEnabled = useSettings((s) => s.rampEnabled);
  const rampStartWpm = useSettings((s) => s.rampStartWpm);
  const rampTargetWpm = useSettings((s) => s.rampTargetWpm);
  const rampStepWpm = useSettings((s) => s.rampStepWpm);
  const rampIntervalSec = useSettings((s) => s.rampIntervalSec);
  useEffect(() => {
    engine.setOptions({ chunkSize, smartPacing, punctuationPause, softStart, rewindOnResume, rampEnabled, rampStartWpm, rampTargetWpm, rampStepWpm, rampIntervalSec });
  }, [engine, chunkSize, smartPacing, punctuationPause, softStart, rewindOnResume, rampEnabled, rampStartWpm, rampTargetWpm, rampStepWpm, rampIntervalSec]);

  const showContextSetting = useSettings((s) => s.showContextOnPause);
  const keepAwake = useSettings((s) => s.keepAwake);
  useWakeLock(state.playing && keepAwake);

  // ---------------------------------------------------------------- persistence & sessions
  const visit = useRef({ words: 0, ms: 0 });
  const [summary, setSummary] = useState<{ words: number; ms: number } | null>(null);

  const save = useCallback(() => {
    void savePosition(book.id, engine.position).catch(() => {});
  }, [book.id, engine]);

  const flush = useCallback(() => {
    const s = engine.takeSession();
    if (!s) return;
    visit.current.words += s.wordsRead;
    visit.current.ms += s.durationMs;
    if (s.durationMs >= MIN_SESSION_MS && s.wordsRead > 0) void addSession({ bookId: book.id, ...s }).catch(() => {});
  }, [book.id, engine]);

  useEffect(() => {
    if (state.playing) {
      const iv = setInterval(save, SAVE_EVERY_MS);
      return () => clearInterval(iv);
    }
    save();
    if (state.finished) {
      flush();
      setSummary({ ...visit.current });
      return;
    }
    // Write the session as soon as it is worth keeping: an IndexedDB write started from `pagehide`
    // may never finish, so waiting for the page to go away loses data. Bursts shorter than
    // MIN_SESSION_MS are kept accumulating (several short plays become one session) until a long pause.
    if (engine.sessionElapsedMs >= MIN_SESSION_MS) {
      flush();
      return;
    }
    const t = setTimeout(flush, SESSION_IDLE_MS);
    return () => clearTimeout(t);
  }, [state.playing, state.finished, save, flush, engine]);

  useEffect(() => {
    const stop = () => {
      engine.pause();
      save();
      flush();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [engine, save, flush]);

  // ---------------------------------------------------------------- sheets
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const openSheet = useCallback(
    (name: SheetName) => {
      engine.pause();
      setSheet(name);
    },
    [engine],
  );
  const closeSheet = useCallback(() => setSheet(null), []);

  // Android back button: close an open sheet, else pause; otherwise let the platform leave to the library.
  useEffect(
    () =>
      registerBackHandler(() => {
        if (sheetRef.current) {
          setSheet(null);
          return true;
        }
        if (engine.getState().playing) {
          engine.pause();
          return true;
        }
        return false;
      }),
    [engine],
  );

  const exit = useCallback(() => navigate(ROUTES.library), [navigate]);

  // ---------------------------------------------------------------- view (word / page)
  // Not persisted: every book opens in the word view. Switching never touches the engine, so the
  // position and play/pause state carry over unchanged (playback simply continues in the other view).
  const [view, setView] = useState<ReaderView>('word');
  const viewRef = useRef(view);
  viewRef.current = view;
  const toggleView = useCallback(() => setView((v) => (v === 'word' ? 'page' : 'word')), []);
  const prevPage = useCallback(() => {
    const p = prevPageStart(pages, engine.position);
    if (p !== null) engine.seek(p);
  }, [engine, pages]);
  const nextPage = useCallback(() => {
    const p = nextPageStart(pages, engine.position, engine.total);
    if (p !== null) engine.seek(p);
  }, [engine, pages]);

  const addBookmarkHere = useCallback(async () => {
    try {
      await createBookmark(book.id, engine);
      toast('Bookmark added', { kind: 'success' });
    } catch {
      toast('Could not add bookmark', { kind: 'error' });
    }
  }, [book.id, engine]);

  // ---------------------------------------------------------------- immersive chrome
  const [chromeHidden, setChromeHidden] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleHide = useCallback(
    (ms: number) => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        // the page view is for looking around: its controls never fade
        if (engine.getState().playing && !sheetRef.current && viewRef.current === 'word') setChromeHidden(true);
      }, ms);
    },
    [engine],
  );
  const poke = useCallback(() => {
    setChromeHidden(false);
    if (engine.getState().playing) scheduleHide(HIDE_CHROME_AFTER_POKE_MS);
  }, [engine, scheduleHide]);
  useEffect(() => {
    if (state.playing && view === 'word') scheduleHide(HIDE_CHROME_AFTER_PLAY_MS);
    else {
      clearTimeout(hideTimer.current);
      setChromeHidden(false);
    }
  }, [state.playing, view, scheduleHide]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetRef.current || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (isTextField(t)) {
        if (e.key === 'Escape') (t as HTMLElement).blur();
        return;
      }
      const onRange = t instanceof HTMLInputElement && t.type === 'range';
      const arrows = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (onRange && arrows) return; // the focused slider handles its own arrows
      const st = engine.getState();
      let handled = true;
      // '?' by key, or Shift + the physical slash key when a layout/IME reports no key value
      const key = e.key === '' && e.code === 'Slash' && e.shiftKey ? '?' : e.key;
      switch (key) {
        case ' ':
        case 'Spacebar':
          engine.toggle();
          break;
        case 'k':
        case 'K':
          engine.toggle();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) engine.prevParagraph();
          else engine.prevSentence();
          break;
        case 'ArrowRight':
          if (e.shiftKey) engine.nextParagraph();
          else engine.nextSentence();
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          const w = Math.round(st.wpm / 10) * 10 + (e.key === 'ArrowUp' ? 10 : -10);
          useSettings.getState().set({ wpm: w });
          engine.setWpm(useSettings.getState().wpm);
          break;
        }
        case 'Escape':
          exit();
          break;
        case 'b':
        case 'B':
          void addBookmarkHere();
          break;
        case 'c':
        case 'C':
          openSheet('chapters');
          break;
        case 's':
        case 'S':
          openSheet('settings');
          break;
        case '?':
          openSheet('help');
          break;
        case 'p':
        case 'P':
          toggleView();
          break;
        case 'PageUp':
          prevPage();
          break;
        case 'PageDown':
          nextPage();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault(); // also stops Space from activating a focused button
        if (key !== ' ') poke();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, exit, addBookmarkHere, openSheet, poke, toggleView, prevPage, nextPage]);

  // ---------------------------------------------------------------- render
  const pageView = view === 'page' && engine.total > 0;
  const showingContext = !pageView && !state.playing && !state.finished && showContextSetting && engine.total > 0;
  const textStage = pageView || showingContext;
  const restart = () => {
    setSummary(null);
    visit.current = { words: 0, ms: 0 };
    engine.seek(0);
    save();
  };

  return (
    <div
      className={['rd-reader', chromeHidden && 'rd-reader--immersive'].filter(Boolean).join(' ')}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') poke();
      }}
      onPointerDown={poke}
    >
      <header className="rd-reader__top rd-reader__chrome">
        <IconButton icon="chevron-left" label="Back to library" onClick={exit} />
        <div className="rd-reader__title" dir="auto">
          <span className="rd-reader__book">{book.title}</span>
          {book.author ? <span className="rd-reader__author">{book.author}</span> : null}
        </div>
        {/* narrow phones: the Bookmarks sheet has "Bookmark this spot", so the title gets the room */}
        <button type="button" className="btn btn--ghost btn--md btn--icon rd-reader__wide-only" aria-label="Add bookmark here" title="Add bookmark (B)" onClick={() => void addBookmarkHere()}>
          <ReaderIcon name="bookmark-plus" />
        </button>
        <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Bookmarks" title="Bookmarks" onClick={() => openSheet('bookmarks')}>
          <ReaderIcon name="bookmarks" />
        </button>
        <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Chapters" title="Chapters (C)" onClick={() => openSheet('chapters')}>
          <ReaderIcon name="list" />
        </button>
        <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Reading settings" title="Reading settings (S)" onClick={() => openSheet('settings')}>
          <Icon name="settings" />
        </button>
        <button type="button" className="btn btn--ghost btn--md btn--icon rd-reader__desktop-only" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => openSheet('help')}>
          <ReaderIcon name="keyboard" />
        </button>
      </header>

      <main
        className={['rd-reader__stage', textStage && 'rd-reader__stage--context'].filter(Boolean).join(' ')}
        aria-label={
          pageView
            ? 'Current page. Tap a word to read from there.'
            : showingContext
              ? 'Text around your position. Tap a word to continue from there.'
              : 'Reading area. Tap to play or pause.'
        }
        onClick={() => {
          if (!textStage && !state.finished) engine.toggle();
        }}
      >
        {state.finished ? (
          <Completion summary={summary} title={book.title} total={engine.total} onLibrary={exit} onRestart={restart} />
        ) : pageView ? (
          <PageView engine={engine} tok={tok} pages={pages} dir={dir} />
        ) : showingContext ? (
          <ContextView engine={engine} tok={tok} dir={dir} onSeek={(i) => engine.seek(i)} />
        ) : (
          <LiveWord engine={engine} dir={dir} />
        )}
        {engine.total === 0 ? <p className="rd-reader__empty muted">This book has no readable text.</p> : null}
      </main>

      <footer className="rd-reader__bottom rd-reader__chrome">
        <Scrubber engine={engine} tok={tok} />
        <ProgressStats engine={engine} tok={tok} pages={pages} />
        <ViewSwitch view={view} onChange={setView} />
        <div className="rd-reader__transport">
          <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Previous paragraph" title="Previous paragraph (Shift+←)" onClick={() => engine.prevParagraph()}>
            <ReaderIcon name="para-back" />
          </button>
          <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Previous sentence" title="Previous sentence (←)" onClick={() => engine.prevSentence()}>
            <ReaderIcon name="sentence-back" size={24} />
          </button>
          <button
            type="button"
            className="btn btn--primary rd-reader__play"
            aria-label={state.playing ? 'Pause' : 'Play'}
            title={state.playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={() => engine.toggle()}
            disabled={engine.total === 0}
          >
            <Icon name={state.playing ? 'pause' : 'play'} size={30} />
          </button>
          <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Next sentence" title="Next sentence (→)" onClick={() => engine.nextSentence()}>
            <ReaderIcon name="sentence-forward" size={24} />
          </button>
          <button type="button" className="btn btn--ghost btn--md btn--icon" aria-label="Next paragraph" title="Next paragraph (Shift+→)" onClick={() => engine.nextParagraph()}>
            <ReaderIcon name="para-forward" />
          </button>
        </div>
        <SpeedControl engine={engine} />
      </footer>

      <ProgressLine engine={engine} />
      <div className="visually-hidden" role="status" aria-live="polite">
        {state.finished ? 'Finished' : state.playing ? 'Playing' : 'Paused'}
      </div>

      <QuickSettings open={sheet === 'settings'} onClose={closeSheet} previewText={engine.getFrame().text} />
      <BookmarksSheet open={sheet === 'bookmarks'} onClose={closeSheet} bookId={book.id} engine={engine} tok={tok} pages={pages} />
      <ChaptersSheet open={sheet === 'chapters'} onClose={closeSheet} engine={engine} tok={tok} pages={pages} />
      <ShortcutsHelp open={sheet === 'help'} onClose={closeSheet} />
    </div>
  );
}

function Completion({
  summary,
  title,
  total,
  onLibrary,
  onRestart,
}: {
  summary: { words: number; ms: number } | null;
  title: string;
  total: number;
  onLibrary: () => void;
  onRestart: () => void;
}) {
  const words = summary?.words ?? 0;
  const ms = summary?.ms ?? 0;
  const avg = ms > 0 ? Math.round(words / (ms / 60000)) : 0;
  return (
    <section className="rd-done" aria-labelledby="done-title" onClick={(e) => e.stopPropagation()}>
      <p className="rd-done__kicker">Finished</p>
      <h2 id="done-title" className="rd-done__title" dir="auto">
        {title}
      </h2>
      <dl className="rd-done__stats">
        <div>
          <dt>Words this session</dt>
          <dd>{words.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Reading time</dt>
          <dd>{formatDuration(ms)}</dd>
        </div>
        <div>
          <dt>Average speed</dt>
          <dd>{avg ? `${avg} wpm` : '–'}</dd>
        </div>
      </dl>
      <p className="rd-done__book muted">{total.toLocaleString()} words in this book</p>
      <div className="rd-done__actions">
        <Button variant="primary" size="lg" onClick={onLibrary} data-autofocus>
          Back to library
        </Button>
        <Button size="lg" onClick={onRestart} icon={undefined}>
          <ReaderIcon name="restart" />
          Read again
        </Button>
      </div>
    </section>
  );
}
