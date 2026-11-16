import { useId, useMemo, useState, type FormEvent } from 'react';
import { addBook } from '../core/db';
import type { Book } from '../core/types';
import { Button, IconButton, Modal, toast } from '../ui';
import { loadParsers, useImports, type ImportItem } from './importer';
import { XIcon } from './XIcon';

// ---------------------------------------------------------------------------
// Paste text
// ---------------------------------------------------------------------------

export function PasteModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (b: Book) => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const titleId = useId();
  const textId = useId();
  // cheap whitespace count for the live counter (the real tokenizer runs once on save)
  const words = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);

  const reset = () => {
    setTitle('');
    setText('');
    setBusy(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!words || busy) return;
    setBusy(true);
    try {
      const { parsePastedText } = await loadParsers();
      const parsed = parsePastedText(text, title.trim() || undefined);
      const book = await addBook(parsed, { name: parsed.title, size: new Blob([text]).size, format: 'paste' });
      reset();
      onClose();
      onAdded(book);
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error ? err.message : 'Could not add the text', { kind: 'error' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste text"
      className="paste-modal"
      footer={
        <>
          <span className="paste-modal__count muted" aria-live="polite">
            {words ? `${words.toLocaleString()} words` : ''}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!words || busy}>
            {busy ? 'Adding…' : 'Add to library'}
          </Button>
        </>
      }
    >
      <form id={formId} className="tm-form-stack" onSubmit={submit}>
        <div className="tm-field">
          <label htmlFor={titleId}>
            Title <span className="muted">(optional)</span>
          </label>
          <input id={titleId} className="tm-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the first line" maxLength={300} />
        </div>
        <div className="tm-field">
          <label htmlFor={textId}>Text</label>
          <textarea
            id={textId}
            className="tm-input tm-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an article, a chapter, notes…"
            rows={9}
            data-autofocus
          />
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Import progress list
// ---------------------------------------------------------------------------

function statusText(it: ImportItem): string {
  switch (it.status) {
    case 'queued':
      return 'Waiting';
    case 'parsing':
      return `Reading ${Math.round(it.progress * 100)}%`;
    case 'saving':
      return 'Saving';
    case 'done':
      return 'Added';
    case 'failed':
      return 'Failed';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportPanel() {
  const items = useImports((s) => s.items);
  const running = useImports((s) => s.running);
  const clearFinished = useImports((s) => s.clearFinished);
  if (!items.length) return null;
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const total = items.length;
  const summary = running
    ? `Importing ${Math.min(done + failed + 1, total)} of ${total}`
    : `${done} added${failed ? `, ${failed} failed` : ''}`;

  return (
    <section className="imports" aria-labelledby="imports-title">
      <header className="imports__head">
        <h2 id="imports-title" className="imports__title" aria-live="polite">
          {summary}
        </h2>
        {!running ? <IconButton icon="close" label="Dismiss import list" size="sm" onClick={clearFinished} /> : null}
      </header>
      <ul className="imports__list">
        {items.map((it) => (
          <li key={it.id} className={`imports__item is-${it.status}`}>
            <span className="imports__icon" aria-hidden="true">
              {it.status === 'done' ? <XIcon name="check" size={16} /> : it.status === 'failed' ? <XIcon name="alert" size={16} /> : <XIcon name="file" size={16} />}
            </span>
            <div className="imports__main">
              <div className="imports__row">
                <span className="imports__name" title={it.name}>
                  {it.name}
                </span>
                <span className="imports__status">
                  {statusText(it)}
                  <span className="imports__size"> · {formatSize(it.size)}</span>
                </span>
              </div>
              {it.status === 'parsing' || it.status === 'saving' || it.status === 'queued' ? (
                <div
                  className="imports__bar"
                  role="progressbar"
                  aria-label={`Importing ${it.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(it.progress * 100)}
                >
                  <span style={{ width: `${it.progress * 100}%` }} />
                </div>
              ) : null}
              {it.error ? <p className="imports__error">{it.error}</p> : null}
              {it.warning ? <p className="imports__warning">{it.warning}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay__card">
        <XIcon name="download" size={32} />
        <p className="drop-overlay__title">Drop to add to your library</p>
        <p className="drop-overlay__sub">Several files at once are fine</p>
      </div>
    </div>
  );
}
