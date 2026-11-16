import { memo, useRef, type MouseEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { estimateMinutes, formatDuration } from '../core/text';
import type { Book } from '../core/types';
import { Icon } from '../ui';
import { BookCover } from './BookCover';
import { bookProgress, bookStatus, formatBadge, wordsLeft } from './logic';
import { XIcon } from './XIcon';

export function timeLeftLabel(book: Pick<Book, 'position' | 'wordCount' | 'finishedAt'>, wpm: number): string {
  const left = wordsLeft(book);
  if (book.finishedAt != null) return 'Finished';
  if (book.wordCount === 0) return 'No text';
  return `${formatDuration(estimateMinutes(left, wpm) * 60_000)} left`;
}

export function progressLabel(book: Pick<Book, 'position' | 'wordCount' | 'finishedAt'>): string {
  const status = bookStatus(book);
  if (status === 'finished') return 'Finished';
  if (status === 'not-started') return 'New';
  const pct = Math.floor(bookProgress(book) * 100);
  return `${pct === 0 ? '<1' : pct}%`;
}

export interface BookItemProps {
  book: Book;
  view: 'grid' | 'list';
  wpm: number;
  onMore: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
}

const LONG_PRESS_MS = 500;

function BookItemImpl({ book, view, wpm, onMore, onToggleFavorite }: BookItemProps) {
  const progress = bookProgress(book);
  const status = bookStatus(book);
  const finished = status === 'finished';
  const pLabel = progressLabel(book);
  const tLabel = timeLeftLabel(book, wpm);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  // Long-press (touch / pen) opens the action sheet. Android also fires `contextmenu` on long-press,
  // which is handled the same way (opening twice is idempotent).
  const longPress = {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      suppressClick.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        suppressClick.current = true;
        timer.current = null;
        navigator.vibrate?.(10);
        onMore(book);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      suppressClick.current = true;
      onMore(book);
    },
    onClick: (e: MouseEvent) => {
      if (suppressClick.current) {
        e.preventDefault();
        suppressClick.current = false;
      }
    },
  };

  const a11yName = [
    book.title,
    book.author ? `by ${book.author}` : '',
    finished ? 'finished' : status === 'not-started' ? 'not started' : `${Math.floor(progress * 100)}% read, ${tLabel}`,
  ]
    .filter(Boolean)
    .join(', ');

  const actions = (
    <div className="tm-book__actions">
      <button
        type="button"
        className={`tm-book__fav${book.favorite ? ' is-on' : ''}`}
        aria-pressed={book.favorite}
        aria-label={`Favourite: ${book.title}`}
        title={book.favorite ? 'Remove from favourites' : 'Add to favourites'}
        onClick={() => onToggleFavorite(book)}
      >
        <Icon name="star" size={18} />
      </button>
      <button
        type="button"
        className="tm-book__more"
        aria-label={`More actions for ${book.title}`}
        aria-haspopup="dialog"
        title="More actions"
        onClick={() => onMore(book)}
      >
        <Icon name="more" size={20} />
      </button>
    </div>
  );

  const badges = (
    <>
      <span className="tm-book__format">{formatBadge(book)}</span>
      {finished ? (
        <span className="tm-book__done" title="Finished">
          <XIcon name="check" size={14} />
          <span className="visually-hidden">Finished</span>
        </span>
      ) : null}
    </>
  );

  if (view === 'list') {
    return (
      <li data-book-id={book.id} className={`tm-book tm-book--row${finished ? ' is-finished' : ''}`}>
        <Link to={ROUTES.read(book.id)} className="tm-book__open" aria-label={a11yName} draggable={false} {...longPress}>
          <span className="tm-book__thumb">
            <BookCover bookId={book.id} title={book.title} author={book.author} cover={book.cover} compact />
          </span>
          <span className="tm-book__body">
            <span className="tm-book__title">{book.title}</span>
            <span className="tm-book__author">{book.author || 'Unknown author'}</span>
            <span className="tm-book__meta">
              {badges}
              <span className="tm-book__meta-text">
                {pLabel}
                {!finished && book.wordCount > 0 ? ` · ${tLabel}` : ''}
              </span>
            </span>
            <span className="tm-book__bar" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
        </Link>
        {actions}
      </li>
    );
  }

  return (
    <li data-book-id={book.id} className={`tm-book tm-book--card${finished ? ' is-finished' : ''}`}>
      <Link to={ROUTES.read(book.id)} className="tm-book__open" aria-label={a11yName} draggable={false} {...longPress}>
        <span className="tm-book__cover-wrap">
          <BookCover bookId={book.id} title={book.title} author={book.author} cover={book.cover} />
          <span className="tm-book__badges">{badges}</span>
          <span className="tm-book__bar tm-book__bar--cover" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        </span>
        <span className="tm-book__title">{book.title}</span>
        <span className="tm-book__author">{book.author || 'Unknown author'}</span>
        <span className="tm-book__meta-text">
          {pLabel}
          {!finished && book.wordCount > 0 ? ` · ${tLabel}` : ''}
        </span>
      </Link>
      {actions}
    </li>
  );
}

const sameBook = (a: Book, b: Book) =>
  a.id === b.id &&
  a.title === b.title &&
  a.author === b.author &&
  a.position === b.position &&
  a.wordCount === b.wordCount &&
  a.finishedAt === b.finishedAt &&
  a.favorite === b.favorite &&
  a.format === b.format &&
  a.cover?.size === b.cover?.size &&
  a.cover?.type === b.cover?.type;

/** Memoised: a live-query refresh hands us new objects for every book, but only changed ones re-render. */
export const BookItem = memo(
  BookItemImpl,
  (p, n) => p.view === n.view && p.wpm === n.wpm && p.onMore === n.onMore && p.onToggleFavorite === n.onToggleFavorite && sameBook(p.book, n.book),
);
