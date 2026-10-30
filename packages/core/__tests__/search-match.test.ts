import { externalIds, fromPlexGuids, fromProviderIds } from '../src/search/externalIds';
import { findGroup, groupHits, hitsOn, normalizeTitle } from '../src/search/match';
import { makeHit, refKey, type SearchSource, type SourceHit } from '../src/search/model';
import type { MediaItem } from '../src/providers/types';

function source(key: string, provider: SearchSource['provider'] = 'jellyfin'): SearchSource {
  return { key, contextKey: `${key}.ctx`, provider, serverId: `${key}-server`, label: key, profileName: 'will', revision: 'r1', signedIn: true };
}

const JF = source('jf');
const PLEX = source('plex', 'plex');
const EMBY = source('emby', 'emby');
const ORDER = { query: 'matrix', sourceOrder: ['jf', 'plex', 'emby'] };

function movie(id: string, extra: Partial<MediaItem> = {}): MediaItem {
  return { id, title: 'The Matrix', kind: 'movie', year: 1999, resumeMs: 0, played: false, ...extra };
}

function hit(src: SearchSource, item: MediaItem, rank = 0): SourceHit {
  return makeHit(src, item, rank);
}

describe('external ids', () => {
  it('normalises spellings and drops junk', () => {
    expect(externalIds({ tmdb: '0603', imdb: 'TT0133093', tvdb: 'abc' })).toEqual({ tmdb: '603', imdb: 'tt0133093' });
    expect(externalIds({ tmdb: '', imdb: 'nm123' })).toBeUndefined();
  });

  it('reads Jellyfin and Emby ProviderIds whatever the key case', () => {
    expect(fromProviderIds({ Tmdb: '603', IMDB: 'tt0133093', Tvdb: '81189', TmdbCollection: '2344' })).toEqual({
      tmdb: '603',
      imdb: 'tt0133093',
      tvdb: '81189',
    });
    expect(fromProviderIds(undefined)).toBeUndefined();
  });

  it('reads Plex Guid lists and legacy agent guids, never plex:// ones', () => {
    expect(fromPlexGuids([{ id: 'imdb://tt0133093' }, { id: 'tmdb://603' }, { id: 'plex://movie/5d77' }], 'plex://movie/5d77')).toEqual({
      imdb: 'tt0133093',
      tmdb: '603',
    });
    expect(fromPlexGuids(undefined, 'com.plexapp.agents.imdb://tt0133093?lang=en')).toEqual({ imdb: 'tt0133093' });
    expect(fromPlexGuids(undefined, 'com.plexapp.agents.themoviedb://603?lang=en')).toEqual({ tmdb: '603' });
    // A legacy episode guid names the series plus season and episode: not the episode's own id.
    expect(fromPlexGuids(undefined, 'com.plexapp.agents.thetvdb://81189/1/2?lang=en')).toBeUndefined();
    expect(fromPlexGuids(undefined, 'plex://movie/5d77')).toBeUndefined();
  });
});

describe('item references', () => {
  it('never collide across servers, profiles or awkward ids', () => {
    const a = refKey({ provider: 'plex', serverId: 'm1', contextKey: 'ctx-a', itemId: '42' });
    const b = refKey({ provider: 'plex', serverId: 'm1', contextKey: 'ctx-b', itemId: '42' });
    const c = refKey({ provider: 'jellyfin', serverId: 'm1', contextKey: 'ctx-a', itemId: '42' });
    const d = refKey({ provider: 'plex', serverId: 'm1/ctx-a', contextKey: '', itemId: '42' });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
});

describe('normalizeTitle', () => {
  it('folds case, compatibility forms and spaces, and keeps punctuation', () => {
    expect(normalizeTitle('  The   MATRIX ')).toBe('the matrix');
    expect(normalizeTitle('Ｍatrix')).toBe('matrix');
    expect(normalizeTitle('Alien')).not.toBe(normalizeTitle('Aliens'));
    expect(normalizeTitle('Se7en')).not.toBe(normalizeTitle('Seven'));
  });
});

describe('groupHits', () => {
  it('merges one title found on three servers by shared ids, active copy first', () => {
    const groups = groupHits(
      [
        hit(EMBY, movie('e1', { externalIds: { imdb: 'tt0133093' } })),
        hit(PLEX, movie('p1', { externalIds: { tmdb: '603', imdb: 'tt0133093' } })),
        hit(JF, movie('j1', { externalIds: { tmdb: '603' } })),
      ],
      ORDER,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].hits.map(h => h.sourceKey)).toEqual(['jf', 'plex', 'emby']);
    expect(groups[0].display.item.id).toBe('j1');
    expect(groups[0].bucket).toBe(2); // "the matrix" is not "matrix"
  });

  it('gives the same groups whatever order the servers answered in', () => {
    const hits = [
      hit(JF, movie('j1', { externalIds: { tmdb: '603' } })),
      hit(PLEX, movie('p1', { externalIds: { tmdb: '603', imdb: 'tt0133093' } })),
      hit(EMBY, movie('e1', { externalIds: { imdb: 'tt0133093' } })),
      hit(EMBY, movie('e2', { title: 'The Matrix Reloaded', year: 2003, externalIds: { tmdb: '604' } }), 1),
    ];
    const forward = groupHits(hits, ORDER);
    const backward = groupHits([...hits].reverse(), ORDER);
    expect(backward.map(g => g.key)).toEqual(forward.map(g => g.key));
    expect(backward.map(g => g.hits.map(h => h.key))).toEqual(forward.map(g => g.hits.map(h => h.key)));
  });

  it('never merges different kinds, even with the same number in the same database', () => {
    const groups = groupHits(
      [hit(JF, movie('j1', { externalIds: { tmdb: '1399' } })), hit(PLEX, movie('p1', { kind: 'series', externalIds: { tmdb: '1399' } }))],
      ORDER,
    );
    expect(groups).toHaveLength(2);
  });

  it('keeps a remake apart: same title, different year and ids', () => {
    const groups = groupHits(
      [
        hit(JF, movie('j1', { title: 'Dune', year: 1984, externalIds: { tmdb: '841' } })),
        hit(PLEX, movie('p1', { title: 'Dune', year: 2021, externalIds: { tmdb: '438631' } })),
      ],
      { ...ORDER, query: 'dune' },
    );
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.display.item.year)).toEqual([1984, 2021]);
    expect(groups.every(g => g.bucket === 0)).toBe(true);
  });

  it('refuses a merge when ids in the same database disagree, even with the same title and year', () => {
    const groups = groupHits(
      [hit(JF, movie('j1', { externalIds: { tmdb: '603' } })), hit(PLEX, movie('p1', { externalIds: { tmdb: '999' } }))],
      ORDER,
    );
    expect(groups).toHaveLength(2);
  });

  it('does not let a title with few ids bridge two groups that disagree', () => {
    const groups = groupHits(
      [
        hit(JF, movie('j1', { externalIds: { tmdb: '603', imdb: 'tt0133093' } })),
        hit(PLEX, movie('p1', { externalIds: { tmdb: '603', imdb: 'tt9999999' } })),
        // Shares tmdb with both, which disagree on IMDb with each other.
        hit(EMBY, movie('e1', { externalIds: { tmdb: '603' } })),
      ],
      ORDER,
    );
    expect(groups).toHaveLength(2);
    expect(groups.flatMap(g => g.hits).length).toBe(3);
  });

  it('falls back to title and exact year when no id says otherwise', () => {
    const groups = groupHits(
      [hit(JF, movie('j1', { title: 'Home Video', externalIds: undefined })), hit(PLEX, movie('p1', { title: 'home  video' }))],
      ORDER,
    );
    expect(groups).toHaveLength(1);
  });

  it('keeps titles apart when a year is missing or the fallback is ambiguous', () => {
    expect(groupHits([hit(JF, movie('j1', { year: undefined })), hit(PLEX, movie('p1', { year: undefined }))], ORDER)).toHaveLength(2);
    const ambiguous = groupHits(
      [
        hit(JF, movie('j1', { externalIds: { tmdb: '1' } })),
        hit(JF, movie('j2', { externalIds: { tmdb: '2' } }), 1),
        hit(PLEX, movie('p1')),
      ],
      ORDER,
    );
    expect(ambiguous).toHaveLength(3);
  });

  it('keeps two copies on one server together, and lists both', () => {
    const groups = groupHits(
      [
        hit(JF, movie('j1', { externalIds: { tmdb: '603' } })),
        hit(JF, movie('j2', { externalIds: { tmdb: '603' } }), 1),
        hit(PLEX, movie('p1', { externalIds: { tmdb: '603' } })),
      ],
      ORDER,
    );
    expect(groups).toHaveLength(1);
    expect(hitsOn(groups[0], 'jf').map(h => h.item.id)).toEqual(['j1', 'j2']);
    expect(hitsOn(groups[0], 'emby')).toEqual([]);
  });

  it('keeps every copy its own progress: nothing is merged between servers', () => {
    const groups = groupHits(
      [
        hit(JF, movie('j1', { resumeMs: 1000, externalIds: { tmdb: '603' } })),
        hit(PLEX, movie('p1', { played: true, externalIds: { tmdb: '603' } })),
      ],
      ORDER,
    );
    expect(groups[0].hits.map(h => [h.item.resumeMs, h.item.played])).toEqual([
      [1000, false],
      [0, true],
    ]);
  });

  describe('episodes', () => {
    const series = (src: SearchSource, id: string, tmdb: string): SourceHit =>
      hit(src, { id, title: 'The Show', kind: 'series', year: 2010, resumeMs: 0, played: false, externalIds: { tmdb } });
    const episode = (src: SearchSource, id: string, seriesId: string, season?: number, index?: number, extra: Partial<MediaItem> = {}): SourceHit =>
      hit(src, { id, title: 'Pilot', kind: 'episode', year: 2010, seriesId, seasonIndex: season, index, resumeMs: 0, played: false, ...extra }, 1);

    it('merge by their own id', () => {
      const groups = groupHits(
        [episode(JF, 'je', 'js', 1, 1, { externalIds: { tvdb: '111' } }), episode(PLEX, 'pe', 'ps', 1, 1, { externalIds: { tvdb: '111' } })],
        ORDER,
      );
      expect(groups).toHaveLength(1);
    });

    it('merge through a matched series with the same season and episode', () => {
      const groups = groupHits(
        [series(JF, 'js', '1'), series(PLEX, 'ps', '1'), episode(JF, 'je', 'js', 1, 1), episode(PLEX, 'pe', 'ps', 1, 1)],
        ORDER,
      );
      expect(groups.map(g => [g.kind, g.hits.length])).toEqual([
        ['episode', 2],
        ['series', 2],
      ]);
    });

    it('stay apart on title and year alone, or with other numbering', () => {
      expect(groupHits([episode(JF, 'je', 'js', 1, 1), episode(PLEX, 'pe', 'ps', 1, 1)], ORDER)).toHaveLength(2);
      const numbering = groupHits(
        [series(JF, 'js', '1'), series(PLEX, 'ps', '1'), episode(JF, 'je', 'js', 1, 1), episode(PLEX, 'pe', 'ps', 1, 2)],
        ORDER,
      );
      expect(numbering).toHaveLength(3);
      const missing = groupHits([series(JF, 'js', '1'), series(PLEX, 'ps', '1'), episode(JF, 'je', 'js'), episode(PLEX, 'pe', 'ps')], ORDER);
      expect(missing).toHaveLength(3);
    });
  });

  it('orders exact title, then prefix, then the rest, with stable tie breakers', () => {
    const groups = groupHits(
      [
        hit(JF, movie('a', { title: 'Zebra Matrix', year: 2000 }), 0),
        hit(JF, movie('b', { title: 'Matrix Resurrections', year: 2021 }), 1),
        hit(JF, movie('c', { title: 'Matrix', year: 1990 }), 2),
        hit(PLEX, movie('d', { title: 'Matrix Revisited', year: 2001 }), 0),
      ],
      ORDER,
    );
    expect(groups.map(g => g.display.item.title)).toEqual(['Matrix', 'Matrix Resurrections', 'Matrix Revisited', 'Zebra Matrix']);
  });

  it('lets focus follow a title when a late server merges two cards', () => {
    const early = groupHits([hit(JF, movie('j1', { externalIds: { tmdb: '603' } })), hit(PLEX, movie('p1', { year: 2000, externalIds: { imdb: 'tt0133093' } }))], {
      ...ORDER,
      query: 'x',
    });
    expect(early).toHaveLength(2);
    const focused = early.find(g => g.display.item.id === 'p1')!;
    const late = groupHits(
      [...early.flatMap(g => g.hits), hit(EMBY, movie('e1', { externalIds: { tmdb: '603', imdb: 'tt0133093' } }))],
      { ...ORDER, query: 'x' },
    );
    expect(late).toHaveLength(1);
    expect(findGroup(late, { key: focused.key, hitKeys: focused.hits.map(h => h.key) })).toBe(late[0]);
  });
});
