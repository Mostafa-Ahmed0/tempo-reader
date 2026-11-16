import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { addBook, listBooks } from '../core/db';
import { toast } from '../ui';
import { SAMPLE_FILE_NAME, findSample, sampleBook } from './sample';

/** "Try the sample": add the built-in guide once (or reuse it) and open it in the reader. */
export function useOpenSample(): () => Promise<void> {
  const navigate = useNavigate();
  const busy = useRef(false);
  return useCallback(async () => {
    if (busy.current) return; // double taps must not add it twice
    busy.current = true;
    try {
      // already in the library? open it instead of adding a second copy
      const existing = findSample(await listBooks());
      const id = existing?.id ?? (await addBook(sampleBook(), { name: SAMPLE_FILE_NAME, size: 0, format: 'txt' })).id;
      navigate(ROUTES.read(id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the sample', { kind: 'error' });
    } finally {
      busy.current = false;
    }
  }, [navigate]);
}
