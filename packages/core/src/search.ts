import type { KindFilter } from './providers/types';

/** Keys of the on-screen keyboard, six to a row: A to Z, then 1 to 0 (docs/design/search-mockup.png). */
export const KEY_ROWS: string[][] = [
  ['A', 'B', 'C', 'D', 'E', 'F'],
  ['G', 'H', 'I', 'J', 'K', 'L'],
  ['M', 'N', 'O', 'P', 'Q', 'R'],
  ['S', 'T', 'U', 'V', 'W', 'X'],
  ['Y', 'Z', '1', '2', '3', '4'],
  ['5', '6', '7', '8', '9', '0'],
];

export type EditKey = 'space' | 'delete' | 'clear';

/** Longest query the keyboard builds; past this a key press changes nothing. */
export const MAX_QUERY = 40;

/** How long typing must pause before a search runs, so each key press does not hit the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Adds one character. Lower case, because a search is not case sensitive and it reads better in the box. */
export function typeKey(query: string, key: string): string {
  if (query.length >= MAX_QUERY) {
    return query;
  }
  return query + key.toLowerCase();
}

/** Space, Delete and Clear. A space never leads the query or doubles up. */
export function editQuery(query: string, key: EditKey): string {
  switch (key) {
    case 'space':
      return query.length === 0 || query.endsWith(' ') || query.length >= MAX_QUERY ? query : `${query} `;
    case 'delete':
      return query.slice(0, -1);
    case 'clear':
      return '';
  }
}

export const KIND_FILTERS: Array<{ filter: KindFilter; label: string }> = [
  { filter: 'all', label: 'All' },
  { filter: 'movies', label: 'Movies' },
  { filter: 'series', label: 'Series' },
  { filter: 'episodes', label: 'Episodes' },
];

/** The Genres screen chips: which kinds of title the reels show. Episodes do not belong in a genre reel. */
export const GENRE_FILTERS: Array<{ filter: KindFilter; label: string }> = [
  { filter: 'all', label: 'All libraries' },
  { filter: 'movies', label: 'Movies' },
  { filter: 'series', label: 'Series' },
];
