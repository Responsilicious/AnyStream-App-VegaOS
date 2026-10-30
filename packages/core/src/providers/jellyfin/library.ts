import type { Library, LibraryCapabilities, LibraryFacets, LibraryPage, LibraryView, MediaItem, SortPreset } from '../types';
import type { QueryValue } from '../../util/url';
import type { JellyfinHttp } from './http';
import { mapItem, type JellyfinItem } from './items';

/**
 * Jellyfin mapping for the Movies and Series filters (docs/library-filters.md). Every field used here is part of
 * the long-standing /Users/{id}/Items query, so the set does not depend on the server version.
 */

const MOVIE_SORTS: SortPreset[] = ['titleAsc', 'titleDesc', 'addedDesc', 'releaseDesc', 'releaseAsc', 'ratingDesc', 'runtimeAsc', 'runtimeDesc'];
const SERIES_SORTS: SortPreset[] = ['titleAsc', 'titleDesc', 'addedDesc', 'firstAiredDesc', 'firstAiredAsc', 'ratingDesc'];

export function jellyfinLibraryCapabilities(library: Library): LibraryCapabilities {
  const series = library.kind === 'tvshows';
  return {
    genres: true,
    years: true,
    // A series counts as played only when all of its episodes are, so IsPlayed answers both series states. Jellyfin
    // has no server-side "started" filter for a series, so Not started / In progress are left out rather than guessed.
    watchStatuses: series ? ['hasUnwatched', 'completed'] : ['unwatched', 'inProgress', 'watched'],
    sorts: series ? SERIES_SORTS : MOVIE_SORTS,
    // TotalRecordCount is exact for the same query with Limit=0.
    exactCounts: true,
  };
}

/** SortBy field and direction. Ties fall back to the sort title, so pages stay in a stable order. */
const SORT_FIELDS: Record<SortPreset, [string, 'Ascending' | 'Descending']> = {
  titleAsc: ['SortName', 'Ascending'],
  titleDesc: ['SortName', 'Descending'],
  // DateCreated is when the movie or series itself entered the library, not its newest episode.
  addedDesc: ['DateCreated', 'Descending'],
  releaseDesc: ['PremiereDate', 'Descending'],
  releaseAsc: ['PremiereDate', 'Ascending'],
  firstAiredDesc: ['PremiereDate', 'Descending'],
  firstAiredAsc: ['PremiereDate', 'Ascending'],
  ratingDesc: ['CommunityRating', 'Descending'],
  runtimeAsc: ['Runtime', 'Ascending'],
  runtimeDesc: ['Runtime', 'Descending'],
};

function years(from: number, to: number): number[] {
  const list: number[] = [];
  for (let y = Math.min(from, to); y <= Math.max(from, to); y++) {
    list.push(y);
  }
  return list;
}

/** The /Users/{id}/Items parameters for one view. Exported for tests. */
export function jellyfinViewQuery(library: Library, view: LibraryView): Record<string, QueryValue> {
  const { filters } = view;
  const [field, order] = SORT_FIELDS[view.sort];
  const query: Record<string, QueryValue> = {
    ParentId: library.id,
    Recursive: true,
    IncludeItemTypes: library.kind === 'tvshows' ? 'Series' : 'Movie',
    SortBy: field === 'SortName' ? 'SortName' : `${field},SortName`,
    SortOrder: field === 'SortName' ? order : `${order},Ascending`,
  };
  if (filters.genreKeys.length > 0) {
    // GenreIds matches titles in any of the genres.
    query.GenreIds = [...filters.genreKeys].sort().join('|');
  }
  if (filters.year) {
    // Years matches ProductionYear: the release year of a movie, the first-aired year of a series.
    query.Years = years(filters.year.from, filters.year.to);
  }
  switch (filters.watchStatus) {
    case 'unwatched':
    case 'hasUnwatched':
      query.IsPlayed = false;
      break;
    case 'watched':
    case 'completed':
      query.IsPlayed = true;
      break;
    case 'inProgress':
      query.Filters = 'IsResumable';
      break;
    default:
      break;
  }
  return query;
}

export async function fetchLibraryFacets(http: JellyfinHttp, userId: string, library: Library, signal?: AbortSignal): Promise<LibraryFacets> {
  const response = await http.get<{ Items: Array<{ Id: string; Name: string }> }>('/Genres', {
    query: {
      UserId: userId,
      ParentId: library.id,
      IncludeItemTypes: library.kind === 'tvshows' ? 'Series' : 'Movie',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      EnableTotalRecordCount: false,
    },
    signal,
  });
  return { genres: (response.Items ?? []).filter(g => g.Id && g.Name).map(g => ({ key: g.Id, label: g.Name })) };
}

export async function queryJellyfinLibrary(
  http: JellyfinHttp,
  userId: string,
  library: Library,
  view: LibraryView,
  start: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage<MediaItem>> {
  const response = await http.get<{ Items: JellyfinItem[]; TotalRecordCount?: number }>(`/Users/${userId}/Items`, {
    query: {
      ...jellyfinViewQuery(library, view),
      Fields: 'Overview,ProductionYear,RunTimeTicks',
      EnableImageTypes: 'Primary,Backdrop',
      ImageTypeLimit: 1,
      StartIndex: start,
      Limit: limit,
    },
    signal,
  });
  return {
    items: (response.Items ?? []).map(raw => mapItem(http.baseUrl, raw)),
    total: typeof response.TotalRecordCount === 'number' ? response.TotalRecordCount : null,
  };
}

export async function countJellyfinLibrary(
  http: JellyfinHttp,
  userId: string,
  library: Library,
  view: LibraryView,
  signal?: AbortSignal,
): Promise<number | null> {
  const response = await http.get<{ TotalRecordCount?: number }>(`/Users/${userId}/Items`, {
    query: { ...jellyfinViewQuery(library, view), Limit: 0, EnableImages: false, EnableUserData: false },
    signal,
  });
  return typeof response.TotalRecordCount === 'number' ? response.TotalRecordCount : null;
}
