import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useParams } from 'react-router-dom';
import App from './App';
import { useSettings } from '../core/settings';
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
});
afterEach(cleanup);

describe('App shell', () => {
  it('renders the library with the main nav', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.textContent).toContain('Stats');
    expect(nav.textContent).toContain('Settings');
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

  it('redirects unknown routes to the library', () => {
    window.location.hash = '#/no/such/page';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
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
