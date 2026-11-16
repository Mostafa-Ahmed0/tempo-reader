import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBook, db } from '../core/db';
import { useSettings } from '../core/settings';
import { handleBack } from '../platform/backButton';
import { renderReaderAt } from './readerTestUtils';

const wake = vi.hoisted(() => ({ acquired: 0, released: 0 }));
vi.mock('../platform/wakeLock', () => ({
  keepScreenOn: () => {
    wake.acquired++;
    return () => {
      wake.released++;
    };
  },
}));

const TEXT = 'First sentence here. Second sentence follows now. Third one.\n\nNew paragraph starts. And ends.';

async function openReader() {
  const book = await addBook({ title: 'Test book', sections: [{ title: 'One', text: TEXT }] }, { name: 't.txt', size: 1, format: 'txt' });
  await renderReaderAt(book.id);
}

const back = () => {
  const ctx = { pathname: '/read/x', navigateToLibrary: vi.fn(), navigateHome: vi.fn(), exitApp: vi.fn() };
  let action = '';
  act(() => {
    action = handleBack(ctx);
  });
  return { action, ctx };
};

beforeEach(async () => {
  wake.acquired = 0;
  wake.released = 0;
  useSettings.getState().reset();
  useSettings.getState().set({ wpm: 60, softStart: false, rewindOnResume: 0 }); // slow: stays playing during the test
  await db.books.clear();
  await db.contents.clear();
});
afterEach(cleanup);

describe('reader ↔ platform', () => {
  it('keeps the screen on only while playing, and only when keepAwake is on', async () => {
    await openReader();
    expect(wake.acquired).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(wake.acquired).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(wake.released).toBe(1);

    act(() => useSettings.getState().set({ keepAwake: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(wake.acquired).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  });

  it('Android back: closes an open sheet, then pauses, then lets the platform leave', async () => {
    await openReader();

    fireEvent.click(screen.getByRole('button', { name: 'Chapters' }));
    expect(screen.getByRole('dialog', { name: 'Chapters' })).toBeTruthy();
    expect(back().action).toBe('handler');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(back().action).toBe('handler');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy(); // paused, still in the reader

    // nothing left for the reader to consume: the platform's reader-exit path takes over
    expect(back().action).toBe('reader-exit');
    expect(screen.getByText('LIBRARY')).toBeTruthy();
  });

  it('unregisters on unmount', async () => {
    await openReader();
    cleanup();
    expect(back().action).not.toBe('handler');
  });
});
