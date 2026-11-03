import type { MediaItem, StartChoice } from './providers/types';

/** The top-level places in the top bar. */
export type Section = 'home' | 'movies' | 'series' | 'genres' | 'collections' | 'search' | 'profile';

/** Where the user is. The stack's last entry is the visible screen; Back pops it. */
export type Route =
  | { name: 'library'; section: Section }
  | { name: 'detail'; item: MediaItem }
  | {
      name: 'series';
      item: MediaItem;
      /** The episode to open selected, when the card stood for one. */
      episodeId?: string;
      /** The season to open on, when the card stood for a season (a collection member). */
      season?: number;
    }
  /**
   * A collection's page. `loop` is set when this collection is already open further back on the same path (it
   * contains itself, directly or through another): the page explains instead of loading it again.
   */
  | { name: 'collection'; item: MediaItem; loop?: boolean }
  | { name: 'genre'; genre: string }
  | { name: 'continue' }
  | { name: 'player'; item: MediaItem; /** Version and tracks chosen on the title page. */ choice?: StartChoice };

export type RouteStack = Route[];

export const HOME: RouteStack = [{ name: 'library', section: 'home' }];

export function currentRoute(stack: RouteStack): Route {
  return stack[stack.length - 1] ?? { name: 'library', section: 'home' };
}

/** A top bar entry was chosen. Only applies while a top-level screen is showing. */
export function selectSection(stack: RouteStack, section: Section): RouteStack {
  const route = currentRoute(stack);
  if (route.name !== 'library') {
    return stack;
  }
  return [...stack.slice(0, -1), { name: 'library', section }];
}

/**
 * A card was chosen. Every movie, series or episode card opens its title page and never plays
 * (docs/title-pages.md). An episode opens its series with that episode selected.
 */
export function openItem(stack: RouteStack, item: MediaItem): RouteStack {
  if (item.kind === 'collection') {
    return openCollection(stack, item);
  }
  if (item.kind === 'episode' && item.seriesId) {
    const series: MediaItem = {
      id: item.seriesId,
      title: item.seriesTitle ?? item.title,
      kind: 'series',
      resumeMs: 0,
      played: false,
    };
    return [...stack, { name: 'series', item: series, episodeId: item.id }];
  }
  const name = item.kind === 'series' || item.kind === 'season' ? 'series' : 'detail';
  return [...stack, { name, item }];
}

/**
 * A collection card was chosen. Opening one never plays. A collection already open lower on the stack is a loop on
 * the server: it opens a page that says so, so Back still leads out and nothing recurses.
 */
export function openCollection(stack: RouteStack, item: MediaItem): RouteStack {
  const loop = stack.some(r => r.name === 'collection' && r.item.id === item.id);
  return [...stack, loop ? { name: 'collection', item, loop: true } : { name: 'collection', item }];
}

/** A series page opened for one episode or one season of it (a collection member). */
export function openSeries(stack: RouteStack, series: MediaItem, entry: { episodeId?: string; season?: number } = {}): RouteStack {
  const route: Route = { name: 'series', item: series };
  if (entry.episodeId) {
    route.episodeId = entry.episodeId;
  } else if (entry.season !== undefined) {
    route.season = entry.season;
  }
  return [...stack, route];
}

/** The collections open on the way to the current page, outermost first, for the breadcrumb. */
export function collectionTrail(stack: RouteStack): MediaItem[] {
  return stack.filter((r): r is Extract<Route, { name: 'collection' }> => r.name === 'collection').map(r => r.item);
}

/** A genre tile was chosen: its titles open on their own screen. */
export function openGenre(stack: RouteStack, genre: string): RouteStack {
  return [...stack, { name: 'genre', genre }];
}

/** View all on Continue Playing: every entry, including the older ones. */
export function openContinue(stack: RouteStack): RouteStack {
  return [...stack, { name: 'continue' }];
}

/**
 * Starts playback. From a series page the episode played becomes the page's selected episode, so Back lands
 * on it with its progress refreshed instead of on whichever episode the page opened with.
 */
export function playItem(stack: RouteStack, item: MediaItem, choice?: StartChoice): RouteStack {
  const top = currentRoute(stack);
  const base =
    top.name === 'series' && item.kind === 'episode'
      ? [...stack.slice(0, -1), { ...top, episodeId: item.id }]
      : stack;
  return [...base, choice ? { name: 'player', item, choice } : { name: 'player', item }];
}

/** A top bar entry was chosen while a title page is showing: back to that section, dropping the pages. */
export function goToSection(section: Section): RouteStack {
  return [{ name: 'library', section }];
}

const SECTION_LABELS: Record<Section, string> = {
  home: 'Home',
  movies: 'Movies',
  series: 'Series',
  genres: 'Genres',
  collections: 'Collections',
  search: 'Search',
  profile: 'Profile',
};

/** Which top bar entry to light up: the section the user started from, however deep they are. */
export function activeSection(stack: RouteStack): Section {
  const base = stack[0];
  return base && base.name === 'library' ? base.section : 'home';
}

/** "Back to Movies": names the screen below the current one on the stack. */
export function backLabel(stack: RouteStack): string {
  const previous = stack[stack.length - 2];
  if (!previous) {
    return 'Back';
  }
  switch (previous.name) {
    case 'library':
      return `Back to ${SECTION_LABELS[previous.section]}`;
    case 'genre':
      return `Back to ${previous.genre}`;
    case 'continue':
      return 'Back to Continue Playing';
    case 'series':
    case 'detail':
    case 'collection':
      return `Back to ${previous.item.title}`;
    default:
      return 'Back';
  }
}

/**
 * Pops one screen. On a top-level screen other than Home, Back goes Home first; on Home it changes
 * nothing, so the caller can let the platform leave the app.
 */
export function goBack(stack: RouteStack): RouteStack {
  if (stack.length > 1) {
    return stack.slice(0, -1);
  }
  const route = currentRoute(stack);
  if (route.name === 'library' && route.section !== 'home') {
    return HOME;
  }
  return stack;
}

/** True when Back would do something inside the app (so the handler should claim the key). */
export function canGoBack(stack: RouteStack): boolean {
  return goBack(stack) !== stack;
}
