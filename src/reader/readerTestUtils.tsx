// Test helpers for the reader route (imported by tests only).
import { render, screen, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReaderPage from './ReaderPage';

export function readerTree(bookId: string) {
  return (
    <MemoryRouter initialEntries={[`/read/${bookId}`]}>
      <Routes>
        <Route path="/" element={<p>LIBRARY</p>} />
        <Route path="/read/:bookId" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * Render the reader for `bookId`, wait until `ready` finds the loaded reader (default: the Play
 * button), and make sure the Reader's effects have run before the test goes on.
 *
 * Why the last step: ReaderPage loads the book asynchronously (IndexedDB, then a setTimeout), so the
 * Reader's first render is committed outside act(). React then runs its passive effects (the
 * keyboard listener, the engine-state subscription behind Play/Pause, the wake lock, the back-button
 * handler) in a later scheduler task, and findBy* may resolve before that task has run, e.g. when
 * the render took longer than the scheduler's time slice on a busy machine. A key press or a click
 * would then reach a reader that is not listening yet. React always flushes pending effects before
 * it processes a new update, so re-rendering the same tree (inside act(), as rerender does) makes
 * the effects deterministic instead of a race against the scheduler.
 */
export async function renderReaderAt<T = HTMLElement>(
  bookId: string,
  ready: () => Promise<T> = () => screen.findByRole('button', { name: 'Play' }) as Promise<T>,
): Promise<{ view: RenderResult; found: T }> {
  const view = render(readerTree(bookId));
  const found = await ready();
  view.rerender(readerTree(bookId));
  return { view, found };
}
