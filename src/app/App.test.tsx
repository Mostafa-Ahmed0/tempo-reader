import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useParams } from 'react-router-dom';
import App from './App';
import { useSettings } from '../core/settings';
import { __resetImportsForTests, useImports } from '../library/importer';
import { pushIncomingFiles } from '../platform/incomingFiles';
import { Modal, toast, Toggle } from '../ui';
import { useState } from 'react';

// The reader has its own tests (src/reader); here we only check that the route reaches it.
vi.mock('../reader/ReaderPage', () => ({
  default: function MockReaderPage() {
    const { bookId } = useParams();
    return <div data-testid="reader-page" data-book-id={bookId} />;
  },
}));

beforeEach(() => {
  window.location.hash = '#/';
  useSettings.getState().reset();
  __resetImportsForTests();
});
afterEach(cleanup);

describe('App shell', () => {
  it('opens on Home, with Home, Library, Stats and Settings in the main nav', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Home', 'Library', 'Stats', 'Settings']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['#/', '#/library', '#/stats', '#/settings']);
    expect(links[0].className).toContain('is-active');
  });

  it('the library has its own route', () => {
    window.location.hash = '#/library';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Library' }).className).toContain('is-active');
    expect(within(nav).getByRole('link', { name: 'Home' }).className).not.toContain('is-active');
  });

  it('navigates between tab pages (lazy-loaded)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Stats' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Stats' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });

  it('renders the lazy reader route full-screen without nav, with the book id from the URL', async () => {
    // The reader page itself is mocked (see vi.mock above): this tests routing, not the reader's screens.
    window.location.hash = '#/read/abc%20123';
    render(<App />);
    const page = await screen.findByTestId('reader-page');
    expect(page.dataset.bookId).toBe('abc 123');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('redirects unknown routes to Home', () => {
    window.location.hash = '#/no/such/page';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /^Good / })).toBeTruthy();
    expect(window.location.hash).toBe('#/');
  });

  it('files opened or shared from outside land in the library, where the import shows', async () => {
    render(<App />);
    expect(screen.queryByRole('heading', { level: 1, name: 'Library' })).toBeNull();
    act(() => pushIncomingFiles([new File(['x'], 'nope.xyz')]));
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    expect(window.location.hash).toBe('#/library');
    expect(useImports.getState().items.map((i) => i.name)).toEqual(['nope.xyz']);
  });

  it('applies data-theme and --focus from settings', () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => useSettings.getState().set({ theme: 'sepia', highlightColor: '#00aaff' }));
    expect(document.documentElement.dataset.theme).toBe('sepia');
    expect(document.documentElement.style.getPropertyValue('--focus')).toBe('#00aaff');
  });

  it('shows toasts', () => {
    render(<App />);
    act(() => {
      toast('Saved!');
    });
    expect(screen.getByText('Saved!')).toBeTruthy();
  });
});

describe('ui primitives', () => {
  it('Modal closes on Escape and restores focus', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Hello">
            <button>inside</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Hello' })).toBeTruthy();
    expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Toggle is a switch', () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Toggle label="Keep awake" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Keep awake' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});
