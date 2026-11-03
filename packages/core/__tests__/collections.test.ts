import { BrowseController } from '../src/library/browseController';
import {
  CollectionPrefsStore,
  collectionSortLabel,
  listQueryKey,
  memberCaption,
  memberTarget,
  memberTypeLabel,
  titleCount,
} from '../src/library/collections';
import { LibraryPrefsStore } from '../src/library/prefsStore';
import { DEFAULT_VIEW } from '../src/library/viewState';
import { backLabel, collectionTrail, goBack, HOME, openCollection, openItem, openSeries, selectSection } from '../src/navigation';
import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import { createJellyfinProvider } from '../src/providers/jellyfin';
import { collectionListQuery, collectionMembersQuery } from '../src/providers/jellyfin/collections';
import { jellyfinViewQuery } from '../src/providers/jellyfin/library';
import type { CollectionListQuery, CollectionSort, LibraryPage, MediaItem, Session } from '../src/providers/types';
import { MemoryStore } from '../src/storage/keyValueStore';
import { initialEpisode } from '../src/titlePage';
import { DEVICE, SESSION, fakeFetch, type Reply } from './helpers/fakes';

const item = (kind: MediaItem['kind'], id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  title: id,
  kind,
  resumeMs: 0,
  played: false,
  ...extra,
});

function query(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('Jellyfin collection queries', () => {
  it('lists BoxSets from the user root, recursively, sorted by name, with the page and total', () => {
    const q = collectionListQuery({ sort: 'titleAsc' }, 60, 30);
    expect(q).toMatchObject({ IncludeItemTypes: 'BoxSet', Recursive: true, SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 60, Limit: 30, EnableTotalRecordCount: true });
    // No ParentId: a movie library's id would miss collections of shows or of several libraries.
    expect(q.ParentId).toBeUndefined();
    expect(q.SearchTerm).toBeUndefined();
    expect(collectionListQuery({ sort: 'titleDesc', search: '  marvel ' }, 0, 30)).toMatchObject({ SortOrder: 'Descending', SearchTerm: 'marvel' });
  });

  it('lists direct members only, never collapsed, in the server collection order by default', () => {
    const q = collectionMembersQuery('bs1', 'collection', 0, 60);
    expect(q).toMatchObject({ ParentId: 'bs1', Recursive: false, CollapseBoxSetItems: false, EnableUserData: true });
    // Collection order is the server's own: no SortBy at all, never a client A–Z labelled as the collection's.
    expect(q.SortBy).toBeUndefined();
    expect(q.SortOrder).toBeUndefined();
  });

  it('sorts members on the server across the whole collection, with title as the tie-break', () => {
    expect(collectionMembersQuery('bs1', 'titleAsc', 0, 60)).toMatchObject({ SortBy: 'SortName', SortOrder: 'Ascending' });
    expect(collectionMembersQuery('bs1', 'titleDesc', 0, 60)).toMatchObject({ SortBy: 'SortName', SortOrder: 'Descending' });
    expect(collectionMembersQuery('bs1', 'releaseDesc', 0, 60)).toMatchObject({
      SortBy: 'PremiereDate,ProductionYear,SortName',
      SortOrder: 'Descending,Descending,Ascending',
    });
    expect(collectionMembersQuery('bs1', 'releaseAsc', 0, 60)).toMatchObject({ SortOrder: 'Ascending,Ascending,Ascending' });
  });

  it('keeps Movies and Series pages individual even when the server groups titles into collections', () => {
    expect(jellyfinViewQuery({ id: 'lib', name: 'Movies', kind: 'movies' }, DEFAULT_VIEW).CollapseBoxSetItems).toBe(false);
  });
});

describe('Jellyfin collections source', () => {
  const page = (items: unknown[], total?: number): Reply => ({ body: { Items: items, TotalRecordCount: total } });

  function provider(handler: (url: string) => Reply, session: Session = SESSION) {
    const { calls, fetchImpl } = fakeFetch(call => handler(call.url));
    return { provider: createJellyfinProvider(session, DEVICE, DEFAULT_CAPABILITIES, fetchImpl), calls };
  }

  it('is offered on Jellyfin and not on Emby', () => {
    expect(provider(() => page([])).provider.collections).toBeDefined();
    const emby = provider(() => page([]), { ...SESSION, server: { ...SESSION.server, kind: 'emby' } }).provider;
    expect(emby.collections).toBeUndefined();
  });

  it('maps collections, drops repeated references by id (not title) and anything that is not a collection', async () => {
    const { provider: p, calls } = provider(() =>
      page(
        [
          { Id: 'a', Name: 'Alien', Type: 'BoxSet', ImageTags: { Primary: 't1' } },
          { Id: 'a', Name: 'Alien', Type: 'BoxSet' },
          { Id: 'b', Name: 'Alien', Type: 'BoxSet' },
          { Id: 'm', Name: 'A movie', Type: 'Movie' },
        ],
        3,
      ),
    );
    const result = await p.collections!.list({ sort: 'titleAsc' }, 0, 60);
    expect(result.items.map(i => [i.id, i.kind])).toEqual([
      ['a', 'collection'],
      ['b', 'collection'],
    ]);
    expect(result.items[0].posterUrl).toContain('/Items/a/Images/Primary');
    expect(result.total).toBe(3);
    expect(calls[0].url).toContain('/Users/user-1/Items');
    expect(query(calls[0].url).get('IncludeItemTypes')).toBe('BoxSet');
  });

  it('keeps every member kind, including nested collections and types the app has no page for', async () => {
    const { provider: p, calls } = provider(() =>
      page(
        [
          { Id: 'm1', Name: 'Film', Type: 'Movie', ProductionYear: 1999 },
          { Id: 's1', Name: 'Show', Type: 'Series' },
          { Id: 'e1', Name: 'Pilot', Type: 'Episode', SeriesId: 's9', SeriesName: 'Other show', ParentIndexNumber: 2, IndexNumber: 5 },
          { Id: 'se1', Name: 'Season 3', Type: 'Season', SeriesId: 's8', IndexNumber: 3 },
          { Id: 'bs2', Name: 'Nested', Type: 'BoxSet' },
          { Id: 'mv', Name: 'Clip', Type: 'MusicVideo' },
        ],
        6,
      ),
    );
    const result = await p.collections!.members('bs1', 'collection', 0, 60);
    expect(result.items.map(i => i.kind)).toEqual(['movie', 'series', 'episode', 'season', 'collection', 'other']);
    expect(result.total).toBe(6);
    const params = query(calls[0].url);
    expect(params.get('ParentId')).toBe('bs1');
    expect(params.get('Recursive')).toBe('false');
    expect(params.get('CollapseBoxSetItems')).toBe('false');
    expect(params.get('SortBy')).toBeNull();
  });

  it('treats a missing collection, or an id that is no longer a collection, as not found', async () => {
    const gone = provider(() => ({ status: 404 })).provider;
    await expect(gone.collections!.get('x')).rejects.toMatchObject({ kind: 'not-found' });
    const reused = provider(() => ({ body: { Id: 'x', Name: 'X', Type: 'Movie' } })).provider;
    await expect(reused.collections!.get('x')).rejects.toMatchObject({ kind: 'not-found' });
    const ok = provider(() => ({ body: { Id: 'x', Name: 'Box', Type: 'BoxSet', Overview: 'All of them' } })).provider;
    await expect(ok.collections!.get('x')).resolves.toMatchObject({ id: 'x', kind: 'collection', overview: 'All of them' });
  });

  it('never writes: browsing a collection only reads', async () => {
    const { provider: p, calls } = provider(url => (url.includes('/Items/bs1') && !url.includes('ParentId') ? { body: { Id: 'bs1', Name: 'B', Type: 'BoxSet' } } : page([], 0)));
    await p.collections!.get('bs1');
    await p.collections!.list({ sort: 'titleAsc' }, 0, 60);
    await p.collections!.members('bs1', 'titleAsc', 0, 60);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
    expect(calls.some(c => c.url.includes('/Collections'))).toBe(false);
  });
});

describe('member routing', () => {
  it('opens each member by its own kind, never as a movie by default', () => {
    expect(memberTarget(item('movie', 'm'))).toMatchObject({ to: 'detail' });
    expect(memberTarget(item('series', 's'))).toMatchObject({ to: 'series', series: { id: 's' } });
    expect(memberTarget(item('collection', 'c'))).toMatchObject({ to: 'collection' });
    expect(memberTarget(item('episode', 'e', { seriesId: 's1', seriesTitle: 'Show' }))).toEqual({
      to: 'series',
      series: { id: 's1', title: 'Show', kind: 'series', resumeMs: 0, played: false },
      episodeId: 'e',
    });
    expect(memberTarget(item('season', 'se', { seriesId: 's1', index: 3 }))).toMatchObject({ to: 'series', series: { id: 's1' }, season: 3 });
  });

  it('asks the server when an episode or season does not name its series, rather than guessing', () => {
    expect(memberTarget(item('episode', 'e'))).toMatchObject({ to: 'resolve' });
    expect(memberTarget(item('season', 'se'))).toMatchObject({ to: 'resolve' });
  });

  it('explains types the app cannot open', () => {
    const target = memberTarget(item('other', 'x', { typeName: 'MusicVideo' }));
    expect(target).toEqual({ to: 'unsupported', reason: "Music video items can't be opened in AnyStream yet." });
  });

  it('labels mixed members by type', () => {
    expect(memberTypeLabel(item('other', 'x'))).toBe('Other');
    expect(memberCaption(item('movie', 'm', { year: 1999 }))).toBe('Movie  ·  1999');
    expect(memberCaption(item('movie', 'm', { year: 2001, genres: ['Documentary'] }))).toBe('Movie  ·  2001');
    expect(memberCaption(item('episode', 'e', { seasonIndex: 2, index: 5, seriesTitle: 'Show' }))).toBe('Episode  ·  S2 E5  ·  Show');
    expect(memberCaption(item('season', 's', { index: 3, seriesTitle: 'Show' }))).toBe('Season 3  ·  Show');
    expect(memberCaption(item('collection', 'c'))).toBe('Collection');
    expect(titleCount(null)).toBeUndefined();
    expect(titleCount(1)).toBe('1 title');
    expect(titleCount(12)).toBe('12 titles');
  });

  it('opens a season on that season, picking within it as the series page normally would', () => {
    const eps = [
      item('episode', 's1e1', { seasonIndex: 1, index: 1, played: true }),
      item('episode', 's2e1', { seasonIndex: 2, index: 1, played: true }),
      item('episode', 's2e2', { seasonIndex: 2, index: 2 }),
      item('episode', 's3e1', { seasonIndex: 3, index: 1 }),
    ];
    expect(initialEpisode(eps, undefined, 2)?.id).toBe('s2e2');
    // The exact episode still wins, and a season the series no longer has falls back to the usual choice.
    expect(initialEpisode(eps, 's3e1', 2)?.id).toBe('s3e1');
    expect(initialEpisode(eps, undefined, 9)?.id).toBe(initialEpisode(eps)?.id);
  });
});

describe('collection navigation', () => {
  const base = selectSection(HOME, 'collections');

  it('opens a collection from the Collections page and Back returns to it', () => {
    const open = openCollection(base, item('collection', 'c1'));
    expect(open[open.length - 1]).toEqual({ name: 'collection', item: item('collection', 'c1') });
    expect(backLabel(open)).toBe('Back to Collections');
    expect(goBack(open)).toEqual(base);
    // A collection card anywhere (Home row) goes the same way through openItem.
    expect(openItem(HOME, item('collection', 'c1'))[1]).toMatchObject({ name: 'collection' });
  });

  it('keeps the ancestors of nested collections, for the breadcrumb and Back', () => {
    const a = openCollection(base, item('collection', 'A'));
    const b = openCollection(a, item('collection', 'B'));
    expect(collectionTrail(b).map(c => c.id)).toEqual(['A', 'B']);
    expect(backLabel(b)).toBe('Back to A');
    expect(goBack(b)).toEqual(a);
  });

  it('stops a collection that contains itself instead of recursing', () => {
    const a = openCollection(base, item('collection', 'A'));
    const b = openCollection(a, item('collection', 'B'));
    const again = openCollection(b, item('collection', 'A'));
    expect(again[again.length - 1]).toMatchObject({ name: 'collection', loop: true });
    // A sibling branch may open the same collection normally.
    expect(openCollection(base, item('collection', 'B'))[1]).not.toHaveProperty('loop');
  });

  it('opens a series for an episode or a season member', () => {
    const series = item('series', 's1');
    expect(openSeries(base, series, { episodeId: 'e1' })[1]).toEqual({ name: 'series', item: series, episodeId: 'e1' });
    expect(openSeries(base, series, { season: 2 })[1]).toEqual({ name: 'series', item: series, season: 2 });
  });
});

describe('collection sort preferences', () => {
  const scope = { provider: 'jellyfin', serverId: 'srv', userId: 'u1' };

  it('remembers the Collections page sort per server and viewer, apart from Movies and Series', () => {
    const kv = new MemoryStore();
    const prefs = new CollectionPrefsStore(kv);
    const library = new LibraryPrefsStore(kv);
    expect(prefs.listSort(scope)).toBe('titleAsc');
    prefs.saveListSort(scope, 'titleDesc');
    expect(new CollectionPrefsStore(kv).listSort(scope)).toBe('titleDesc');
    expect(prefs.listSort({ ...scope, userId: 'u2' })).toBe('titleAsc');
    expect(prefs.listSort({ ...scope, serverId: 'other' })).toBe('titleAsc');
    // The Movies view is untouched, and saving it does not touch Collections.
    const movies = { ...scope, libraryId: 'lib', page: 'movies' as const };
    expect(library.get(movies)).toBeNull();
    library.save(movies, { ...DEFAULT_VIEW, sort: 'addedDesc' });
    expect(prefs.listSort(scope)).toBe('titleDesc');
  });

  it('opens each collection in Collection order until the viewer picks another, per collection', () => {
    const kv = new MemoryStore();
    const prefs = new CollectionPrefsStore(kv);
    expect(prefs.memberSort(scope, 'c1')).toBe('collection');
    prefs.saveMemberSort(scope, 'c1', 'releaseDesc');
    expect(prefs.memberSort(scope, 'c1')).toBe('releaseDesc');
    expect(prefs.memberSort(scope, 'c2')).toBe('collection');
    prefs.saveMemberSort(scope, 'c1', 'collection');
    expect(prefs.memberSort(scope, 'c1')).toBe('collection');
  });

  it('reads damaged values as nothing saved', () => {
    const kv = new MemoryStore();
    const prefs = new CollectionPrefsStore(kv);
    kv.set('anystream.collections.v1.list.jellyfin/srv/u1', 'random');
    kv.set('anystream.collections.v1.members.jellyfin/srv/u1/c1', '{"x":1}');
    expect(prefs.listSort(scope)).toBe('titleAsc');
    expect(prefs.memberSort(scope, 'c1')).toBe('collection');
  });

  it('labels every order truthfully', () => {
    expect(collectionSortLabel('collection')).toBe('Collection order');
    expect(collectionSortLabel('titleAsc')).toBe('Title A–Z');
  });
});

describe('collection paging', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => (resolve = r));
    return { promise, resolve };
  }

  it('drops a late page for an older search, and keeps the sort when the search changes', async () => {
    const pending: Array<{ q: CollectionListQuery; d: ReturnType<typeof deferred<LibraryPage<MediaItem>>> }> = [];
    const controller = new BrowseController<MediaItem, CollectionListQuery>(
      {
        query: q => {
          const d = deferred<LibraryPage<MediaItem>>();
          pending.push({ q, d });
          return d.promise;
        },
      },
      { pageSize: 2, keyOf: listQueryKey },
      { sort: 'titleDesc' },
    );
    const first = controller.apply({ sort: 'titleDesc', search: 'al' });
    const second = controller.apply({ sort: 'titleDesc', search: 'ali' });
    pending[1].d.resolve({ items: [item('collection', 'alien')], total: 1 });
    pending[0].d.resolve({ items: [item('collection', 'alias')], total: 1 });
    expect(await second).toEqual({ outcome: 'applied' });
    expect(await first).toEqual({ outcome: 'superseded' });
    expect(controller.getState().items.map(i => i.id)).toEqual(['alien']);
    expect(controller.getState().applied).toEqual({ sort: 'titleDesc', search: 'ali' });
  });

  it('pages members in one server order and stops when the total is reached', async () => {
    const all = ['a', 'b', 'c'].map(id => item('movie', id));
    const seen: Array<[CollectionSort, number]> = [];
    const controller = new BrowseController<MediaItem, CollectionSort>(
      {
        query: async (sort, start, limit) => {
          seen.push([sort, start]);
          return { items: all.slice(start, start + limit), total: all.length };
        },
      },
      { pageSize: 2, keyOf: sort => sort },
      'collection',
    );
    await controller.apply('collection');
    await controller.loadMore();
    await controller.loadMore();
    expect(controller.getState().items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(controller.getState().exhausted).toBe(true);
    expect(seen).toEqual([
      ['collection', 0],
      ['collection', 2],
    ]);
  });
});
