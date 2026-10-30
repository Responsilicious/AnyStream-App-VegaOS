import type { GenreTile, Library, MediaItem } from './providers/types';

/** The newest titles of one library: Home shows one such row per library. */
export interface LibraryRow {
  library: Library;
  items: MediaItem[];
}

/**
 * AnyStream's own rules for what Continue Playing shows. They are the app's defaults, not Jellyfin
 * settings: Jellyfin decides when an item is resumable or counts as watched; these decide what the
 * Home row is worth showing.
 */
export const CONTINUE_RULES = {
  /** Less than this watched is a sample, not something to come back to. */
  minWatchedMs: 60 * 1000,
  /** Near finished means this much watched ... */
  nearFinishedFraction: 0.95,
  /** ... and no more than this left, for an episode ... */
  episodeRemainingMs: 3 * 60 * 1000,
  /** ... or for a movie. Both tests together protect short episodes and long films. */
  movieRemainingMs: 5 * 60 * 1000,
  /** Cards on Home; the rest wait behind View all. */
  rowLimit: 12,
  /** Entries untouched this long move to View all, with their progress kept. */
  staleAfterMs: 90 * 24 * 60 * 60 * 1000,
};

export interface ContinueSelection {
  /** The cards for Home, most recent first. */
  row: MediaItem[];
  /** Older entries and overflow: shown under View all, never dropped. */
  more: MediaItem[];
}

/**
 * Hidden entries by key (the series id for an episode, else the item id), each with the last-played time
 * it had when it was removed. It comes back as soon as something in it is played again.
 */
export type HiddenContinue = Record<string, number>;

/** What Remove from row hides: a whole series, so an older abandoned episode cannot take its place. */
export function continueKey(item: MediaItem): string {
  return item.kind === 'episode' && item.seriesId ? item.seriesId : item.id;
}

function isNearlyFinished(item: MediaItem): boolean {
  if (!item.runtimeMs || item.runtimeMs <= 0) {
    return false;
  }
  const remaining = item.runtimeMs - item.resumeMs;
  const limit = item.kind === 'episode' ? CONTINUE_RULES.episodeRemainingMs : CONTINUE_RULES.movieRemainingMs;
  return item.resumeMs / item.runtimeMs >= CONTINUE_RULES.nearFinishedFraction && remaining <= limit;
}

/**
 * Turns the server's resume list into the Continue Playing row.
 *
 * 1. Drop anything watched for less than a minute.
 * 2. One card per series: the episode played most recently (not the highest number, so a deliberate
 *    rewatch of an earlier episode wins).
 * 3. Drop series and titles the user removed, unless played again since.
 * 4. Only then drop the nearly finished ones. Doing it after step 2 matters: hiding the current episode
 *    must not bring an older, abandoned one back. Nothing is marked watched; the resume point stays.
 * 5. Most recently played first; twelve on Home, entries untouched for 90 days and any overflow go to View all.
 */
export function selectContinuePlaying(
  items: MediaItem[],
  now: number,
  hidden: HiddenContinue = {},
): ContinueSelection {
  const watched = items
    .map((item, order) => ({ item, order }))
    .filter(({ item }) => item.resumeMs >= CONTINUE_RULES.minWatchedMs);

  const newer = (a: { item: MediaItem; order: number }, b: { item: MediaItem; order: number }): boolean => {
    const at = a.item.lastPlayed ?? -Infinity;
    const bt = b.item.lastPlayed ?? -Infinity;
    return at !== bt ? at > bt : a.order < b.order;
  };

  const current = new Map<string, { item: MediaItem; order: number }>();
  for (const entry of watched) {
    const key = continueKey(entry.item);
    const best = current.get(key);
    if (!best || newer(entry, best)) {
      current.set(key, entry);
    }
  }

  const kept = [...current.entries()]
    .filter(([key, { item }]) => hidden[key] === undefined || (item.lastPlayed ?? 0) > hidden[key])
    .map(([, entry]) => entry)
    .filter(({ item }) => !isNearlyFinished(item))
    .sort((a, b) => (newer(a, b) ? -1 : 1))
    .map(({ item }) => item);

  const isStale = (item: MediaItem): boolean =>
    item.lastPlayed !== undefined && now - item.lastPlayed > CONTINUE_RULES.staleAfterMs;
  const fresh = kept.filter(item => !isStale(item));
  const stale = kept.filter(isStale);

  return {
    row: fresh.slice(0, CONTINUE_RULES.rowLimit),
    more: [...fresh.slice(CONTINUE_RULES.rowLimit), ...stale],
  };
}

/** What the Home screen shows, after the rows have been made to agree with each other. */
export interface HomeData {
  continuePlaying: MediaItem[];
  /** Continue Playing entries behind View all. */
  continueMore: MediaItem[];
  upNext: MediaItem[];
  recentlyAdded: LibraryRow[];
  genres: GenreTile[];
}

/** What the server returned, before the rules are applied. */
export interface HomeInputs {
  /** The raw resume list, not yet one per series. */
  resume: MediaItem[];
  upNext: MediaItem[];
  recentlyAdded: LibraryRow[];
  genres: GenreTile[];
  now: number;
  hidden?: HiddenContinue;
}

/**
 * Keeps each title in one place (docs/design.md section 6). A series with a card in Continue Playing gets
 * no Up Next card, so there is one choice per series; Recently Added leaves out whatever is already above.
 */
export function buildHome(input: HomeInputs): HomeData {
  const { row: continuePlaying, more: continueMore } = selectContinuePlaying(
    input.resume,
    input.now,
    input.hidden,
  );

  const resumeIds = new Set(continuePlaying.map(item => item.id));
  const resumeSeries = new Set(
    continuePlaying.map(item => item.seriesId).filter((id): id is string => !!id),
  );

  const upNext = input.upNext.filter(
    item => !resumeIds.has(item.id) && !(item.seriesId && resumeSeries.has(item.seriesId)),
  );

  const shownIds = new Set([...resumeIds, ...upNext.map(item => item.id)]);
  const shownSeries = new Set(
    [...continuePlaying, ...upNext].map(item => item.seriesId).filter((id): id is string => !!id),
  );
  // Each library row drops what is already shown above it (including earlier library rows), and a row left
  // with nothing disappears.
  const recentlyAdded: LibraryRow[] = [];
  for (const row of input.recentlyAdded) {
    const items = row.items.filter(
      item => !shownIds.has(item.id) && !(item.kind === 'series' && shownSeries.has(item.id)),
    );
    items.forEach(item => shownIds.add(item.id));
    if (items.length > 0) {
      recentlyAdded.push({ library: row.library, items });
    }
  }

  return { continuePlaying, continueMore, upNext, recentlyAdded, genres: input.genres };
}

/** The title that opens the Featured preview before anything is focused: where you left off, else what is next. */
export function initialFeatured(home: HomeData): MediaItem | undefined {
  return home.continuePlaying[0] ?? home.upNext[0] ?? home.recentlyAdded[0]?.items[0];
}

export function isEmpty(home: HomeData): boolean {
  return (
    home.continuePlaying.length === 0 &&
    home.continueMore.length === 0 &&
    home.upNext.length === 0 &&
    home.recentlyAdded.length === 0 &&
    home.genres.length === 0
  );
}

export type CardAction = 'resume' | 'play-from-start' | 'details' | 'mark-watched' | 'remove-from-row';

/**
 * What the card menu offers. Resume and Start again need a resume point, Mark watched needs something
 * unwatched, and Remove from row only exists on Continue Playing cards (docs/design.md section 5).
 */
export function cardActions(item: MediaItem, inContinueRow = false): CardAction[] {
  const actions: CardAction[] = [];
  if (item.resumeMs > 0) {
    actions.push('resume', 'play-from-start');
  }
  actions.push('details');
  if (!item.played) {
    actions.push('mark-watched');
  }
  if (inContinueRow) {
    actions.push('remove-from-row');
  }
  return actions;
}
