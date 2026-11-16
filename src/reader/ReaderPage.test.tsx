import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addBook, db, getBook, listBookmarks, listSessions } from '../core/db';
import { useSettings } from '../core/settings';
import ReaderPage from './ReaderPage';

const TEXT = 'First sentence here. Second sentence follows now. Third one.\n\nNew paragraph starts. And ends.';

async function seed(position = 0) {
  const book = await addBook({ title: 'Test book', sections: [{ title: 'One', text: TEXT }] }, { name: 't.txt', size: 1, format: 'txt' });
  if (position) await db.books.update(book.id, { position });
  return book;
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/read/${id}`]}>
      <Routes>
        <Route path="/" element={<p>LIBRARY</p>} />
        <Route path="/read/:bookId" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  useSettings.getState().reset();
  useSettings.getState().set({ showContextOnPause: true, softStart: false, rewindOnResume: 0 });
  await db.books.clear();
  await db.contents.clear();
  await db.bookmarks.clear();
  await db.sessions.clear();
});
afterEach(cleanup);

describe('ReaderPage', () => {
  it('shows a way back when the book does not exist', async () => {
    renderAt('nope');
    expect(await screen.findByText(/isn't in your library any more/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /back to library/i }));
    expect(screen.getByText('LIBRARY')).toBeTruthy();
  });

  it('opens at the saved position with the context view, and tapping a word seeks there', async () => {
    const book = await seed(3); // "Second"
    renderAt(book.id);
    const current = await waitFor(() => {
      const el = document.querySelector('.rd-ctx__w.is-current');
      if (!el) throw new Error('no context yet');
      return el;
    });
    expect(current.textContent).toBe('Second');
    fireEvent.click(screen.getByText('paragraph'));
    expect(document.querySelector('.rd-ctx__w.is-current')?.textContent).toBe('paragraph');
  });

  it('keyboard: space plays/pauses, arrows navigate, up/down change speed, Esc exits; position is saved', async () => {
    const book = await seed();
    renderAt(book.id);
    await screen.findByRole('button', { name: 'Play' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelector('.rd-ctx__w.is-current')?.textContent).toBe('Second');
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(document.querySelector('.rd-ctx__w.is-current')?.textContent).toBe('New');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(useSettings.getState().wpm).toBe(310);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(useSettings.getState().wpm).toBe(290);

    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe('New');
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    await waitFor(async () => expect((await getBook(book.id))?.position).toBe(book.wordCount - 5));

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' }); // closes the help, does not leave the reader
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('LIBRARY')).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('LIBRARY')).toBeTruthy();
  });

  it('rd-speed controls: number field, slider and −/+ stay in sync with settings', async () => {
    const book = await seed();
    renderAt(book.id);
    const num = (await screen.findByRole('spinbutton', { name: /type a value/i })) as HTMLInputElement;
    const range = screen.getByRole('slider', { name: 'Words per minute' }) as HTMLInputElement;
    fireEvent.focus(num);
    fireEvent.change(num, { target: { value: '45' } }); // below min: not committed while typing
    expect(useSettings.getState().wpm).toBe(300);
    fireEvent.change(num, { target: { value: '450' } });
    expect(useSettings.getState().wpm).toBe(450);
    expect(range.value).toBe('450');
    fireEvent.change(num, { target: { value: '99999' } });
    fireEvent.blur(num);
    expect(useSettings.getState().wpm).toBe(1500);
    expect(num.value).toBe('1500');
    fireEvent.change(range, { target: { value: '600' } });
    expect(num.value).toBe('600');
    const minus = screen.getByRole('button', { name: /slower/i });
    fireEvent.pointerDown(minus, { button: 0 });
    fireEvent.pointerUp(minus);
    expect(useSettings.getState().wpm).toBe(590);
    expect(num.value).toBe('590');
  });

  it('bookmarks: add with excerpt from the current position', async () => {
    const book = await seed(3);
    renderAt(book.id);
    await screen.findByRole('button', { name: 'Play' });
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark here' }));
    await waitFor(async () => expect((await listBookmarks(book.id)).length).toBe(1));
    const [bm] = await listBookmarks(book.id);
    expect(bm.position).toBe(3);
    expect(bm.excerpt).toContain('Second sentence follows');
  });

  it('plays to the end, shows the completion view; very short readings are not stored as sessions', async () => {
    useSettings.getState().set({ wpm: 1500, smartPacing: false });
    const book = await seed();
    renderAt(book.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(await screen.findByText('Finished', { selector: '.rd-done__kicker' }, { timeout: 3000 })).toBeTruthy();
    await waitFor(async () => expect((await getBook(book.id))?.finishedAt).not.toBeNull());
    expect(await listSessions()).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /read again/i }));
    });
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });
});
