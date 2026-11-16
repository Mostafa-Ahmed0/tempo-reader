import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addBook, db } from '../core/db';
import { FORMAT_CAVEAT, FORMAT_FAMILIES, familyName, supportedFormatsText } from '../parsers/formats';
import LibraryPage from './LibraryPage';

const renderLibrary = () =>
  render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.books.clear();
  await db.contents.clear();
});
afterEach(cleanup);

describe('library: supported file types', () => {
  it('spells the formats out in the empty library', async () => {
    renderLibrary();
    expect(await screen.findByText(`Reads ${supportedFormatsText()}. ${FORMAT_CAVEAT}`)).toBeTruthy();
  });

  it('a full library shows a small "Supported file types" link next to the book count', async () => {
    await addBook({ title: 'A book', sections: [{ title: 'One', text: 'Some words here.' }] }, { name: 'a.txt', size: 1, format: 'txt' });
    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Supported file types' }));
    const dialog = screen.getByRole('dialog', { name: 'Supported file types' });
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(FORMAT_FAMILIES.length);
    FORMAT_FAMILIES.forEach((f, i) => {
      expect(items[i].textContent?.toLowerCase()).toContain(familyName(f).toLowerCase());
      for (const e of Object.keys(f.extensions)) expect(items[i].textContent).toContain(`.${e}`);
    });
    expect(dialog.textContent).toContain(FORMAT_CAVEAT);
    // not spelled out in the page itself once there are books
    expect(document.querySelector('.welcome__formats')).toBeNull();
  });
});
