import { BrowseController, type BrowseSource, type Timers } from '../src/library/browseController';
import { LibraryPrefsStore, migrate, scopeKey, type ViewScope } from '../src/library/prefsStore';
import {
  activeFilterCount,
  applyLabel,
  canonicalKey,
  DEFAULT_VIEW,
  EMPTY_FILTERS,
  filterChips,
  removeChip,
  sortOptions,
  toggleGenre,
  validateView,
  watchOptions,
  yearLabel,
  yearPresets,
} from '../src/library/viewState';
import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import { createJellyfinProvider } from '../src/providers/jellyfin';
import { jellyfinLibraryCapabilities, jellyfinViewQuery } from '../src/providers/jellyfin/library';
import { createPlexProvider } from '../src/providers/plex';
import { plexCapabilitiesFromMeta, plexViewQuery } from '../src/providers/plex/library';
import type { Library, LibraryCapabilities, LibraryFacets, LibraryPage, LibraryView, Session } from '../src/providers/types';
import { MemoryStore } from '../src/storage/keyValueStore';
import { DEVICE, SESSION, fakeFetch } from './helpers/fakes';

const MOVIES: Library = { id: 'lib-m', name: 'Movies', kind: 'movies' };
const SHOWS: Library = { id: 'lib-s', name: 'TV', kind: 'tvshows' };
const FACETS: LibraryFacets = {
  genres: [
    { key: 'g-scifi', label: 'Sci-Fi & Fantasy' },
    { key: 'g-drama', label: 'Drama' },
    { key: 'g-comedy', label: 'Comedy' },
  ],
};
const ALL_CAPS: LibraryCapabilities = jellyfinLibraryCapabilities(MOVIES);

function view(partial: Partial<LibraryView['filters']> = {}, sort: LibraryView['sort'] = 'titleAsc'): LibraryView {
  return { filters: { ...EMPTY_FILTERS, ...partial }, sort };
}

describe('view state', () => {
  it('counts filter groups, not genres', () => {
    expect(activeFilterCount(view({ genreKeys: ['a', 'b', 'c'] }).filters)).toBe(1);
    expect(activeFilterCount(view({ genreKeys: ['a'], watchStatus: 'unwatched', year: { from: 2020, to: 2026 } }).filters)).toBe(3);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('gives one removable chip per genre with full spoken labels', () => {
    const filters = view({ genreKeys: ['g-scifi', 'g-drama'], watchStatus: 'unwatched', year: { from: 2020, to: 2026 } }).filters;
    const chips = filterChips(filters, FACETS, 'movies');
    expect(chips.map(c => c.label)).toEqual(['Sci-Fi & Fantasy', 'Drama', 'Unwatched', '2020–2026']);
    expect(chips[0].removeLabel).toBe('Remove genre Sci-Fi & Fantasy');
    expect(chips[3].removeLabel).toBe('Remove release year 2020–2026');
    expect(filterChips(filters, FACETS, 'series')[3].removeLabel).toBe('Remove first aired 2020–2026');
  });

  it('removing a chip removes only that choice', () => {
    const filters = view({ genreKeys: ['g-scifi', 'g-drama'], watchStatus: 'watched' }).filters;
    expect(removeChip(filters, { group: 'genre', key: 'g-scifi' })).toEqual({ ...filters, genreKeys: ['g-drama'] });
    expect(removeChip(filters, { group: 'watch' }).watchStatus).toBeNull();
    expect(removeChip(filters, { group: 'watch' }).genreKeys).toEqual(['g-scifi', 'g-drama']);
  });

  it('toggles genres on and off', () => {
    const once = toggleGenre(EMPTY_FILTERS, 'a');
    expect(once.genreKeys).toEqual(['a']);
    expect(toggleGenre(once, 'a').genreKeys).toEqual([]);
  });

  it('treats genre order as the same query', () => {
    expect(canonicalKey(view({ genreKeys: ['b', 'a'] }))).toBe(canonicalKey(view({ genreKeys: ['a', 'b', 'a'] })));
    expect(canonicalKey(view({}, 'titleAsc'))).not.toBe(canonicalKey(view({}, 'titleDesc')));
  });

  it('offers page-specific sorts: no runtime or release date on Series, no first aired on Movies', () => {
    const caps: LibraryCapabilities = { ...ALL_CAPS, sorts: ['titleAsc', 'titleDesc', 'addedDesc', 'releaseDesc', 'firstAiredDesc', 'runtimeAsc', 'ratingDesc'] };
    expect(sortOptions('movies', caps)).toEqual(['titleAsc', 'titleDesc', 'addedDesc', 'releaseDesc', 'ratingDesc', 'runtimeAsc']);
    expect(sortOptions('series', caps)).toEqual(['titleAsc', 'titleDesc', 'addedDesc', 'firstAiredDesc', 'ratingDesc']);
  });

  it('offers page-specific watch states', () => {
    expect(watchOptions('movies', ALL_CAPS)).toEqual(['unwatched', 'inProgress', 'watched']);
    expect(watchOptions('series', jellyfinLibraryCapabilities(SHOWS))).toEqual(['hasUnwatched', 'completed']);
  });

  it('labels the apply button honestly', () => {
    const applied = DEFAULT_VIEW;
    expect(applyLabel(view({}, 'releaseDesc'), applied, 'movies', null)).toBe('Apply sorting');
    expect(applyLabel(view({ watchStatus: 'unwatched' }), applied, 'movies', 48)).toBe('Show 48 movies');
    expect(applyLabel(view({ watchStatus: 'unwatched' }), applied, 'movies', 1)).toBe('Show 1 movie');
    expect(applyLabel(view({ watchStatus: 'unwatched' }), applied, 'movies', null)).toBe('Show movies');
    expect(applyLabel(view({ watchStatus: 'hasUnwatched' }, 'addedDesc'), applied, 'series', null)).toBe('Show results');
    expect(applyLabel(view({ watchStatus: 'hasUnwatched' }), applied, 'series', 24)).toBe('Show 24 series');
  });

  it('labels years and builds presets', () => {
    expect(yearLabel(null)).toBe('Any');
    expect(yearLabel({ from: 2010, to: 2019 })).toBe('2010s');
    expect(yearLabel({ from: 2026, to: 2026 })).toBe('2026');
    const presets = yearPresets(2026);
    expect(presets[0].range).toEqual({ from: 2026, to: 2026 });
    expect(presets.find(p => p.id === 'd2020')?.range).toEqual({ from: 2020, to: 2026 });
    expect(presets[presets.length - 1].label).toBe('Before 1950');
  });

  describe('validateView', () => {
    it('keeps a valid view unchanged, even if it might match nothing', () => {
      const v = view({ genreKeys: ['g-drama'], watchStatus: 'watched', year: { from: 1950, to: 1950 } }, 'runtimeDesc');
      expect(validateView(v, 'movies', ALL_CAPS, FACETS)).toEqual({ view: v, notices: [] });
    });

    it('drops genres no longer in the library and says so', () => {
      const result = validateView(view({ genreKeys: ['g-drama', 'gone'] }), 'movies', ALL_CAPS, FACETS);
      expect(result.view.filters.genreKeys).toEqual(['g-drama']);
      expect(result.notices).toEqual(['Some saved genres are no longer in this library.']);
    });

    it('replaces an unsupported sort with Title A–Z and explains', () => {
      const caps = { ...ALL_CAPS, sorts: ['titleAsc' as const] };
      const result = validateView(view({}, 'runtimeAsc'), 'movies', caps, FACETS);
      expect(result.view.sort).toBe('titleAsc');
      expect(result.notices[0]).toContain('Runtime: shortest');
    });

    it('drops a movie watch state on the Series page', () => {
      const result = validateView(view({ watchStatus: 'inProgress' }), 'series', jellyfinLibraryCapabilities(SHOWS), FACETS);
      expect(result.view.filters.watchStatus).toBeNull();
      expect(result.notices).toHaveLength(1);
    });

    it('rejects a nonsense year range', () => {
      const result = validateView(view({ year: { from: 20, to: 99999 } }), 'movies', ALL_CAPS, FACETS);
      expect(result.view.filters.year).toBeNull();
    });
  });
});

describe('LibraryPrefsStore', () => {
  const movies: ViewScope = { provider: 'jellyfin', serverId: 's1', userId: 'u1', libraryId: 'lib-m', page: 'movies' };
  const series: ViewScope = { ...movies, libraryId: 'lib-s', page: 'series' };

  it('keeps Movies and Series sorts apart', () => {
    const prefs = new LibraryPrefsStore(new MemoryStore());
    prefs.save(movies, view({}, 'releaseDesc'));
    prefs.save(series, view({}, 'titleAsc'));
    expect(prefs.get(movies)?.sort).toBe('releaseDesc');
    expect(prefs.get(series)?.sort).toBe('titleAsc');
  });

  it('keeps servers and viewers apart', () => {
    const prefs = new LibraryPrefsStore(new MemoryStore());
    prefs.save(movies, view({ genreKeys: ['g1'] }, 'addedDesc'));
    expect(prefs.get({ ...movies, serverId: 's2' })).toBeNull();
    expect(prefs.get({ ...movies, userId: 'u2' })).toBeNull();
    expect(prefs.get({ ...movies, provider: 'plex' })).toBeNull();
  });

  it('survives a restart (a new store over the same storage)', () => {
    const kv = new MemoryStore();
    new LibraryPrefsStore(kv).save(movies, view({ watchStatus: 'unwatched', year: { from: 2020, to: 2026 } }, 'ratingDesc'));
    expect(new LibraryPrefsStore(kv).get(movies)).toEqual(view({ watchStatus: 'unwatched', year: { from: 2020, to: 2026 } }, 'ratingDesc'));
  });

  it('reads damaged entries as nothing saved, without throwing or deleting', () => {
    const kv = new MemoryStore();
    const key = `anystream.libraryView.v1.${scopeKey(movies)}`;
    kv.set(key, '{not json');
    expect(new LibraryPrefsStore(kv).get(movies)).toBeNull();
    expect(kv.getString(key)).toBe('{not json');
  });

  it('cleans each field of a stored entry', () => {
    const scope = scopeKey(movies);
    expect(migrate({ schemaVersion: 1, scopeKey: scope, filters: { genreKeys: ['a', 3, ''], watchStatus: 'bogus', year: { from: 'x' } }, sort: 'shuffle' }, scope)).toEqual(
      view({ genreKeys: ['a'] }, 'titleAsc'),
    );
    expect(migrate({ schemaVersion: 99, scopeKey: scope, filters: {}, sort: 'titleAsc' }, scope)).toBeNull();
    expect(migrate({ schemaVersion: 1, scopeKey: 'other', filters: {}, sort: 'titleAsc' }, scope)).toBeNull();
  });
});

interface Item {
  id: string;
}

/** A source whose answers the test releases one by one, in any order. */
function manualSource(total = 100) {
  const pending: Array<{ view: LibraryView; start: number; resolve: (p: LibraryPage<Item>) => void; reject: (e: unknown) => void; signal: AbortSignal }> = [];
  const counts: Array<{ view: LibraryView; resolve: (n: number | null) => void }> = [];
  const source: BrowseSource<Item> = {
    query: (v, start, limit, signal) =>
      new Promise((resolve, reject) => pending.push({ view: v, start, resolve, reject, signal })),
    count: v => new Promise(resolve => counts.push({ view: v, resolve })),
  };
  const page = (prefix: string, start: number, size: number): LibraryPage<Item> => ({
    items: Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ id: `${prefix}${start + i}` })),
    total,
  });
  return { source, pending, counts, page };
}

function fakeTimers() {
  const queue: Array<{ fn: () => void; handle: number }> = [];
  let next = 1;
  const timers: Timers = {
    setTimeout: fn => {
      const handle = next++;
      queue.push({ fn, handle });
      return handle;
    },
    clearTimeout: handle => {
      const i = queue.findIndex(t => t.handle === handle);
      if (i >= 0) {
        queue.splice(i, 1);
      }
    },
  };
  const flush = () => {
    while (queue.length) {
      queue.shift()?.fn();
    }
  };
  return { timers, flush, queue };
}

const tick = () => new Promise<void>(resolve => setImmediate(() => resolve()));

describe('BrowseController', () => {
  it('commits and saves only after the first page loads', async () => {
    const { source, pending, page } = manualSource();
    const saved: LibraryView[] = [];
    const c = new BrowseController(source, { pageSize: 10, onCommit: v => saved.push(v) }, DEFAULT_VIEW);
    const next = view({ watchStatus: 'unwatched' }, 'releaseDesc');
    const result = c.apply(next);
    expect(c.getState().applied).toBe(DEFAULT_VIEW);
    expect(saved).toEqual([]);
    pending[0].resolve(page('a', 0, 10));
    expect(await result).toEqual({ outcome: 'applied' });
    expect(c.getState().applied).toBe(next);
    expect(c.getState().items).toHaveLength(10);
    expect(saved).toEqual([next]);
  });

  it('keeps the old view and results when apply fails', async () => {
    const { source, pending, page } = manualSource();
    const saved: LibraryView[] = [];
    const c = new BrowseController(source, { pageSize: 10, onCommit: v => saved.push(v) }, DEFAULT_VIEW);
    const first = c.apply(DEFAULT_VIEW);
    pending[0].resolve(page('a', 0, 10));
    await first;
    const failed = c.apply(view({}, 'runtimeAsc'));
    pending[1].reject(new Error('offline'));
    expect((await failed).outcome).toBe('failed');
    expect(c.getState().applied).toBe(DEFAULT_VIEW);
    expect(c.getState().items[0].id).toBe('a0');
    expect(saved).toEqual([DEFAULT_VIEW]);
  });

  it('ignores an older apply that answers after a newer one', async () => {
    const { source, pending, page } = manualSource();
    const c = new BrowseController(source, { pageSize: 10 }, DEFAULT_VIEW);
    const older = c.apply(view({}, 'titleDesc'));
    const newer = c.apply(view({}, 'addedDesc'));
    expect(pending[0].signal.aborted).toBe(true);
    pending[1].resolve(page('new', 0, 10));
    pending[0].resolve(page('old', 0, 10));
    expect(await older).toEqual({ outcome: 'superseded' });
    expect(await newer).toEqual({ outcome: 'applied' });
    expect(c.getState().applied.sort).toBe('addedDesc');
    expect(c.getState().items[0].id).toBe('new0');
  });

  it('cancelApply leaves the applied view alone', async () => {
    const { source, pending, page } = manualSource();
    const c = new BrowseController(source, { pageSize: 10 }, DEFAULT_VIEW);
    const result = c.apply(view({}, 'titleDesc'));
    c.cancelApply();
    pending[0].resolve(page('x', 0, 10));
    expect(await result).toEqual({ outcome: 'superseded' });
    expect(c.getState().loaded).toBe(false);
  });

  it('pages through the whole view and stops at the exact total', async () => {
    const { source, pending, page } = manualSource(25);
    const c = new BrowseController(source, { pageSize: 10 }, DEFAULT_VIEW);
    const first = c.apply(DEFAULT_VIEW);
    pending[0].resolve(page('a', 0, 10));
    await first;
    const more = c.loadMore();
    void c.loadMore(); // a second request while one is loading does nothing
    expect(pending).toHaveLength(2);
    expect(pending[1].start).toBe(10);
    pending[1].resolve(page('a', 10, 10));
    await more;
    const last = c.loadMore();
    pending[2].resolve(page('a', 20, 10));
    await last;
    expect(c.getState().items).toHaveLength(25);
    expect(c.getState().exhausted).toBe(true);
    await c.loadMore();
    expect(pending).toHaveLength(3);
  });

  it('never mixes a page of the old view into a new one', async () => {
    const { source, pending, page } = manualSource();
    const c = new BrowseController(source, { pageSize: 10 }, DEFAULT_VIEW);
    const first = c.apply(DEFAULT_VIEW);
    pending[0].resolve(page('old', 0, 10));
    await first;
    const more = c.loadMore();
    const next = c.apply(view({}, 'titleDesc'));
    pending[2].resolve(page('new', 0, 10));
    await next;
    expect(pending[1].signal.aborted).toBe(true);
    pending[1].resolve(page('old', 10, 10));
    await more;
    expect(c.getState().items.map(i => i.id).every(id => id.startsWith('new'))).toBe(true);
    expect(c.getState().items).toHaveLength(10);
  });

  it('debounces count previews and reports only the newest', async () => {
    const { source, counts } = manualSource();
    const t = fakeTimers();
    const c = new BrowseController(source, { pageSize: 10, timers: t.timers }, DEFAULT_VIEW);
    const seen: Array<number | null> = [];
    c.previewCount(view({ watchStatus: 'unwatched' }), n => seen.push(n));
    c.previewCount(view({ watchStatus: 'watched' }), n => seen.push(n));
    expect(t.queue).toHaveLength(1);
    t.flush();
    expect(counts).toHaveLength(1);
    expect(counts[0].view.filters.watchStatus).toBe('watched');
    c.previewCount(view({ watchStatus: 'inProgress' }), n => seen.push(n));
    t.flush();
    counts[0].resolve(48); // stale: a newer preview started
    counts[1].resolve(7);
    await tick();
    expect(seen).toEqual([7]);
  });

  it('ignores everything after dispose', async () => {
    const { source, pending, page } = manualSource();
    const c = new BrowseController(source, { pageSize: 10 }, DEFAULT_VIEW);
    const listener = jest.fn();
    c.subscribe(listener);
    const result = c.apply(DEFAULT_VIEW);
    c.dispose();
    pending[0].resolve(page('a', 0, 10));
    expect(await result).toEqual({ outcome: 'superseded' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Jellyfin library mapping', () => {
  it('maps genres (OR), years, watch state and sort with a title tie-breaker', () => {
    const q = jellyfinViewQuery(MOVIES, view({ genreKeys: ['g2', 'g1'], watchStatus: 'unwatched', year: { from: 2020, to: 2022 } }, 'releaseDesc'));
    expect(q).toMatchObject({
      ParentId: 'lib-m',
      IncludeItemTypes: 'Movie',
      GenreIds: 'g1|g2',
      Years: [2020, 2021, 2022],
      IsPlayed: false,
      SortBy: 'PremiereDate,SortName',
      SortOrder: 'Descending,Ascending',
    });
    expect(jellyfinViewQuery(MOVIES, view({ watchStatus: 'inProgress' })).Filters).toBe('IsResumable');
    expect(jellyfinViewQuery(SHOWS, view({ watchStatus: 'completed' }, 'addedDesc'))).toMatchObject({
      IncludeItemTypes: 'Series',
      IsPlayed: true,
      SortBy: 'DateCreated,SortName',
    });
  });

  it('queries, pages and counts through the user items endpoint', async () => {
    const { calls, fetchImpl } = fakeFetch(call =>
      call.url.includes('Limit=0')
        ? { body: { Items: [], TotalRecordCount: 42 } }
        : { body: { Items: [{ Id: 'm1', Name: 'Film', Type: 'Movie' }], TotalRecordCount: 42 } },
    );
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    const page = await provider.queryLibrary(MOVIES, view({ genreKeys: ['g1'] }), 60, 60);
    expect(page.total).toBe(42);
    expect(page.items[0].title).toBe('Film');
    expect(calls[0].url).toContain('/Users/user-1/Items?');
    expect(calls[0].url).toContain('StartIndex=60');
    expect(calls[0].url).toContain('GenreIds=g1');
    expect(await provider.countLibrary(MOVIES, view({ genreKeys: ['g1'] }))).toBe(42);
  });

  it('lists genres with their ids for one library', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { Items: [{ Id: 'g1', Name: 'Drama' }, { Id: '', Name: 'Broken' }] } }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    expect(await provider.getLibraryFacets(SHOWS)).toEqual({ genres: [{ key: 'g1', label: 'Drama' }] });
    expect(calls[0].url).toContain('ParentId=lib-s');
    expect(calls[0].url).toContain('IncludeItemTypes=Series');
  });
});

const PLEX_SESSION: Session = {
  server: { id: 'machine-1', kind: 'plex', name: 'Test Plex', baseUrl: 'http://192.168.1.169:32400' },
  userId: 'u-1',
  userName: 'will',
  accessToken: 'server-token',
};

describe('Plex library mapping', () => {
  const movieMeta = [
    {
      type: 'movie',
      Filter: [{ filter: 'genre' }, { filter: 'year' }, { filter: 'unwatched' }, { filter: 'inProgress' }],
      Sort: [{ key: 'titleSort' }, { key: 'addedAt' }, { key: 'originallyAvailableAt' }, { key: 'duration' }],
    },
  ];

  it('offers only what the server advertises', () => {
    const caps = plexCapabilitiesFromMeta(MOVIES, movieMeta);
    expect(caps.genres).toBe(true);
    expect(caps.years).toBe(true);
    expect(caps.watchStatuses).toEqual(['unwatched', 'inProgress', 'watched']);
    expect(caps.sorts).toEqual(['titleAsc', 'titleDesc', 'addedDesc', 'releaseDesc', 'releaseAsc', 'runtimeAsc', 'runtimeDesc']);
  });

  it('offers Completed for shows only with the unwatchedLeaves filter', () => {
    const withLeaves = plexCapabilitiesFromMeta(SHOWS, [{ type: 'show', Filter: [{ filter: 'unwatchedLeaves' }], Sort: [{ key: 'titleSort' }] }]);
    expect(withLeaves.watchStatuses).toEqual(['hasUnwatched', 'completed']);
    const plain = plexCapabilitiesFromMeta(SHOWS, [{ type: 'show', Filter: [{ filter: 'unwatched' }], Sort: [{ key: 'titleSort' }] }]);
    expect(plain.watchStatuses).toEqual(['hasUnwatched']);
  });

  it('falls back to the basics when the server describes nothing', () => {
    expect(plexCapabilitiesFromMeta(MOVIES, undefined)).toMatchObject({ years: false, watchStatuses: [], sorts: ['titleAsc', 'titleDesc', 'addedDesc'] });
  });

  it('maps a view to section filters', () => {
    expect(plexViewQuery(MOVIES, view({ genreKeys: ['7', '3'], watchStatus: 'watched', year: { from: 2026, to: 2020 } }, 'runtimeDesc'))).toEqual({
      type: 1,
      sort: 'duration:desc,titleSort',
      genre: '3,7',
      'year>>': 2020,
      'year<<': 2026,
      unwatched: 0,
    });
    expect(plexViewQuery(SHOWS, view({ watchStatus: 'hasUnwatched' }, 'titleDesc'))).toEqual({ type: 2, sort: 'titleSort:desc', unwatchedLeaves: 1 });
  });

  it('sends the year operators the way Plex reads them and returns the exact total', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { MediaContainer: { totalSize: 3, Metadata: [{ ratingKey: '1', type: 'movie', title: 'A' }] } } }));
    const provider = createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    const page = await provider.queryLibrary(MOVIES, view({ year: { from: 2020, to: 2026 } }), 0, 60);
    expect(page).toMatchObject({ total: 3 });
    expect(calls[0].url).toContain('year%3E%3E=2020');
    expect(calls[0].url).toContain('year%3C%3C=2026');
    expect(calls[0].url).toContain('/library/sections/lib-m/all?');
  });

  it('asks for capabilities once per library and retries after a failure', async () => {
    let fail = true;
    const { calls, fetchImpl } = fakeFetch(() => (fail ? { status: 500 } : { body: { MediaContainer: { Meta: { Type: movieMeta } } } }));
    const provider = createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    await expect(provider.getLibraryCapabilities(MOVIES)).rejects.toBeDefined();
    fail = false;
    await provider.getLibraryCapabilities(MOVIES);
    await provider.getLibraryCapabilities(MOVIES);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('includeMeta=1');
  });
});
