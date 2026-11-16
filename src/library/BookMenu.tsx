import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { deleteBook, updateBook } from '../core/db';
import type { Book } from '../core/types';
import { Button, Icon, Modal, toast } from '../ui';
import { addTag, bookStatus, cleanTag, formatBadge } from './logic';
import { XIcon, type XIconName } from './XIcon';
import { pagesLabel, progressLabel } from './BookItem';

type Mode = 'menu' | 'edit' | 'tags' | 'delete' | 'reset';

export interface BookMenuProps {
  /** null = closed */
  book: Book | null;
  allTags: string[];
  onClose: () => void;
}

function fail(err: unknown) {
  toast(err instanceof Error ? err.message : 'Something went wrong', { kind: 'error' });
}

/** Action sheet for one book, plus its sub-dialogs (edit details, shelves, reset, delete). */
export function BookMenu({ book, allTags, onClose }: BookMenuProps) {
  const [mode, setMode] = useState<Mode>('menu');
  const bookId = book?.id;
  useEffect(() => setMode('menu'), [bookId]);
  if (!book) return null;

  const close = () => {
    setMode('menu');
    onClose();
  };

  if (mode === 'edit') return <EditDetails book={book} onDone={close} />;
  if (mode === 'tags') return <EditTags book={book} allTags={allTags} onDone={close} />;
  if (mode === 'delete') return <ConfirmDelete book={book} onDone={close} />;
  if (mode === 'reset') return <ConfirmReset book={book} onDone={close} />;

  const finished = bookStatus(book) === 'finished';
  const run = (fn: () => Promise<void>, message: string) => {
    close();
    fn().then(() => toast(message), fail);
  };

  return (
    <Modal open onClose={close} title={book.title} className="book-menu">
      <p className="book-menu__sub">
        {[book.author || 'Unknown author', formatBadge(book), progressLabel(book), pagesLabel(book)].join(' · ')}
      </p>
      <ul className="book-menu__list">
        <MenuItem icon="edit" onClick={() => setMode('edit')}>
          Edit title and author
        </MenuItem>
        <MenuItem icon="tag" onClick={() => setMode('tags')} hint={book.tags.length ? book.tags.join(', ') : undefined}>
          Shelves
        </MenuItem>
        <MenuItem
          uiIcon="star"
          onClick={() =>
            run(() => updateBook(book.id, { favorite: !book.favorite }), book.favorite ? 'Removed from favourites' : 'Added to favourites')
          }
        >
          {book.favorite ? 'Remove from favourites' : 'Add to favourites'}
        </MenuItem>
        <MenuItem
          icon={finished ? 'undo' : 'check'}
          onClick={() =>
            finished
              ? run(
                  // a book left at its very end would be re-marked finished on the next open, so start it over
                  () => updateBook(book.id, { finishedAt: null, position: book.position >= book.wordCount ? 0 : book.position }),
                  'Marked as unfinished',
                )
              : run(() => updateBook(book.id, { finishedAt: Date.now(), position: book.wordCount }), 'Marked as finished')
          }
        >
          {finished ? 'Mark as unfinished' : 'Mark as finished'}
        </MenuItem>
        <MenuItem icon="refresh" onClick={() => setMode('reset')} disabled={book.position === 0 && !finished}>
          Reset progress
        </MenuItem>
        <MenuItem uiIcon="trash" danger onClick={() => setMode('delete')}>
          Delete…
        </MenuItem>
      </ul>
    </Modal>
  );
}

function MenuItem({
  icon,
  uiIcon,
  children,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon?: XIconName;
  uiIcon?: 'star' | 'trash';
  children: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" className={`book-menu__item${danger ? ' is-danger' : ''}`} onClick={onClick} disabled={disabled}>
        {uiIcon ? <Icon name={uiIcon} size={20} /> : icon ? <XIcon name={icon} size={20} /> : null}
        <span className="book-menu__label">
          {children}
          {hint ? <span className="book-menu__hint">{hint}</span> : null}
        </span>
      </button>
    </li>
  );
}

function EditDetails({ book, onDone }: { book: Book; onDone: () => void }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const titleId = useId();
  const authorId = useId();
  const formId = useId();
  const trimmed = title.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    updateBook(book.id, { title: trimmed.slice(0, 300), author: author.trim().slice(0, 200) }).then(() => {
      toast('Details saved');
      onDone();
    }, fail);
  };
  return (
    <Modal
      open
      onClose={onDone}
      title="Edit details"
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!trimmed}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} className="tm-form-stack" onSubmit={submit}>
        <div className="tm-field">
          <label htmlFor={titleId}>Title</label>
          <input id={titleId} className="tm-input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus required maxLength={300} />
        </div>
        <div className="tm-field">
          <label htmlFor={authorId}>Author</label>
          <input id={authorId} className="tm-input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Unknown" maxLength={200} />
        </div>
      </form>
    </Modal>
  );
}

function EditTags({ book, allTags, onDone }: { book: Book; allTags: string[]; onDone: () => void }) {
  const [tags, setTags] = useState<string[]>(book.tags);
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const options = [...new Set([...allTags, ...tags])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = cleanTag(draft);
    if (!t) return;
    // re-use the existing spelling when the user types a shelf that already exists in another case
    const existing = options.find((o) => o.toLowerCase() === t.toLowerCase());
    setTags((cur) => (existing ? (cur.includes(existing) ? cur : [...cur, existing]) : addTag(cur, t)));
    setDraft('');
  };
  const save = () =>
    updateBook(book.id, { tags }).then(() => {
      toast('Shelves saved');
      onDone();
    }, fail);
  return (
    <Modal
      open
      onClose={onDone}
      title="Shelves"
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Done
          </Button>
        </>
      }
    >
      <p className="muted tm-small">Group books on shelves like "Work", "Fiction" or "To read". Each shelf becomes a filter in your library.</p>
      <form className="tag-add" onSubmit={add}>
        <label htmlFor={inputId} className="visually-hidden">
          New shelf name
        </label>
        <input
          id={inputId}
          className="tm-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New shelf…"
          maxLength={40}
          data-autofocus
          enterKeyHint="done"
        />
        <Button type="submit" icon="plus" disabled={!cleanTag(draft)}>
          Add
        </Button>
      </form>
      {options.length ? (
        <div className="tm-chip-row tm-chip-row--wrap" role="group" aria-label="Shelves for this book">
          {options.map((t) => (
            <button key={t} type="button" className="tm-chip" aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
              {tags.includes(t) ? <XIcon name="check" size={14} /> : null}
              {t}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted tm-small">No shelves yet. Type a name above to create one.</p>
      )}
    </Modal>
  );
}

/** The next (else previous) book's open link, captured before a book is removed. */
function focusTargetAfterRemoving(bookId: string): string | null {
  const li = document.querySelector(`[data-book-id="${CSS.escape(bookId)}"]`);
  const sib = (li?.nextElementSibling ?? li?.previousElementSibling) as HTMLElement | null;
  return sib?.dataset.bookId ?? null;
}

function moveFocusAfterRemoval(nextBookId: string | null, attempt = 0) {
  setTimeout(() => {
    const next = nextBookId ? document.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(nextBookId)}"] a`) : null;
    const el = next ?? document.querySelector<HTMLElement>('[data-focus-fallback]');
    el?.focus();
    // The live query re-renders a moment later (deleting the last book swaps the header's Add button for
    // the welcome screen's), so check again and re-place focus if it fell back to <body>.
    if (attempt < 3) {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) moveFocusAfterRemoval(nextBookId, attempt + 1);
      }, 250);
    }
  }, 60);
}

function ConfirmDelete({ book, onDone }: { book: Book; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = () => {
    setBusy(true);
    const target = focusTargetAfterRemoving(book.id);
    deleteBook(book.id).then(
      () => {
        toast(`Deleted "${book.title}"`);
        onDone();
        // The dialog tries to return focus to the book's "more" button, which is about to disappear:
        // move it to the next book (or the previous one), else to the Add button.
        moveFocusAfterRemoval(target);
      },
      (e) => {
        setBusy(false);
        fail(e);
      },
    );
  };
  return (
    <Modal
      open
      onClose={onDone}
      title="Delete this book?"
      placement="center"
      footer={
        <>
          <Button variant="ghost" onClick={onDone} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" icon="trash" onClick={confirm} disabled={busy}>
            Delete
          </Button>
        </>
      }
    >
      <p>
        <strong>{book.title}</strong> will be removed from this device together with its reading position, bookmarks and reading history
        (its time also disappears from your stats). This can't be undone.
      </p>
    </Modal>
  );
}

function ConfirmReset({ book, onDone }: { book: Book; onDone: () => void }) {
  const confirm = () =>
    updateBook(book.id, { position: 0, finishedAt: null }).then(() => {
      toast('Progress reset');
      onDone();
    }, fail);
  return (
    <Modal
      open
      onClose={onDone}
      title="Reset progress?"
      placement="center"
      footer={
        <>
          <Button variant="ghost" onClick={onDone} data-autofocus>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm}>
            Start over
          </Button>
        </>
      }
    >
      <p>
        <strong>{book.title}</strong> goes back to the first word. Bookmarks and your reading history are kept.
      </p>
    </Modal>
  );
}
