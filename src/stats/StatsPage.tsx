import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { listSessions, useLiveBooks } from '../core/db';
import { useSettings } from '../core/settings';
import { formatDuration } from '../core/text';
import { PageHeader } from '../ui';
import { XIcon, type XIconName } from '../library/XIcon';
import { autoTrend, daysBetween, MIN_TREND_SPAN_DAYS, minutesPerDay, perBook, streaks, todayMs, totals, trendLine } from './aggregate';
import { formatMinutes, MinutesChart, ProgressRing, WpmChart } from './charts';
import '../library/controls.css';
import './stats.css';

const nf = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Re-render every minute so "today" and the streak roll over at midnight while the page is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function StatsPage() {
  const sessions = useLiveQuery(() => listSessions(), []);
  const books = useLiveBooks();
  const goal = useSettings((s) => s.dailyGoalMinutes);
  const now = useNow();

  const data = useMemo(() => {
    if (!sessions || !books) return null;
    const trend = autoTrend(sessions);
    return {
      today: todayMs(sessions, now) / 60_000,
      streak: streaks(sessions, now),
      totals: totals(sessions, books),
      trend,
      line: trendLine(trend.points),
      bars: minutesPerDay(sessions, now, 30),
      perBook: perBook(sessions, books),
    };
  }, [sessions, books, now]);

  return (
    <div className="page stats">
      <PageHeader title="Stats" subtitle="Reading time, speed and streaks." />
      {data ? <StatsBody data={data} goal={goal} /> : null}
    </div>
  );
}

type Data = {
  today: number;
  streak: ReturnType<typeof streaks>;
  totals: ReturnType<typeof totals>;
  trend: ReturnType<typeof autoTrend>;
  line: ReturnType<typeof trendLine>;
  bars: ReturnType<typeof minutesPerDay>;
  perBook: ReturnType<typeof perBook>;
};

function StatsBody({ data, goal }: { data: Data; goal: number }) {
  const { today, streak, totals: t, trend, line, bars } = data;
  const goalReached = goal > 0 && today >= goal;
  const empty = t.sessions === 0;
  // the dashed trend line (and its written slope) only once the data spans about two weeks
  const showTrend =
    trend.points.length >= 2 && daysBetween(trend.points[0].day, trend.points[trend.points.length - 1].day) >= MIN_TREND_SPAN_DAYS;

  return (
    <>
      {empty ? (
        <div className="stats-intro">
          <p>
            <strong>No reading recorded yet.</strong> Your time, streak and speed show up here after your first session.
          </p>
          <Link to={ROUTES.library} className="btn btn--secondary btn--sm">
            Go to library
          </Link>
        </div>
      ) : null}

      <div className="stats-top">
        <section className="tm-card today" aria-labelledby="today-title">
          <h2 id="today-title" className="tm-card__title">
            Today
          </h2>
          <div className="today__body">
            <ProgressRing value={today} max={goal}>
              <span className="today__big">{Math.floor(today)}</span>
              <span className="today__unit">{goal > 0 ? `of ${goal} min` : 'min'}</span>
            </ProgressRing>
            <p className="today__text" aria-live="polite">
              {goal <= 0
                ? `${formatMinutes(today)} read today. No daily goal set.`
                : goalReached
                  ? `Goal reached. ${formatMinutes(today)} read today.`
                  : today > 0
                    ? `${formatMinutes(goal - today)} to go for your ${goal}-minute goal.`
                    : `Read ${goal} minutes to hit today's goal.`}
            </p>
          </div>
        </section>

        <section className="tm-card streak" aria-labelledby="streak-title">
          <h2 id="streak-title" className="tm-card__title">
            Streak
          </h2>
          <div className="streak__body">
            <span className={`streak__flame${streak.current > 0 ? ' is-on' : ''}`} aria-hidden="true">
              <XIcon name="flame" size={30} />
            </span>
            <p className="streak__now">
              <span className="streak__num">{streak.current}</span> {streak.current === 1 ? 'day' : 'days'}
            </p>
          </div>
          <p className="streak__sub">
            {streak.current > 0 && !streak.readToday ? 'Read today to keep it going. ' : ''}
            Best: {streak.best} {streak.best === 1 ? 'day' : 'days'}
          </p>
        </section>
      </div>

      <section aria-label="Totals" className="tm-tiles">
        <Tile icon="words" label="Words read" value={t.words >= 100_000 ? compact.format(t.words) : nf.format(t.words)} title={nf.format(t.words)} />
        <Tile icon="clock" label="Time reading" value={t.ms ? formatDuration(t.ms) : '0 min'} />
        <Tile icon="book" label="Books finished" value={nf.format(t.booksFinished)} />
        <Tile icon="gauge" label="Average speed" value={t.avgWpm ? `${Math.round(t.avgWpm)}` : '–'} unit={t.avgWpm ? 'wpm' : undefined} />
      </section>

      <section className="tm-card" aria-labelledby="speed-title">
        <div className="tm-card__head">
          <h2 id="speed-title" className="tm-card__title">
            Am I getting faster?
          </h2>
          {trend.points.length >= 2 ? <span className="tm-card__hint">avg wpm per {trend.bucket}</span> : null}
        </div>
        {trend.points.length >= 2 ? (
          <>
            <SpeedSummary points={trend.points} line={line} bucket={trend.bucket} />
            <WpmChart points={trend.points} bucket={trend.bucket} trend={showTrend ? line : null} title="Average reading speed over time" />
            <p className="tm-chart-note">
              Speed = words shown ÷ time spent playing, averaged per {trend.bucket} and weighted by reading time.{showTrend ? ' The dashed line is the overall trend.' : ''} Sessions under 15 seconds are left out. It follows the speed you choose, so it shows how fast you read, not how much you
              understood.
            </p>
            <DataTable
              caption="Average speed per period"
              headers={[trend.bucket === 'week' ? 'Week of' : 'Day', 'Avg wpm', 'Time']}
              rows={[...trend.points].reverse().map((p) => [fmtDate(p.day), String(Math.round(p.wpm)), formatMinutes(p.minutes)])}
            />
          </>
        ) : (
          <div className="tm-chart-empty">
            <XIcon name="gauge" size={28} />
            <p>
              <strong>Not enough data yet.</strong> This chart compares your average speed across days, so it needs reading on at least two
              different days{trend.points.length === 1 ? ` (so far: 1 day at ${Math.round(trend.points[0].wpm)} wpm)` : ''}. Come back after
              tomorrow's session.
            </p>
          </div>
        )}
      </section>

      <section className="tm-card" aria-labelledby="days-title">
        <div className="tm-card__head">
          <h2 id="days-title" className="tm-card__title">
            Last 30 days
          </h2>
          <span className="tm-card__hint">{formatMinutes(bars.reduce((a, b) => a + b.minutes, 0))} total</span>
        </div>
        <MinutesChart bars={bars} goalMinutes={goal} title="Minutes read per day, last 30 days" />
        <DataTable
          caption="Minutes per day"
          headers={['Day', 'Minutes']}
          rows={[...bars]
            .reverse()
            .filter((b) => b.minutes > 0)
            .map((b) => [fmtDate(b.day), formatMinutes(b.minutes)])}
          emptyText="No reading in the last 30 days."
        />
      </section>

      <section className="tm-card" aria-labelledby="books-title">
        <h2 id="books-title" className="tm-card__title">
          By book
        </h2>
        {data.perBook.length ? (
          <table className="per-book">
            <thead>
              <tr>
                <th scope="col">Book</th>
                <th scope="col">Time</th>
                <th scope="col">Words</th>
                <th scope="col">Avg wpm</th>
              </tr>
            </thead>
            <tbody>
              {data.perBook.map((r) => (
                <tr key={r.bookId}>
                  <th scope="row" className="per-book__title">
                    {r.exists ? (
                      <Link to={ROUTES.read(r.bookId)}>{r.title}</Link>
                    ) : (
                      <span className="muted">{r.title}</span>
                    )}
                    {r.author ? <span className="per-book__author">{r.author}</span> : null}
                  </th>
                  <td data-label="Time">{formatDuration(r.ms)}</td>
                  <td data-label="Words">{nf.format(r.words)}</td>
                  <td data-label="Avg wpm">{r.avgWpm ? Math.round(r.avgWpm) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted tm-small">Books you read appear here with their time, words and speed.</p>
        )}
      </section>
    </>
  );
}

function fmtDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function Tile({ icon, label, value, unit, title }: { icon: XIconName; label: string; value: string; unit?: string; title?: string }) {
  return (
    <div className="tm-tile" title={title}>
      <span className="tm-tile__icon" aria-hidden="true">
        <XIcon name={icon} size={18} />
      </span>
      <span className="tm-tile__label">{label}</span>
      <span className="tm-tile__value">
        {value}
        {unit ? <span className="tm-tile__unit"> {unit}</span> : null}
      </span>
    </div>
  );
}

function SpeedSummary({
  points,
  line,
  bucket,
}: {
  points: Data['trend']['points'];
  line: Data['line'];
  bucket: 'day' | 'week';
}) {
  const first = points[0];
  const last = points[points.length - 1];
  let verdict: ReactNode = null;
  const spanDays = daysBetween(first.day, last.day);
  if (line && spanDays < MIN_TREND_SPAN_DAYS) {
    // a slope over a few days, extrapolated to "per week", would overclaim
    verdict = <>Too early to call a trend (needs about two weeks of reading).</>;
  } else if (line) {
    const w = Math.round(line.perWeek);
    // small slopes are noise: say so instead of claiming progress
    verdict =
      Math.abs(w) < 3 ? (
        <>Your speed is roughly steady.</>
      ) : w > 0 ? (
        <>
          Trending <strong className="up">up about {w} wpm per week</strong>.
        </>
      ) : (
        <>
          Trending <strong className="down">down about {-w} wpm per week</strong>.
        </>
      );
  }
  return (
    <p className="speed-summary">
      {verdict} From <strong>{Math.round(first.wpm)} wpm</strong> ({bucket === 'week' ? 'week of ' : ''}
      {fmtShort(first.day)}) to <strong>{Math.round(last.wpm)} wpm</strong> ({fmtShort(last.day)}) across {points.length} reading{' '}
      {bucket === 'week' ? 'weeks' : 'days'}.
    </p>
  );
}

function fmtShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function DataTable({ caption, headers, rows, emptyText }: { caption: string; headers: string[]; rows: string[][]; emptyText?: string }) {
  return (
    <details className="tm-data-table">
      <summary>
        <XIcon name="chevron-down" size={16} className="tm-data-table__chev" />
        Show as table<span className="visually-hidden">: {caption}</span>
      </summary>
      {rows.length ? (
        <div className="tm-data-table__scroll">
          <table>
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted tm-small">{emptyText ?? 'No data.'}</p>
      )}
    </details>
  );
}
