import type {
  FilterState,
  GenreFacet,
  LibraryCapabilities,
  LibraryFacets,
  LibraryView,
  SortPreset,
  WatchStatus,
  YearRange,
} from '../providers/types';

/**
 * The Movies and Series pages' filter and sort state (docs/library-filters.md): defaults, labels, chips and
 * validation against what the server supports. Pure, so it is unit-tested; the drawer and the page only render it.
 */

export type MediaPage = 'movies' | 'series';

export const DEFAULT_SORT: SortPreset = 'titleAsc';

export const EMPTY_FILTERS: FilterState = { genreKeys: [], watchStatus: null, year: null };

export const DEFAULT_VIEW: LibraryView = { filters: EMPTY_FILTERS, sort: DEFAULT_SORT };

const SORT_LABELS: Record<SortPreset, string> = {
  titleAsc: 'Title A–Z',
  titleDesc: 'Title Z–A',
  addedDesc: 'Recently added',
  releaseDesc: 'Release date: newest',
  releaseAsc: 'Release date: oldest',
  firstAiredDesc: 'First aired: newest',
  firstAiredAsc: 'First aired: oldest',
  ratingDesc: 'Community rating: highest',
  runtimeAsc: 'Runtime: shortest',
  runtimeDesc: 'Runtime: longest',
};

export function sortLabel(sort: SortPreset): string {
  return SORT_LABELS[sort];
}

/** Help under each sort row, so the meaning is never a guess. */
export function sortHelp(sort: SortPreset, page: MediaPage): string | undefined {
  switch (sort) {
    case 'addedDesc':
      return page === 'series' ? 'When the series itself was added, not its newest episode' : 'Newest to your library first';
    default:
      return undefined;
  }
}

const WATCH_LABELS: Record<WatchStatus, string> = {
  unwatched: 'Unwatched',
  inProgress: 'In progress',
  watched: 'Watched',
  hasUnwatched: 'Has unwatched episodes',
  completed: 'Completed',
};

export function watchLabel(status: WatchStatus | null): string {
  return status ? WATCH_LABELS[status] : 'Any';
}

export function watchHelp(status: WatchStatus): string | undefined {
  switch (status) {
    case 'unwatched':
      return "Not watched to the end, including ones you've started";
    case 'hasUnwatched':
      return 'At least one available episode you have not watched';
    case 'completed':
      return 'Every available episode watched';
    default:
      return undefined;
  }
}

export function pageNoun(page: MediaPage, count?: number): string {
  if (page === 'series') {
    return 'series';
  }
  return count === 1 ? 'movie' : 'movies';
}

export function yearFieldLabel(page: MediaPage): string {
  return page === 'series' ? 'First aired' : 'Release year';
}

export interface YearPreset {
  id: string;
  label: string;
  range: YearRange;
}

/** Year choices: recent spans, then decades. A simple list is far quicker with a remote than two number pickers. */
export function yearPresets(currentYear: number): YearPreset[] {
  const presets: YearPreset[] = [
    { id: 'this', label: `This year (${currentYear})`, range: { from: currentYear, to: currentYear } },
    { id: 'last5', label: `Last 5 years (${currentYear - 4}–${currentYear})`, range: { from: currentYear - 4, to: currentYear } },
  ];
  const thisDecade = Math.floor(currentYear / 10) * 10;
  for (let decade = thisDecade; decade >= 1950; decade -= 10) {
    presets.push({ id: `d${decade}`, label: `${decade}s`, range: { from: decade, to: Math.min(decade + 9, currentYear) } });
  }
  presets.push({ id: 'pre1950', label: 'Before 1950', range: { from: 1900, to: 1949 } });
  return presets;
}

export function yearLabel(range: YearRange | null): string {
  if (!range) {
    return 'Any';
  }
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  if (from === to) {
    return String(from);
  }
  if (from % 10 === 0 && to - from === 9) {
    return `${from}s`;
  }
  if (from === 1900 && to === 1949) {
    return 'Before 1950';
  }
  return `${from}–${to}`;
}

export function genreLabel(keys: string[], facets: LibraryFacets | null): string {
  if (keys.length === 0) {
    return 'Any genre';
  }
  const names = keys.map(k => facetLabel(k, facets));
  return names.length <= 2 ? names.join(', ') : `${names[0]}, ${names[1]} +${names.length - 2}`;
}

function facetLabel(key: string, facets: LibraryFacets | null): string {
  return facets?.genres.find(g => g.key === key)?.label ?? 'Unknown genre';
}

export function sameFilters(a: FilterState, b: FilterState): boolean {
  return canonicalFilters(a) === canonicalFilters(b);
}

export function sameView(a: LibraryView, b: LibraryView): boolean {
  return canonicalKey(a) === canonicalKey(b);
}

function canonicalFilters(f: FilterState): string {
  const genres = [...new Set(f.genreKeys)].sort().join('|');
  const year = f.year ? `${Math.min(f.year.from, f.year.to)}-${Math.max(f.year.from, f.year.to)}` : '';
  return `g=${genres};w=${f.watchStatus ?? ''};y=${year}`;
}

/** One string per distinct query: genre order does not matter. Used to match responses and cached pages to a view. */
export function canonicalKey(view: LibraryView): string {
  return `${canonicalFilters(view.filters)};s=${view.sort}`;
}

/** How many filter groups are set: several genres still count as one. */
export function activeFilterCount(filters: FilterState): number {
  return (filters.genreKeys.length > 0 ? 1 : 0) + (filters.watchStatus ? 1 : 0) + (filters.year ? 1 : 0);
}

export type ChipTarget = { group: 'genre'; key: string } | { group: 'watch' } | { group: 'year' };

export interface FilterChip {
  id: string;
  label: string;
  /** What a screen reader says for the chip's remove action. */
  removeLabel: string;
  target: ChipTarget;
}

/** One removable chip per genre, plus one for watch status and one for the year. */
export function filterChips(filters: FilterState, facets: LibraryFacets | null, page: MediaPage): FilterChip[] {
  const chips: FilterChip[] = filters.genreKeys.map(key => {
    const label = facetLabel(key, facets);
    return { id: `genre:${key}`, label, removeLabel: `Remove genre ${label}`, target: { group: 'genre', key } };
  });
  if (filters.watchStatus) {
    const label = WATCH_LABELS[filters.watchStatus];
    chips.push({ id: 'watch', label, removeLabel: `Remove watch status ${label}`, target: { group: 'watch' } });
  }
  if (filters.year) {
    const label = yearLabel(filters.year);
    chips.push({ id: 'year', label, removeLabel: `Remove ${yearFieldLabel(page).toLowerCase()} ${label}`, target: { group: 'year' } });
  }
  return chips;
}

export function removeChip(filters: FilterState, target: ChipTarget): FilterState {
  switch (target.group) {
    case 'genre':
      return { ...filters, genreKeys: filters.genreKeys.filter(k => k !== target.key) };
    case 'watch':
      return { ...filters, watchStatus: null };
    case 'year':
      return { ...filters, year: null };
  }
}

export function toggleGenre(filters: FilterState, key: string): FilterState {
  const has = filters.genreKeys.includes(key);
  return { ...filters, genreKeys: has ? filters.genreKeys.filter(k => k !== key) : [...filters.genreKeys, key] };
}

/** The watch choices a page offers, in display order, limited to what the server supports. */
export function watchOptions(page: MediaPage, caps: LibraryCapabilities): WatchStatus[] {
  const order: WatchStatus[] = page === 'series' ? ['hasUnwatched', 'completed'] : ['unwatched', 'inProgress', 'watched'];
  return order.filter(s => caps.watchStatuses.includes(s));
}

const PAGE_SORTS: Record<MediaPage, SortPreset[]> = {
  movies: ['titleAsc', 'titleDesc', 'addedDesc', 'releaseDesc', 'releaseAsc', 'ratingDesc', 'runtimeAsc', 'runtimeDesc'],
  series: ['titleAsc', 'titleDesc', 'addedDesc', 'firstAiredDesc', 'firstAiredAsc', 'ratingDesc'],
};

/** Sort rows for a page. Runtime never appears on Series; release date and first aired never swap pages. */
export function sortOptions(page: MediaPage, caps: LibraryCapabilities): SortPreset[] {
  return PAGE_SORTS[page].filter(s => caps.sorts.includes(s));
}

export interface Validation {
  view: LibraryView;
  /** Plain words for each saved choice that had to be dropped. Empty when nothing changed. */
  notices: string[];
}

/**
 * Checks a (usually restored) view against what this library supports now. Anything unavailable is removed
 * and named, never left looking active while the query ignores it. A valid choice that matches nothing stays.
 */
export function validateView(view: LibraryView, page: MediaPage, caps: LibraryCapabilities, facets: LibraryFacets | null): Validation {
  const notices: string[] = [];
  const filters: FilterState = { genreKeys: [...new Set(view.filters.genreKeys)], watchStatus: view.filters.watchStatus, year: view.filters.year };

  if (filters.genreKeys.length > 0) {
    if (!caps.genres) {
      notices.push('Genre filters are not available on this server.');
      filters.genreKeys = [];
    } else if (facets) {
      const known = filters.genreKeys.filter(k => facets.genres.some((g: GenreFacet) => g.key === k));
      if (known.length < filters.genreKeys.length) {
        notices.push(known.length === 0 ? 'Your saved genres are no longer in this library.' : 'Some saved genres are no longer in this library.');
      }
      filters.genreKeys = known;
    }
  }
  if (filters.watchStatus && !watchOptions(page, caps).includes(filters.watchStatus)) {
    notices.push(`"${WATCH_LABELS[filters.watchStatus]}" is not available here.`);
    filters.watchStatus = null;
  }
  if (filters.year) {
    const { from, to } = filters.year;
    if (!caps.years) {
      notices.push('Year filters are not available on this server.');
      filters.year = null;
    } else if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1800 || to > 3000) {
      notices.push('Your saved year range was not valid.');
      filters.year = null;
    }
  }
  let sort = view.sort;
  if (!sortOptions(page, caps).includes(sort)) {
    if (sort !== DEFAULT_SORT) {
      notices.push(`Sorting by "${SORT_LABELS[sort] ?? sort}" is not available here, so titles are A–Z.`);
    }
    sort = DEFAULT_SORT;
  }
  return { view: { filters, sort }, notices };
}

/**
 * The drawer's main button. A count appears only when the server gave an exact count for this draft;
 * a page length or the current results' count would be a lie.
 */
export function applyLabel(draft: LibraryView, applied: LibraryView, page: MediaPage, draftCount: number | null): string {
  const filtersChanged = !sameFilters(draft.filters, applied.filters);
  const sortChanged = draft.sort !== applied.sort;
  if (!filtersChanged && sortChanged) {
    return 'Apply sorting';
  }
  if (draftCount !== null) {
    return `Show ${draftCount} ${pageNoun(page, draftCount)}`;
  }
  return filtersChanged && sortChanged ? 'Show results' : `Show ${pageNoun(page)}`;
}

/** Summary for the zero-results screen: every applied choice, in words. */
export function filterSummary(filters: FilterState, facets: LibraryFacets | null, page: MediaPage): string {
  return filterChips(filters, facets, page)
    .map(c => c.label)
    .join(' · ');
}
