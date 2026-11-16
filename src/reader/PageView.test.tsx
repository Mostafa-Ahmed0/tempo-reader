import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addBook, db, getBook } from '../core/db';
import { useSettings } from '../core/settings';
import { renderReaderAt } from './readerTestUtils';

// 17 words on 4 "PDF" pages: page 1 = words 0–5, page 2 = 6–13, page 3 blank, page 4 = 14–16
const TEXT = 'First sentence here. Second sentence follows now. Third one.\n\nNew paragraph starts. And ends.';

async function seedPaged(position = 0) {
  const book = await addBook(
    { title: 'Paged', sections: [{ title: 'One', text: TEXT }, { title: 'Two', text: 'Chapter two words.' }], pageStarts: [0, 6, 14, 14] },
    { name: 'p.pdf', size: 1, format: 'pdf' },
  );
  if (position) await db.books.update(book.id, { position });
  return book;
}

const pageText = () => document.querySelector('.rd-page__text');
const pageWords = () => Array.from(document.querySelectorAll('.rd-page__text [data-i]')).map((el) => el.textContent);
const current = () => Array.from(document.querySelectorAll('.rd-page__text .is-current')).map((el) => el.textContent);
const pageRadio = () => screen.getByRole('radio', { name: 'Page' });
const wordRadio = () => screen.getByRole('radio', { name: 'Word' });

beforeEach(async () => {
  useSettings.getState().reset();
  useSettings.getState().set({ showContextOnPause: false, softStart: false, rewindOnResume: 0, smartPacing: false });
  await db.books.clear();
  await db.contents.clear();
  await db.bookmarks.clear();
  await db.sessions.clear();
});
afterEach(cleanup);

describe('page view', () => {
  it('opens in the word view; P / the toggle switch views and keep the position', async () => {
    const book = await seedPaged(7); // "Third", page 2
    await renderReaderAt(book.id);
    expect(pageRadio().getAttribute('aria-checked')).toBe('false');
    expect(pageText()).toBeNull();
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe('Third');

    fireEvent.keyDown(window, { key: 'p' });
    expect(pageRadio().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Page 2 of 4', { selector: '.rd-page__num' })).toBeTruthy();
    // the whole of page 2, paragraphs kept, and nothing of other pages
    expect(pageWords()).toEqual(['now.', 'Third', 'one.', 'New', 'paragraph', 'starts.', 'And', 'ends.']);
    expect(document.querySelectorAll('.rd-page__text .rd-ctx__p')).toHaveLength(2);
    expect(current()).toEqual(['Third']);

    fireEvent.click(wordRadio());
    expect(pageText()).toBeNull();
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe('Third');
    await waitFor(async () => expect((await getBook(book.id))?.position).toBe(7));
  });

  it('every opening starts in the word view again', async () => {
    const book = await seedPaged();
    const { view } = await renderReaderAt(book.id);
    fireEvent.keyDown(window, { key: 'P' });
    expect(pageText()).not.toBeNull();
    view.unmount();
    await renderReaderAt(book.id);
    expect(pageText()).toBeNull();
    expect(pageRadio().getAttribute('aria-checked')).toBe('false');
  });

  it('the highlight follows the position, with the focus letter and the whole group', async () => {
    const book = await seedPaged(6);
    await renderReaderAt(book.id);
    fireEvent.click(pageRadio());
    expect(current()).toEqual(['now.']);
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // next sentence: "Third"
    expect(current()).toEqual(['Third']);
    // ORP letter of "Third" (5 letters → 2nd) in the focus colour
    expect(document.querySelector('.rd-page__text .is-current .rd-page__focus')?.textContent).toBe('h');
    // the previous word is plain text again
    expect(document.querySelector('[data-i="6"]')?.innerHTML).toBe('now.');

    act(() => useSettings.getState().set({ chunkSize: 2 }));
    expect(current()).toEqual(['Third', 'one.']);
    act(() => useSettings.getState().set({ highlightMode: 'none' }));
    expect(document.querySelector('.rd-page__focus')).toBeNull();
  });

  it('tapping a word jumps there, in the page view and after switching back', async () => {
    const book = await seedPaged(6);
    await renderReaderAt(book.id);
    fireEvent.click(pageRadio());
    fireEvent.click(screen.getByText('paragraph'));
    expect(current()).toEqual(['paragraph']);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy(); // a tap does not start playback
    fireEvent.click(wordRadio());
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe('paragraph');
  });

  it('previous / next page buttons and PageUp / PageDown turn pages (skipping the blank page)', async () => {
    const book = await seedPaged();
    await renderReaderAt(book.id);
    fireEvent.click(pageRadio());
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(current()).toEqual(['now.']);
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(screen.getByText('Page 4 of 4', { selector: '.rd-page__num' })).toBeTruthy();
    expect(pageWords()).toEqual(['Chapter', 'two', 'words.']);
    expect(screen.getByRole('heading', { name: 'Two' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(window, { key: 'PageUp' });
    expect(current()).toEqual(['now.']);
    // also in the word view
    fireEvent.click(wordRadio());
    fireEvent.keyDown(window, { key: 'PageUp' });
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe('First');
  });

  it('plays in the page view and turns the page when the highlight crosses it', async () => {
    useSettings.getState().set({ wpm: 1500 });
    const book = await seedPaged(3);
    await renderReaderAt(book.id);
    fireEvent.click(pageRadio());
    expect(screen.getByText('Page 1 of 4', { selector: '.rd-page__num' })).toBeTruthy();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(pageText()).not.toBeNull(); // still the page view while playing
    await waitFor(() => expect(screen.getByText('Page 2 of 4', { selector: '.rd-page__num' })).toBeTruthy(), { timeout: 3000 });
    expect(pageWords()[0]).toBe('now.');
    fireEvent.keyDown(window, { key: ' ' });
    const at = current();
    expect(at).toHaveLength(1);
    expect(pageWords()).toContain(at[0]);
    // the chrome stays visible in the page view
    expect(document.querySelector('.rd-reader--immersive')).toBeNull();
  });

  it('switching views while playing keeps playing at the same position', async () => {
    useSettings.getState().set({ wpm: 60 });
    const book = await seedPaged(2);
    await renderReaderAt(book.id);
    fireEvent.keyDown(window, { key: ' ' });
    const word = document.querySelector('.rd-rsvp__word')?.textContent;
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(current()).toEqual([word]);
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe(word);
    fireEvent.keyDown(window, { key: ' ' });
  });

  it('the Word | Page switch is a labelled radiogroup with arrow keys and a roving tab stop', async () => {
    const book = await seedPaged(7);
    await renderReaderAt(book.id);
    const group = screen.getByRole('radiogroup', { name: 'Reading view' });
    expect(group.classList.contains('is-page')).toBe(false);
    expect(wordRadio().getAttribute('aria-checked')).toBe('true');
    expect(wordRadio().tabIndex).toBe(0);
    expect(pageRadio().tabIndex).toBe(-1);

    wordRadio().focus();
    fireEvent.keyDown(wordRadio(), { key: 'ArrowRight' });
    expect(pageRadio().getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(pageRadio());
    expect(group.classList.contains('is-page')).toBe(true); // the thumb sits on the Page side
    expect(pageText()).not.toBeNull();
    // the arrow went to the switch, not to the reader's "next sentence"
    expect(current()).toEqual(['Third']);

    fireEvent.keyDown(pageRadio(), { key: 'ArrowLeft' });
    expect(wordRadio().getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.rd-rsvp__word')?.textContent).toBe('Third');
    // and P still toggles from anywhere
    fireEvent.keyDown(window, { key: 'p' });
    expect(pageRadio().getAttribute('aria-checked')).toBe('true');
  });

  it('is listed in the keyboard shortcuts', async () => {
    const book = await seedPaged();
    await renderReaderAt(book.id);
    fireEvent.keyDown(window, { key: '?' });
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(help.textContent).toContain('Word view / page view');
    expect(help.textContent).toContain('Previous / next page');
  });
});
