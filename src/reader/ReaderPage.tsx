// Full-screen reader at /read/:bookId (lazy-loaded, rendered outside the app shell).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { getBook, getContent } from '../core/db';
import { tokenize } from '../core/tokenizer';
import type { Book, TokenizedBook } from '../core/types';
import { Button, EmptyState } from '../ui';
import { Reader } from './Reader';
import './reader.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; book: Book; tok: TokenizedBook };

export default function ReaderPage() {
  const { bookId = '' } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      const [book, content] = await Promise.all([getBook(bookId), getContent(bookId)]);
      if (cancelled) return;
      if (!book || !content) {
        setState({ status: 'missing' });
        return;
      }
      // let the loading state paint before the (synchronous) tokenizer runs on big books
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;
      const t0 = performance.now();
      const tok = tokenize(content.sections);
      if (import.meta.env.DEV) console.debug(`[reader] tokenized ${tok.words.length} words in ${Math.round(performance.now() - t0)} ms`);
      if (!cancelled) setState({ status: 'ready', book, tok });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (state.status === 'ready') return <Reader key={state.book.id} book={state.book} tok={state.tok} />;

  return (
    <div className="rd-reader rd-reader--message">
      {state.status === 'loading' ? (
        <div className="rd-reader__loading" role="status" aria-live="polite">
          <span className="rd-reader__spinner" aria-hidden="true" />
          <span>Opening book…</span>
        </div>
      ) : (
        <EmptyState
          title={state.status === 'missing' ? "This book isn't in your library any more" : 'Could not open this book'}
          action={
            <Button variant="primary" icon="chevron-left" onClick={() => navigate(ROUTES.library)}>
              Back to library
            </Button>
          }
        >
          {state.status === 'missing' ? (
            <>
              <p>It may have been deleted, or the link is out of date.</p>
            </>
          ) : (
            <p className="muted">{state.message}</p>
          )}
        </EmptyState>
      )}
    </div>
  );
}
