import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { clearAllData, exportBackup, importBackup, useLiveBooks } from '../core/db';
import { useSettings } from '../core/settings';
import { saveFile } from '../platform/saveFile';
import { Button, Modal, toast } from '../ui';
import { LIBRARY_PREFS_KEY, useLibraryPrefs } from '../library/prefs';
import { XIcon } from '../library/XIcon';
import { Row, Section } from './controls';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `tempo-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

function useStorageEstimate(): [{ usage: number; quota: number } | null | 'unsupported', () => void] {
  const [est, setEst] = useState<{ usage: number; quota: number } | null | 'unsupported'>(null);
  const refresh = useCallback(() => {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) {
      setEst('unsupported');
      return;
    }
    storage.estimate().then(
      (e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }),
      () => setEst('unsupported'),
    );
  }, []);
  useEffect(refresh, [refresh]);
  return [est, refresh];
}

const CONFIRM_WORD = 'DELETE';

export function DataSection() {
  const books = useLiveBooks();
  const [est, refreshEstimate] = useStorageEstimate();
  const [exporting, setExporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmId = useId();
  const count = books?.length ?? 0;

  useEffect(refreshEstimate, [count, refreshEstimate]);

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await exportBackup();
      // Web: download. Android app: written to cache and offered via the share sheet (src/platform/saveFile.ts).
      const result = await saveFile(blob, backupFileName());
      if (result !== 'cancelled') toast(`Backup ${result === 'shared' ? 'exported' : 'downloaded'} (${formatBytes(blob.size)})`, { kind: 'success' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', { kind: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const doImport = async () => {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const { books: n } = await importBackup(pendingImport);
      toast(`Restored ${n} ${n === 1 ? 'book' : 'books'} and your settings from the backup.`, { kind: 'success', duration: 5000 });
      setPendingImport(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', { kind: 'error' });
    } finally {
      setImporting(false);
      refreshEstimate();
    }
  };

  const doDeleteAll = async () => {
    setDeleting(true);
    try {
      const n = count;
      await clearAllData(); // one transaction; also removes sessions of books that no longer exist
      useSettings.getState().reset();
      useLibraryPrefs.setState({ view: 'grid', sort: 'recent-read', filter: 'all' });
      try {
        localStorage.removeItem(LIBRARY_PREFS_KEY);
      } catch {
        /* ignore */
      }
      setDeleteOpen(false);
      setTyped('');
      toast(`All data deleted (${n} ${n === 1 ? 'book' : 'books'}). Settings reset.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', { kind: 'error' });
    } finally {
      setDeleting(false);
      refreshEstimate();
    }
  };

  const pct = est && est !== 'unsupported' && est.quota > 0 ? Math.min(100, (est.usage / est.quota) * 100) : 0;

  return (
    <Section id="data" title="Data" description="Everything is stored only on this device. Back it up to move to another device or browser.">
      <Row label="Export backup" help="Books, progress, bookmarks, stats and settings in one .json file.">
        <Button icon="upload" onClick={doExport} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Export'}
        </Button>
      </Row>
      <Row label="Import backup" help="Merges a Tempo backup into this library and applies its settings.">
        <Button onClick={() => fileRef.current?.click()}>
          <XIcon name="download" size={18} />
          Import…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            e.currentTarget.value = '';
            if (f) setPendingImport(f);
          }}
        />
      </Row>
      <div className="set-row set-row--stack">
        <div className="set-row__text">
          <span className="set-row__label">Storage used</span>
          <span className="set-row__help">
            {est === null
              ? 'Checking…'
              : est === 'unsupported'
                ? `Not available in this browser. ${count} ${count === 1 ? 'book' : 'books'} stored.`
                : `${formatBytes(est.usage)} used${est.quota ? ` of about ${formatBytes(est.quota)} available` : ''} · ${count} ${count === 1 ? 'book' : 'books'}`}
          </span>
        </div>
        {est && est !== 'unsupported' && est.quota > 0 ? (
          <div className="tm-meter" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={`${pct.toFixed(1)} percent`}>
            <span style={{ width: `${Math.max(pct, 0.75)}%` }} />
          </div>
        ) : null}
      </div>
      <Row label="Delete all data" help="Removes every book, bookmark and reading session, and resets settings.">
        <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
          Delete all…
        </Button>
      </Row>

      <Modal
        open={!!pendingImport}
        onClose={() => !importing && setPendingImport(null)}
        title="Import this backup?"
        placement="center"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingImport(null)} disabled={importing} data-autofocus>
              Cancel
            </Button>
            <Button variant="primary" onClick={doImport} disabled={importing}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </>
        }
      >
        <p>
          <strong className="tm-break">{pendingImport?.name}</strong> ({formatBytes(pendingImport?.size ?? 0)})
        </p>
        <p className="muted tm-small" style={{ marginTop: 8 }}>
          Books in the backup are added to your library; a book that exists in both is replaced by the backup's copy (including its progress).
          Your current settings are replaced by the backup's settings. Nothing else is deleted.
        </p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setTyped('');
        }}
        title="Delete all data?"
        placement="center"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteOpen(false);
                setTyped('');
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={doDeleteAll} disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || deleting}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </>
        }
      >
        <p>
          This permanently removes all {count} {count === 1 ? 'book' : 'books'} with their bookmarks and reading history (your stats), and resets
          every setting. It can't be undone. Consider exporting a backup first.
        </p>
        <div className="tm-field" style={{ marginTop: 16 }}>
          <label htmlFor={confirmId}>
            Type <strong>{CONFIRM_WORD}</strong> to confirm
          </label>
          <input
            id={confirmId}
            className="tm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed.trim().toUpperCase() === CONFIRM_WORD && !deleting) void doDeleteAll();
            }}
          />
        </div>
      </Modal>
    </Section>
  );
}
