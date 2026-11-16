import { Link } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import type { Book } from '../core/types';
import { Icon } from '../ui';
import { BookCover } from './BookCover';
import { pagesLabel, progressLabel, timeLeftLabel } from './BookItem';
import { bookProgress } from './logic';
import './library.css';

/** "Continue reading" hero for the most recently read unfinished book (shown on Home). */
export function ContinueCard({ book, wpm }: { book: Book; wpm: number }) {
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
