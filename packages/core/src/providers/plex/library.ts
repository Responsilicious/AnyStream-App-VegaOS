import type { Library, LibraryCapabilities, LibraryFacets, LibraryPage, LibraryView, MediaItem, SortPreset, WatchStatus } from '../types';
import type { QueryValue } from '../../util/url';
import type { PlexHttp } from './http';
import { mapPlexItem, type PlexMetadata } from './items';

/**
 * Plex mapping for the Movies and Series filters (docs/library-filters.md). Plex describes, per library and type,
 * which filters and sorts it accepts (`includeMeta=1`), so the app offers only what this server advertises.
 */

interface MetaFilter {
  filter?: string;
}
interface MetaSort {
  key?: string;
}
interface MetaType {
  type?: string;
  Filter?: MetaFilter[];
  Sort?: MetaSort[];
  Field?: Array<{ key?: string }>;
}
interface Container<T> {
  MediaContainer?: T & { size?: number; totalSize?: number };
}

const TYPE_ID = { movies: 1, tvshows: 2 } as const;

function typeId(library: Library): number {
  return library.kind === 'tvshows' ? TYPE_ID.tvshows : TYPE_ID.movies;
}

/** Plex sort key for each order, with the direction. Ties fall back to the sort title. */
const SORT_KEYS: Record<SortPreset, [string, '' | ':desc']> = {
  titleAsc: ['titleSort', ''],
  titleDesc: ['titleSort', ':desc'],
  // The show's (or movie's) own date added, not "Last Episode Date Added".
  addedDesc: ['addedAt', ':desc'],
  releaseDesc: ['originallyAvailableAt', ':desc'],
  releaseAsc: ['originallyAvailableAt', ''],
  firstAiredDesc: ['originallyAvailableAt', ':desc'],
  firstAiredAsc: ['originallyAvailableAt', ''],
  // Audience rating only: mixing it with critic ratings would not be comparable.
  ratingDesc: ['audienceRating', ':desc'],
  runtimeAsc: ['duration', ''],
  runtimeDesc: ['duration', ':desc'],
};

const MOVIE_SORTS: SortPreset[] = ['titleAsc', 'titleDesc', 'addedDesc', 'releaseDesc', 'releaseAsc', 'ratingDesc', 'runtimeAsc', 'runtimeDesc'];
const SERIES_SORTS: SortPreset[] = ['titleAsc', 'titleDesc', 'addedDesc', 'firstAiredDesc', 'firstAiredAsc', 'ratingDesc'];

/** When a server gives no description: only what the app already used before filters existed. */
const FALLBACK_SORTS: SortPreset[] = ['titleAsc', 'titleDesc', 'addedDesc'];

/** Turns the server's advertised filters and sorts into the app's options. Exported for tests. */
export function plexCapabilitiesFromMeta(library: Library, types: MetaType[] | undefined): LibraryCapabilities {
  const series = library.kind === 'tvshows';
  const wanted = series ? 'show' : 'movie';
  const meta = types?.find(t => t.type === wanted);
  if (!meta) {
    return { genres: true, years: false, watchStatuses: [], sorts: FALLBACK_SORTS, exactCounts: true };
  }
  const filters = new Set((meta.Filter ?? []).map(f => f.filter).filter((f): f is string => !!f));
  const sortKeys = new Set((meta.Sort ?? []).map(s => s.key).filter((k): k is string => !!k));
  const fields = new Set((meta.Field ?? []).map(f => f.key?.split('.').pop()).filter((k): k is string => !!k));
  const watchStatuses: WatchStatus[] = [];
  if (series) {
    if (filters.has('unwatchedLeaves') || filters.has('unwatched')) {
      watchStatuses.push('hasUnwatched');
    }
    // Only "no unwatched episodes left" means completed; a plain unwatched=0 on shows is not documented to mean that.
    if (filters.has('unwatchedLeaves')) {
      watchStatuses.push('completed');
    }
  } else {
    if (filters.has('unwatched')) {
      watchStatuses.push('unwatched');
    }
    if (filters.has('inProgress')) {
      watchStatuses.push('inProgress');
    }
    if (filters.has('unwatched')) {
      watchStatuses.push('watched');
    }
  }
  const sorts = (series ? SERIES_SORTS : MOVIE_SORTS).filter(s => sortKeys.has(SORT_KEYS[s][0]));
  return {
    genres: filters.has('genre'),
    years: filters.has('year') || fields.has('year'),
    watchStatuses,
    sorts: sorts.length > 0 ? sorts : FALLBACK_SORTS,
    exactCounts: true,
  };
}

export async function fetchPlexCapabilities(http: PlexHttp, library: Library, signal?: AbortSignal): Promise<LibraryCapabilities> {
  const response = await http.get<Container<{ Meta?: { Type?: MetaType[] } }>>(`/library/sections/${library.id}/all`, {
    query: { type: typeId(library), includeMeta: 1, 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 },
    signal,
  });
  return plexCapabilitiesFromMeta(library, response?.MediaContainer?.Meta?.Type);
}

/** The /library/sections/{id}/all parameters for one view. Exported for tests. */
export function plexViewQuery(library: Library, view: LibraryView): Record<string, QueryValue> {
  const { filters } = view;
  const series = library.kind === 'tvshows';
  const [key, direction] = SORT_KEYS[view.sort];
  const query: Record<string, QueryValue> = {
    type: typeId(library),
    sort: key === 'titleSort' ? `titleSort${direction}` : `${key}${direction},titleSort`,
  };
  if (filters.genreKeys.length > 0) {
    // Comma-separated values of one filter match any of them.
    query.genre = [...filters.genreKeys].sort().join(',');
  }
  if (filters.year) {
    // Encoded as `year%3E%3E=2020`, which Plex reads as `year >= 2020` (the operator travels in the key).
    query['year>>'] = Math.min(filters.year.from, filters.year.to);
    query['year<<'] = Math.max(filters.year.from, filters.year.to);
  }
  switch (filters.watchStatus) {
    case 'unwatched':
      query.unwatched = 1;
      break;
    case 'watched':
      query.unwatched = 0;
      break;
    case 'inProgress':
      query.inProgress = 1;
      break;
    case 'hasUnwatched':
      query[series ? 'unwatchedLeaves' : 'unwatched'] = 1;
      break;
    case 'completed':
      query.unwatchedLeaves = 0;
      break;
    default:
      break;
  }
  return query;
}

export async function fetchPlexFacets(http: PlexHttp, library: Library, signal?: AbortSignal): Promise<LibraryFacets> {
  const response = await http.get<Container<{ Directory?: Array<{ key?: string; title?: string }> }>>(
    `/library/sections/${library.id}/genre`,
    { query: { type: typeId(library) }, signal },
  );
  return {
    genres: (response?.MediaContainer?.Directory ?? [])
      .filter(d => d.key && d.title)
      .map(d => ({ key: d.key as string, label: d.title as string })),
  };
}

export async function queryPlexLibrary(
  http: PlexHttp,
  library: Library,
  view: LibraryView,
  start: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage<MediaItem>> {
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/sections/${library.id}/all`, {
    query: { ...plexViewQuery(library, view), 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit },
    signal,
  });
  const items = (response?.MediaContainer?.Metadata ?? []).map(raw => mapPlexItem(http, raw));
  const total = response?.MediaContainer?.totalSize;
  return { items, total: typeof total === 'number' ? total : null };
}

export async function countPlexLibrary(http: PlexHttp, library: Library, view: LibraryView, signal?: AbortSignal): Promise<number | null> {
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/sections/${library.id}/all`, {
    query: { ...plexViewQuery(library, view), 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 },
    signal,
  });
  const total = response?.MediaContainer?.totalSize;
  return typeof total === 'number' ? total : null;
}
