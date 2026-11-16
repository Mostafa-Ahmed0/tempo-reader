import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { BUILTIN_FILTERS, SORT_OPTIONS, type FilterKey, type SortKey } from './logic';

export type LibraryView = 'grid' | 'list';
export const LIBRARY_PREFS_KEY = 'tempo-library-prefs';

interface LibraryPrefs {
  view: LibraryView;
  sort: SortKey;
  filter: FilterKey;
  setView: (v: LibraryView) => void;
  setSort: (s: SortKey) => void;
  setFilter: (f: FilterKey) => void;
}

const isSort = (v: unknown): v is SortKey => SORT_OPTIONS.some((o) => o.value === v);
const isFilter = (v: unknown): v is FilterKey =>
  typeof v === 'string' && (BUILTIN_FILTERS.some((o) => o.value === v) || (v.startsWith('tag:') && v.length > 4));

/** UI preferences of the library page (view mode, sort, filter), remembered in localStorage. */
export const useLibraryPrefs = create<LibraryPrefs>()(
  persist(
    (set) => ({
      view: 'grid',
      sort: 'recent-read',
      filter: 'all',
      setView: (view) => set({ view }),
      setSort: (sort) => set({ sort }),
      setFilter: (filter) => set({ filter }),
    }),
    {
      name: LIBRARY_PREFS_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ view, sort, filter }) => ({ view, sort, filter }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...current,
          ...(p.view === 'grid' || p.view === 'list' ? { view: p.view } : {}),
          ...(isSort(p.sort) ? { sort: p.sort } : {}),
          ...(isFilter(p.filter) ? { filter: p.filter } : {}),
        };
      },
    },
  ),
);
