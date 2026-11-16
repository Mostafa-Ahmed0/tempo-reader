import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { addBook, listBooks, updateBook, useLiveBooks } from '../core/db';
import { useSettings } from '../core/settings';
import type { Book } from '../core/types';
import { Icon, IconButton, PageHeader, toast } from '../ui';
import { BookCover } from './BookCover';
import { BookItem, pagesLabel, progressLabel, timeLeftLabel } from './BookItem';
import { BookMenu } from './BookMenu';
import { DropOverlay, ImportPanel, PasteModal } from './ImportParts';
import { loadParsers, useImports } from './importer';
import {
  BUILTIN_FILTERS,
  SORT_OPTIONS,
  allTags as collectTags,
  bookProgress,
  continueReading,
  matchesFilter,
  selectBooks,
  type FilterKey,
  type SortKey,
} from './logic';
import { useLibraryPrefs } from './prefs';
import { SAMPLE_FILE_NAME, findSample, sampleBook } from './sample';
import { XIcon } from './XIcon';
import './controls.css';
import './library.css';

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

export default function LibraryPage() {
  const books = useLiveBooks();
  const wpm = useSettings((s) => s.wpm);
  const navigate = useNavigate();
  const enqueue = useImports((s) => s.enqueue);
  const fileInput = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState<string | undefined>(undefined);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const offerReadNow = useCallback(
    (book: Book) => {
      toast(`Added "${book.title}"`, {
        kind: 'success',
        duration: 7000,
        action: { label: 'Read now', onClick: () => navigate(ROUTES.read(book.id)) },
      });
    },
    [navigate],
  );

  const importFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      enqueue(files, (added) => {
        if (files.length === 1 && added.length === 1) offerReadNow(added[0]);
        else if (added.length > 1) toast(`Added ${added.length} books`, { kind: 'success' });
      });
    },
    [enqueue, offerReadNow],
  );

  // Prefetch the parsers chunk on intent (hover / focus / touch), so the picker's accept filter is ready.
  const prefetch = useCallback(() => {
    loadParsers().then(
      (p) => setAccept(p.ACCEPT_ATTR),
      () => {},
    );
  }, []);

  const openPicker = useCallback(async () => {
    const input = fileInput.current;
    if (!input) return;
    if (accept === undefined) {
      try {
        const p = await loadParsers();
        input.accept = p.ACCEPT_ATTR;
        setAccept(p.ACCEPT_ATTR);
      } catch {
        /* open without a filter; unsupported files get a clear per-file error */
      }
    }
    input.click();
  }, [accept]);

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = ''; // allow picking the same file again
    importFiles(files);
  };

  // Drag & drop anywhere on the page (desktop).
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (depth === 1) {
        setDragging(true);
        prefetch();
      }
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      importFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles, prefetch]);

  const sampleBusy = useRef(false);
  const trySample = async () => {
    if (sampleBusy.current) return; // double taps must not add it twice
    sampleBusy.current = true;
    try {
      // already in the library? open it instead of adding a second copy
      const existing = findSample(await listBooks());
      const id = existing?.id ?? (await addBook(sampleBook(), { name: SAMPLE_FILE_NAME, size: 0, format: 'txt' })).id;
      navigate(ROUTES.read(id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the sample', { kind: 'error' });
    } finally {
      sampleBusy.current = false;
    }
  };

  const tags = useMemo(() => collectTags(books ?? []), [books]);
  const menuBook = (menuId && books?.find((b) => b.id === menuId)) || null;
  const onMore = useCallback((b: Book) => setMenuId(b.id), []);
  const onToggleFavorite = useCallback((b: Book) => {
    updateBook(b.id, { favorite: !b.favorite }).catch(() => toast('Could not update the book', { kind: 'error' }));
  }, []);

  const count = books?.length ?? 0;
  const importActions = (
    <>
      <button type="button" className="btn btn--secondary btn--md lib-paste-btn" onClick={() => setPasteOpen(true)} aria-label="Paste text" title="Paste text">
        <XIcon name="clipboard" size={18} />
        <span className="lib-paste-btn__label">Paste</span>
      </button>
      <button
        type="button"
        className="btn btn--primary btn--md"
        data-focus-fallback
        onClick={openPicker}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onPointerDown={prefetch}
      >
        <Icon name="plus" size={18} />
        Add
      </button>
    </>
  );

  return (
    <div className="page library">
      <PageHeader
        title="Library"
        subtitle={books === undefined ? ' ' : count ? `${count} ${count === 1 ? 'book' : 'books'}` : 'Your books, documents and pasted texts.'}
        actions={count ? importActions : undefined}
      />
      <input ref={fileInput} type="file" multiple accept={accept} hidden onChange={onPicked} tabIndex={-1} aria-hidden="true" />
      <ImportPanel />

      {books === undefined ? null : count === 0 ? (
        <Welcome onAdd={openPicker} onPaste={() => setPasteOpen(true)} onSample={trySample} onIntent={prefetch} />
      ) : (
        <Shelf books={books} tags={tags} wpm={wpm} onMore={onMore} onToggleFavorite={onToggleFavorite} />
      )}

      <PasteModal open={pasteOpen} onClose={() => setPasteOpen(false)} onAdded={offerReadNow} />
      <BookMenu book={menuBook} allTags={tags} onClose={() => setMenuId(null)} />
      <DropOverlay visible={dragging} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Welcome({ onAdd, onPaste, onSample, onIntent }: { onAdd: () => void; onPaste: () => void; onSample: () => void; onIntent: () => void }) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__demo" aria-hidden="true">
        <span className="welcome__tick" />
        <span className="welcome__word">
          <span>re</span>
          <span className="welcome__focus">a</span>
          <span>d</span>
        </span>
        <span className="welcome__tick welcome__tick--bottom" />
      </div>
      <h2 id="welcome-title" className="welcome__title">
        Read faster, one word at a time.
      </h2>
      <p className="welcome__body">
        Tempo flashes your books word by word at the speed you choose, with a highlighted letter to anchor your eyes. No more line jumping, so you
        read faster and can train toward your real potential.
      </p>
      <div className="welcome__actions">
        <button type="button" className="btn btn--primary btn--lg" data-focus-fallback onClick={onAdd} onPointerEnter={onIntent} onFocus={onIntent} onPointerDown={onIntent}>
          <Icon name="plus" size={20} />
          Add files
        </button>
        <button type="button" className="btn btn--secondary btn--lg" onClick={onPaste}>
          <XIcon name="clipboard" size={20} />
          Paste text
        </button>
      </div>
      <button type="button" className="welcome__sample" onClick={onSample}>
        <XIcon name="sparkle" size={18} />
        Try a 2-minute sample
      </button>
      <p className="welcome__hint muted">Your files stay on this device. Drop files anywhere on this page to add them.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function ContinueCard({ book, wpm }: { book: Book; wpm: number }) {
  const progress = bookProgress(book);
  return (
    <section className="continue" aria-labelledby="continue-title">
      <Link to={ROUTES.read(book.id)} className="continue__cover" tabIndex={-1} aria-hidden="true">
        <BookCover bookId={book.id} title={book.title} author={book.author} cover={book.cover} />
      </Link>
      <div className="continue__body">
        <p className="continue__eyebrow">Continue reading</p>
        <h2 id="continue-title" className="continue__title">
          {book.title}
        </h2>
        {book.author ? <p className="continue__author">{book.author}</p> : null}
        <div className="continue__progress">
          <div
            className="continue__bar"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(progress * 100)}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="continue__meta">
            <span>
              {book.position > 0 ? `${progressLabel(book)} read` : 'Just started'} · {pagesLabel(book)}
            </span>
            <span>
              {timeLeftLabel(book, wpm)} at {wpm} wpm
            </span>
          </p>
        </div>
        <Link to={ROUTES.read(book.id)} className="btn btn--primary btn--lg continue__resume">
          <Icon name="play" size={20} />
          Resume
          <span className="visually-hidden"> {book.title}</span>
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Shelf({
  books,
  tags,
  wpm,
  onMore,
  onToggleFavorite,
}: {
  books: Book[];
  tags: string[];
  wpm: number;
  onMore: (b: Book) => void;
  onToggleFavorite: (b: Book) => void;
}) {
  const { view, sort, filter, setView, setSort, setFilter } = useLibraryPrefs();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searchId = useId();
  const sortId = useId();
  // a remembered tag filter whose shelf no longer exists falls back to All
  const effectiveFilter: FilterKey = filter.startsWith('tag:') && !tags.includes(filter.slice(4)) ? 'all' : filter;

  const visible = useMemo(() => selectBooks(books, { query: deferredQuery, filter: effectiveFilter, sort }), [books, deferredQuery, effectiveFilter, sort]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of BUILTIN_FILTERS) c[f.value] = books.filter((b) => matchesFilter(b, f.value)).length;
    for (const t of tags) c[`tag:${t}`] = books.filter((b) => b.tags.includes(t)).length;
    return c;
  }, [books, tags]);
  const resume = useMemo(() => continueReading(books), [books]);
  const filtering = effectiveFilter !== 'all' || deferredQuery.trim() !== '';

  const chips: { value: FilterKey; label: string; tag?: boolean }[] = [
    ...BUILTIN_FILTERS.filter((f) => f.value === 'all' || counts[f.value] > 0 || f.value === effectiveFilter),
    ...tags.map((t) => ({ value: `tag:${t}` as FilterKey, label: t, tag: true })),
  ];

  return (
    <>
      {resume && !filtering ? <ContinueCard book={resume} wpm={wpm} /> : null}

      <div className="lib-toolbar" role="search">
        <div className="lib-search">
          <Icon name="search" size={18} className="lib-search__icon" />
          <label htmlFor={searchId} className="visually-hidden">
            Search title or author
          </label>
          <input
            id={searchId}
            type="search"
            className="tm-input lib-search__input"
            placeholder="Search title or author"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query ? <IconButton icon="close" label="Clear search" size="sm" className="lib-search__clear" onClick={() => setQuery('')} /> : null}
        </div>
        <div className="lib-toolbar__right">
          <div className="tm-select">
            <label htmlFor={sortId} className="visually-hidden">
              Sort by
            </label>
            <select id={sortId} className="tm-select__input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <XIcon name="chevron-down" size={16} className="tm-select__chev" />
          </div>
          <div className="tm-seg" role="group" aria-label="Layout">
            <button type="button" className="tm-seg__btn" aria-pressed={view === 'grid'} aria-label="Cover grid" title="Cover grid" onClick={() => setView('grid')}>
              <XIcon name="grid" size={18} />
            </button>
            <button type="button" className="tm-seg__btn" aria-pressed={view === 'list'} aria-label="List" title="List" onClick={() => setView('list')}>
              <XIcon name="list" size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="tm-chip-row tm-chip-row--scroll" role="group" aria-label="Filter">
        {chips.map((c) => (
          <button key={c.value} type="button" className={`tm-chip${c.tag ? ' tm-chip--tag' : ''}`} aria-pressed={effectiveFilter === c.value} onClick={() => setFilter(c.value)}>
            {c.tag ? <XIcon name="tag" size={14} /> : null}
            {c.label}
            <span className="tm-chip__count">{counts[c.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <p className="visually-hidden" aria-live="polite">
        {filtering ? `${visible.length} ${visible.length === 1 ? 'book' : 'books'} shown` : ''}
      </p>

      {visible.length ? (
        <ul className={`tm-shelf tm-shelf--${view}`}>
          {visible.map((b) => (
            <BookItem key={b.id} book={b} view={view} wpm={wpm} onMore={onMore} onToggleFavorite={onToggleFavorite} />
          ))}
        </ul>
      ) : (
        <div className="lib-noresults">
          <p className="lib-noresults__title">No books match</p>
          <p className="muted">
            {deferredQuery.trim() ? `Nothing found for "${deferredQuery.trim()}"` : 'This filter is empty right now.'}
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Show all books
          </button>
        </div>
      )}
    </>
  );
}
