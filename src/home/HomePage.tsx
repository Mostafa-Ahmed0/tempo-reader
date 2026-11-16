import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { listSessions, useLiveBooks } from '../core/db';
import { useSettings } from '../core/settings';
import type { Book, ReadingSession } from '../core/types';
import { BookCover } from '../library/BookCover';
import { ContinueCard } from '../library/ContinueCard';
import type { LibraryLocationState } from '../library/LibraryPage';
import { continueReading } from '../library/logic';
import { useOpenSample } from '../library/useOpenSample';
import { XIcon } from '../library/XIcon';
import { addDays, dayKey, parseDayKey, streaks, todayMs, totals } from '../stats/aggregate';
import { Icon } from '../ui';
import { dayLine, greeting } from './greeting';
import './home.css';

/** How many books the "Recently added" row shows. */
export const RECENT_COUNT = 4;

/** Re-render every minute, so the greeting and "today" roll over while Home stays open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export interface HomeStats {
  todayMinutes: number;
  streak: number;
  /** Time-weighted average over the last 7 days (today included); null without reading. */
  weekWpm: number | null;
  hasHistory: boolean;
}

/** The numbers of the stats strip, from the same aggregation the Stats page uses. */
export function homeStats(sessions: readonly ReadingSession[], now: number): HomeStats {
  const since = parseDayKey(addDays(dayKey(now), -6)).getTime();
  return {
    todayMinutes: todayMs(sessions, now) / 60_000,
    streak: streaks(sessions, now).current,
    weekWpm: totals(
      sessions.filter((s) => s.startedAt >= since),
      [],
    ).avgWpm,
    hasHistory: totals(sessions, []).sessions > 0,
  };
}

export default function HomePage() {
  const books = useLiveBooks();
  const sessions = useLiveQuery(() => listSessions(), []);
  const name = useSettings((s) => s.userName);
  const goal = useSettings((s) => s.dailyGoalMinutes);
  const wpm = useSettings((s) => s.wpm);
  const now = useNow();
  const navigate = useNavigate();
  const openSample = useOpenSample();

  const stats = useMemo(() => (sessions ? homeStats(sessions, now) : null), [sessions, now]);
  const resume = useMemo(() => (books ? continueReading(books) : undefined), [books]);
  const recent = useMemo(
    () =>
      (books ?? [])
        .filter((b) => b.id !== resume?.id)
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, RECENT_COUNT),
    [books, resume],
  );

  const openAdd = () => navigate(ROUTES.library, { state: { add: true } satisfies LibraryLocationState });
  const ready = books !== undefined && stats !== null;
  const firstRun = books !== undefined && books.length === 0;

  return (
    <div className="page home">
      <header className="page-header home__header">
        <div className="page-header__text">
          <h1 className="page-header__title home__greeting">{greeting(new Date(now).getHours(), name)}</h1>
          <p className="page-header__subtitle home__line">
            {stats ? dayLine({ todayMinutes: stats.todayMinutes, goal, streak: stats.streak, hasHistory: stats.hasHistory }) : ' '}
          </p>
        </div>
        {ready && !firstRun ? (
          <div className="page-header__actions">
            <button type="button" className="btn btn--secondary btn--md home__add" onClick={openAdd} aria-label="Add books" title="Add books">
              <Icon name="plus" size={18} />
              <span className="home__add-label">Add books</span>
            </button>
          </div>
        ) : null}
      </header>

      {!ready ? null : firstRun ? (
        <FirstRun onAdd={openAdd} onSample={() => void openSample()} />
      ) : (
        <>
          {resume ? <ContinueCard book={resume} wpm={wpm} /> : null}
          <StatsStrip stats={stats} goal={goal} />
          {recent.length ? <RecentRow books={recent} /> : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function FirstRun({ onAdd, onSample }: { onAdd: () => void; onSample: () => void }) {
  return (
    <section className="home-first" aria-labelledby="home-first-title">
      <div className="home-first__demo" aria-hidden="true">
        <span>re</span>
        <span className="home-first__focus">a</span>
        <span>d</span>
      </div>
      <h2 id="home-first-title" className="home-first__title">
        Welcome to Tempo
      </h2>
      <p className="home-first__body">
        Tempo shows your books one word at a time, with a highlighted letter that keeps your eyes still. Add a book or try the
        two-minute sample to feel the difference.
      </p>
      <div className="home-first__actions">
        <button type="button" className="btn btn--primary btn--lg" onClick={onAdd}>
          <Icon name="plus" size={20} />
          Add books
        </button>
        <button type="button" className="btn btn--secondary btn--lg" onClick={onSample}>
          <XIcon name="sparkle" size={20} />
          Try the sample
        </button>
      </div>
      <p className="home-first__hint muted">Everything stays on this device.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function MiniRing({ value, max }: { value: number; max: number }) {
  const size = 48;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  return (
    <svg className="home-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      {frac > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </svg>
  );
}

function StatsStrip({ stats, goal }: { stats: HomeStats; goal: number }) {
  const minutes = Math.floor(stats.todayMinutes);
  const wpm = stats.weekWpm === null ? null : Math.round(stats.weekWpm);
  return (
    <section className="home-section" aria-labelledby="home-stats-title">
      <div className="home-section__head">
        <h2 id="home-stats-title" className="home-section__title">
          Your reading
        </h2>
        <Link to={ROUTES.stats} className="home-section__link">
          See all stats
        </Link>
      </div>
      <ul className="home-stats">
        <li className="home-stat home-stat--today">
          <MiniRing value={stats.todayMinutes} max={goal} />
          <div className="home-stat__text">
            <span className="home-stat__value" data-testid="home-today">
              {minutes}
              <span className="home-stat__unit">{goal > 0 ? ` / ${goal} min` : ' min'}</span>
            </span>
            <span className="home-stat__label">today</span>
          </div>
        </li>
        <li className="home-stat">
          <span className={`home-stat__icon${stats.streak > 0 ? ' is-on' : ''}`} aria-hidden="true">
            <XIcon name="flame" size={22} />
          </span>
          <div className="home-stat__text">
            <span className="home-stat__value" data-testid="home-streak">
              {stats.streak}
              <span className="home-stat__unit">{stats.streak === 1 ? ' day' : ' days'}</span>
            </span>
            <span className="home-stat__label">streak</span>
          </div>
        </li>
        <li className="home-stat">
          <span className="home-stat__icon" aria-hidden="true">
            <XIcon name="gauge" size={22} />
          </span>
          <div className="home-stat__text">
            <span className="home-stat__value" data-testid="home-wpm">
              {wpm ?? '–'}
              {wpm !== null ? <span className="home-stat__unit"> wpm</span> : null}
            </span>
            <span className="home-stat__label">7-day average</span>
          </div>
        </li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function RecentRow({ books }: { books: Book[] }) {
  return (
    <section className="home-section" aria-labelledby="home-recent-title">
      <div className="home-section__head">
        <h2 id="home-recent-title" className="home-section__title">
          Recently added
        </h2>
        <Link to={ROUTES.library} className="home-section__link">
          Open library
        </Link>
      </div>
      <ul className="home-recent">
        {books.map((b) => (
          <li key={b.id}>
            <Link to={ROUTES.read(b.id)} className="home-recent__item">
              <span className="home-recent__cover" aria-hidden="true">
                <BookCover bookId={b.id} title={b.title} author={b.author} cover={b.cover} compact />
              </span>
              <span className="home-recent__title" dir="auto">
                {b.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
