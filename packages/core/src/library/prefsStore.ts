import type { FilterState, LibraryView, SortPreset, WatchStatus } from '../providers/types';
import type { KeyValueStore } from '../storage/keyValueStore';
import { DEFAULT_SORT, type MediaPage } from './viewState';

/** Bump when the stored shape changes; older entries are read through `migrate`, never deleted. */
export const SCHEMA_VERSION = 1;

/** Who and where a saved view belongs to. Movies and Series have their own entries, as does every library. */
export interface ViewScope {
  provider: string;
  serverId: string;
  /** The viewer: the signed-in user or Plex Home profile. */
  userId: string;
  libraryId: string;
  page: MediaPage;
}

export function scopeKey(scope: ViewScope): string {
  return [scope.provider, scope.serverId, scope.userId, scope.libraryId, scope.page].map(encodeURIComponent).join('/');
}

interface Stored {
  schemaVersion: number;
  scopeKey: string;
  filters: FilterState;
  sort: SortPreset;
}

const SORTS: SortPreset[] = [
  'titleAsc',
  'titleDesc',
  'addedDesc',
  'releaseDesc',
  'releaseAsc',
  'firstAiredDesc',
  'firstAiredAsc',
  'ratingDesc',
  'runtimeAsc',
  'runtimeDesc',
];
const WATCH: WatchStatus[] = ['unwatched', 'inProgress', 'watched', 'hasUnwatched', 'completed'];

/**
 * The last successfully applied filters and sort for each scope. Only applied views are written: drafts, counts and
 * open drawers never are, and nothing here is secret. Unknown or damaged entries read as "nothing saved".
 */
export class LibraryPrefsStore {
  constructor(private readonly store: KeyValueStore) {}

  private key(scope: ViewScope): string {
    return `anystream.libraryView.v${SCHEMA_VERSION}.${scopeKey(scope)}`;
  }

  get(scope: ViewScope): LibraryView | null {
    const raw = this.store.getString(this.key(scope));
    if (!raw) {
      return null;
    }
    try {
      return migrate(JSON.parse(raw) as unknown, scopeKey(scope));
    } catch {
      return null;
    }
  }

  save(scope: ViewScope, view: LibraryView): void {
    const stored: Stored = {
      schemaVersion: SCHEMA_VERSION,
      scopeKey: scopeKey(scope),
      filters: { genreKeys: [...view.filters.genreKeys], watchStatus: view.filters.watchStatus, year: view.filters.year },
      sort: view.sort,
    };
    this.store.set(this.key(scope), JSON.stringify(stored));
  }
}

/** Reads a stored entry, checking every field: a damaged value falls back to its default rather than reaching a query. */
export function migrate(value: unknown, expectedScope: string): LibraryView | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const v = value as Partial<Stored>;
  if (v.schemaVersion !== SCHEMA_VERSION || v.scopeKey !== expectedScope) {
    return null;
  }
  const f = (v.filters ?? {}) as Partial<FilterState>;
  const genreKeys = Array.isArray(f.genreKeys) ? f.genreKeys.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];
  const watchStatus = typeof f.watchStatus === 'string' && WATCH.includes(f.watchStatus as WatchStatus) ? (f.watchStatus as WatchStatus) : null;
  const y = f.year as { from?: unknown; to?: unknown } | null | undefined;
  const year = y && typeof y.from === 'number' && typeof y.to === 'number' ? { from: y.from, to: y.to } : null;
  const sort = typeof v.sort === 'string' && SORTS.includes(v.sort as SortPreset) ? (v.sort as SortPreset) : DEFAULT_SORT;
  return { filters: { genreKeys, watchStatus, year }, sort };
}
