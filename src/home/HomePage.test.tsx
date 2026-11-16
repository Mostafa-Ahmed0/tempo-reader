import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../app/routes';
import { addBook, addSession, db } from '../core/db';
import { useSettings } from '../core/settings';
import LibraryPage from '../library/LibraryPage';
import HomePage, { RECENT_COUNT, homeStats } from './HomePage';

// Monday 16 Nov 2026, 10:00 local time (tests run with TZ=Europe/Berlin)
const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 10, 16 - daysAgo, h, m).getTime();
const min = 60_000;

function Reader() {
  const { bookId } = useParams();
  return <p data-testid="reader">{bookId}</p>;
}
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={[ROUTES.home]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/stats" element={<p>STATS</p>} />
        <Route path="/read/:bookId" element={<Reader />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

const book = (title: string) => addBook({ title, sections: [{ title: 'One', text: 'Some words to read here.' }] }, { name: `${title}.txt`, size: 1, format: 'txt' });

async function seedSessions(bookId: string) {
  // today 6 min, yesterday 10 min, two days ago 5 min (a 3-day streak), and an older one outside the 7 days
  await addSession({ bookId, startedAt: at(0, 9), durationMs: 6 * min, wordsRead: 1800, avgWpm: 300 });
  await addSession({ bookId, startedAt: at(1, 20), durationMs: 10 * min, wordsRead: 2500, avgWpm: 250 });
  await addSession({ bookId, startedAt: at(2, 8), durationMs: 5 * min, wordsRead: 1000, avgWpm: 200 });
  await addSession({ bookId, startedAt: at(10, 8), durationMs: 20 * min, wordsRead: 8000, avgWpm: 400 });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useSettings.getState().reset();
  await db.books.clear();
  await db.contents.clear();
  await db.sessions.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Home', () => {
  it('greets by time of day, with the name from Settings when one is set', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Good morning' })).toBeTruthy();
    cleanup();
    useSettings.getState().set({ userName: 'Anna' });
    vi.setSystemTime(at(0, 19));
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening, Anna' })).toBeTruthy();
  });

  it('a brand-new user sees a welcome with Add books and Try the sample instead of empty boxes', async () => {
    renderHome();
    const welcome = await screen.findByRole('region', { name: 'Welcome to Tempo' });
    expect(within(welcome).getByRole('button', { name: 'Add books' })).toBeTruthy();
    expect(within(welcome).getByRole('button', { name: 'Try the sample' })).toBeTruthy();
    expect(screen.queryByText('Continue reading')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your reading' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recently added' })).toBeNull();
    expect(screen.getByText(/press play/)).toBeTruthy();
  });

  it('Try the sample adds the guide and opens it in the reader', async () => {
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: 'Try the sample' }));
    const reader = await screen.findByTestId('reader');
    const [sample] = await db.books.toArray();
    expect(reader.textContent).toBe(sample.id);
  });

  it('Add books opens the Add window in the library, where the import progress shows', async () => {
    await book('Existing');
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: 'Add books' }));
    expect(await screen.findByRole('dialog', { name: 'Add books' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(ROUTES.library);
  });

  it('returning user: Continue reading links to the last opened book; recently added row, stats strip', async () => {
    const old = await book('Old book');
    const current = await book('Current book');
    await db.books.update(old.id, { addedAt: at(5, 9) });
    await db.books.update(current.id, { addedAt: at(4, 9), lastOpenedAt: at(0, 9), position: 2 });
    for (let i = 0; i < RECENT_COUNT + 1; i++) {
      const b = await book(`New ${i}`);
      await db.books.update(b.id, { addedAt: at(0, 1, i) });
    }
    await seedSessions(current.id);
    renderHome();

    const resume = await screen.findByRole('link', { name: /Resume/ });
    expect(resume.getAttribute('href')).toBe(ROUTES.read(current.id));
    expect(screen.getByRole('heading', { name: 'Current book' })).toBeTruthy();
    fireEvent.click(resume);
    expect((await screen.findByTestId('reader')).textContent).toBe(current.id);
  });

  it('recently added: newest first, at most four, without the book already in Continue reading', async () => {
    const current = await book('Current book');
    await db.books.update(current.id, { addedAt: at(0, 9, 30), lastOpenedAt: at(0, 9) });
    const ids: string[] = [];
    for (let i = 0; i < RECENT_COUNT + 1; i++) {
      const b = await book(`New ${i}`);
      await db.books.update(b.id, { addedAt: at(0, 1, i) });
      ids.push(b.id);
    }
    renderHome();
    const row = await screen.findByRole('region', { name: 'Recently added' });
    const links = within(row).getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/read/'));
    expect(links.map((l) => l.querySelector('.home-recent__title')?.textContent)).toEqual(['New 4', 'New 3', 'New 2', 'New 1']);
    expect(within(row).getByRole('link', { name: 'New 4' })).toBe(links[0]); // the cover is not read out twice
    expect(links[0].getAttribute('href')).toBe(ROUTES.read(ids[4]));
    expect(within(row).getByRole('link', { name: 'Open library' }).getAttribute('href')).toBe(ROUTES.library);
  });

  it('the stats strip shows today against the goal, the streak and the 7-day speed from the sessions', async () => {
    const b = await book('Read');
    await seedSessions(b.id);
    renderHome();
    const strip = await screen.findByRole('region', { name: 'Your reading' });
    expect(within(strip).getByTestId('home-today').textContent).toBe('6 / 15 min');
    expect(within(strip).getByTestId('home-streak').textContent).toBe('3 days');
    // (1800 + 2500 + 1000) words in 21 minutes; the 10-day-old session is outside the week
    expect(within(strip).getByTestId('home-wpm').textContent).toBe('252 wpm');
    expect(within(strip).getByRole('link', { name: 'See all stats' }).getAttribute('href')).toBe(ROUTES.stats);
    expect(screen.getByText('6 min read today, 9 min to go for your goal.')).toBeTruthy();
  });

  it('homeStats: no sessions, and reading only long ago', () => {
    expect(homeStats([], NOW)).toEqual({ todayMinutes: 0, streak: 0, weekWpm: null, hasHistory: false });
    const s = homeStats([{ id: 'x', bookId: 'b', startedAt: at(30, 9), durationMs: 10 * min, wordsRead: 3000, avgWpm: 300 }], NOW);
    expect(s).toEqual({ todayMinutes: 0, streak: 0, weekWpm: null, hasHistory: true });
  });
});
