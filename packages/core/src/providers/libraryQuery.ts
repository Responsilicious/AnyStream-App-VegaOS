/**
 * Semantic filters and sort orders for the Movies and Series pages (docs/library-filters.md). The UI only ever
 * deals in these values; each provider turns them into its own query parameters and says which it can honour.
 */

/** Single-select watch states. Movies and series have different meanings, so each page offers its own set. */
export type WatchStatus =
  /** Movie not marked watched (started ones included). */
  | 'unwatched'
  /** Movie with a resume point. */
  | 'inProgress'
  /** Movie marked watched. */
  | 'watched'
  /** Series with at least one available episode this viewer has not watched. */
  | 'hasUnwatched'
  /** Series whose available episodes this viewer has all watched (not "the show has ended"). */
  | 'completed';

export type SortPreset =
  | 'titleAsc'
  | 'titleDesc'
  | 'addedDesc'
  | 'releaseDesc'
  | 'releaseAsc'
  | 'firstAiredDesc'
  | 'firstAiredAsc'
  | 'ratingDesc'
  | 'runtimeAsc'
  | 'runtimeDesc';

export interface YearRange {
  from: number;
  to: number;
}

export interface FilterState {
  /** Opaque provider genre ids, never display names. Several match any of them (OR). */
  genreKeys: string[];
  watchStatus: WatchStatus | null;
  /** Inclusive. Release year for movies, first-aired year for series. */
  year: YearRange | null;
}

export interface LibraryView {
  filters: FilterState;
  sort: SortPreset;
}

/** What one library on one server can filter and sort by, with meanings the provider has checked. */
export interface LibraryCapabilities {
  genres: boolean;
  years: boolean;
  watchStatuses: WatchStatus[];
  sorts: SortPreset[];
  /** The server can say exactly how many titles a filter matches before they are loaded. */
  exactCounts: boolean;
}

export interface GenreFacet {
  key: string;
  label: string;
}

export interface LibraryFacets {
  genres: GenreFacet[];
}

export interface LibraryPage<T> {
  items: T[];
  /** The exact number of matching titles, or null when the server does not say. */
  total: number | null;
}
