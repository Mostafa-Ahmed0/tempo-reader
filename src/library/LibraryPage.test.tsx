import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBook, db } from '../core/db';
import { FORMAT_CAVEAT, FORMAT_FAMILIES, familyName, supportedFormatsText } from '../parsers/formats';
import { __resetImportsForTests, useImports } from './importer';
import LibraryPage from './LibraryPage';

const renderLibrary = () =>
  render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  );

beforeEach(async () => {
  __resetImportsForTests();
  await db.books.clear();
  await db.contents.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fileOf = (name: string, text = 'Some words to read.') => new File([text], name, { type: 'text/plain' });
const dt = (files: File[]) => ({ dataTransfer: { files, types: ['Files'] } });
const drop = (el: Element | Window, files: File[]) => {
  fireEvent.dragEnter(el, dt(files));
  fireEvent.dragOver(el, dt(files));
  fireEvent.drop(el, dt(files));
};

async function withBook() {
  const book = await addBook({ title: 'A book', sections: [{ title: 'One', text: 'Some words here.' }] }, { name: 'a.txt', size: 1, format: 'txt' });
  await db.books.update(book.id, { lastOpenedAt: Date.now(), position: 1 });
  return book;
}

async function openAdd() {
  renderLibrary();
  fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
  return screen.getByRole('dialog', { name: 'Add books' });
}

describe('library: supported file types', () => {
  it('spells the formats out in the empty library', async () => {
    renderLibrary();
    expect(await screen.findByText(`Reads ${supportedFormatsText()}. ${FORMAT_CAVEAT}`)).toBeTruthy();
  });

  it("the empty library's main button opens the Add window", async () => {
    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add files' }));
    expect(screen.getByRole('dialog', { name: 'Add books' })).toBeTruthy();
  });
});

describe('library: Add window', () => {
  it('opens from Add with a drop zone, Choose files and the supported types from the single source', async () => {
    await withBook();
    const dialog = await openAdd();
    expect(within(dialog).getByText('Drop files here')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Choose files' })).toBeTruthy();
    const list = within(dialog).getByRole('region', { name: 'Supported file types' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(FORMAT_FAMILIES.length);
    FORMAT_FAMILIES.forEach((f, i) => {
      expect(items[i].textContent?.toLowerCase()).toContain(familyName(f).toLowerCase());
      for (const e of Object.keys(f.extensions)) expect(items[i].textContent).toContain(`.${e}`);
    });
    expect(dialog.textContent).toContain(FORMAT_CAVEAT);
    // the old separate "File types" link is gone: one list only
    expect(screen.queryByRole('button', { name: 'Supported file types' })).toBeNull();
    expect(document.querySelector('.welcome__formats')).toBeNull();
  });

  it('dropping files on the zone enqueues them once, closes the window and shows the import list', async () => {
    await withBook();
    const dialog = await openAdd();
    const zone = within(dialog).getByTestId('add-drop');
    fireEvent.dragEnter(zone, dt([]));
    expect(zone.classList.contains('is-over')).toBe(true);
    expect(within(zone).getByText('Release to add')).toBeTruthy();
    // the page-wide overlay stays away while the window gives its own feedback
    expect(document.querySelector('.drop-overlay')).toBeNull();
    fireEvent.dragOver(zone, dt([]));
    fireEvent.drop(zone, dt([fileOf('one.txt'), fileOf('two.txt')]));
    expect(useImports.getState().items.map((i) => i.name)).toEqual(['one.txt', 'two.txt']);
    expect(screen.queryByRole('dialog', { name: 'Add books' })).toBeNull();
    expect(await screen.findByRole('heading', { name: /Importing|added/ })).toBeTruthy();
  });

  it('Choose files opens the system picker; picked files are enqueued and the window closes', async () => {
    await withBook();
    const dialog = await openAdd();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose files' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    fireEvent.change(input, { target: { files: [fileOf('picked.md')] } });
    expect(useImports.getState().items.map((i) => i.name)).toEqual(['picked.md']);
    expect(screen.queryByRole('dialog', { name: 'Add books' })).toBeNull();
  });

  it('an unsupported file still gets the existing error with the supported list', async () => {
    await withBook();
    const dialog = await openAdd();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 1, 2, 3, 0, 0, 0, 0])], 'photo.png', { type: 'image/png' });
    drop(within(dialog).getByTestId('add-drop'), [png]);
    const error = await screen.findByText(/Supported:/, {}, { timeout: 4000 });
    expect(error.className).toContain('imports__error');
    expect(await screen.findByRole('heading', { name: '0 added, 1 failed' })).toBeTruthy();
  });

  it('leads to the Paste text window', async () => {
    await withBook();
    const dialog = await openAdd();
    fireEvent.click(within(dialog).getByRole('button', { name: /Paste text instead/ }));
    expect(screen.queryByRole('dialog', { name: 'Add books' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Paste text' })).toBeTruthy();
  });

  it('page-wide drag and drop still works while the window is closed', async () => {
    await withBook();
    renderLibrary();
    await screen.findByRole('button', { name: 'Add' });
    fireEvent.dragEnter(window, dt([]));
    expect(document.querySelector('.drop-overlay')).toBeTruthy();
    fireEvent.drop(window, dt([fileOf('page.txt')]));
    expect(document.querySelector('.drop-overlay')).toBeNull();
    expect(useImports.getState().items.map((i) => i.name)).toEqual(['page.txt']);
  });

  it('opens straight away when Home sends the user here to add books', async () => {
    await withBook();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/library', state: { add: true } }]}>
        <LibraryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('dialog', { name: 'Add books' })).toBeTruthy();
  });

  it('the library no longer repeats the Continue reading card (it lives on Home)', async () => {
    await withBook();
    renderLibrary();
    await screen.findAllByText('A book');
    expect(screen.queryByText('Continue reading')).toBeNull();
  });
});
