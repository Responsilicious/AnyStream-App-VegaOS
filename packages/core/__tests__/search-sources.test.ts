import { ConnectionStore } from '../src/connections/connectionStore';
import { ALL_SOURCES, type SearchSnapshot } from '../src/search/controller';
import { makeHit, type SearchSource } from '../src/search/model';
import { groupHits } from '../src/search/match';
import { classifySearchError, copyChoices, defaultScope, searchSources, searchStatus, sourceCaption, sourceLabels } from '../src/search/sources';
import { JellyfinError } from '../src/providers/jellyfin/errors';
import { PlexError } from '../src/providers/plex/errors';
import { MemoryStore } from '../src/storage/keyValueStore';
import type { MediaItem } from '../src/providers/types';

function source(key: string, extra: Partial<SearchSource> = {}): SearchSource {
  return { key, contextKey: `${key}.ctx`, provider: 'jellyfin', serverId: key, label: 'Home', profileName: 'will', revision: 'r', signedIn: true, ...extra };
}

const movie = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, title: 'Matrix', kind: 'movie', year: 1999, resumeMs: 0, played: false, ...extra });

describe('searchSources', () => {
  function store() {
    const s = new ConnectionStore(new MemoryStore());
    s.addJellyfin({ provider: 'jellyfin', serverNativeId: 'jf1', serverName: 'Jelly', baseUrl: 'http://jf', userId: 'u1', userName: 'will', accessToken: 'tok-1' });
    const account = s.addPlexAccount({ userId: 'p', userName: 'will_plex', token: 'acct', tokenKind: 'legacy' });
    s.addPlexServers(account.id, [{ machineId: 'm1', name: 'Plexy', endpoints: ['http://plex'], accessToken: 'server-tok' }]);
    return s;
  }

  it('lists every connection without exposing tokens', () => {
    const sources = searchSources(store());
    expect(sources.map(s => [s.provider, s.label, s.signedIn])).toEqual([
      ['jellyfin', 'Jelly', true],
      ['plex', 'Plexy', true],
    ]);
    expect(JSON.stringify(sources)).not.toMatch(/tok-1|server-tok|acct/);
  });

  it('changes revision when the profile or token changes, and marks an expired sign-in', () => {
    const s = store();
    const [, plex] = searchSources(s);
    s.setPlexProfile(plex.key, { profileId: 'kid', profileName: 'Kid', serverToken: 'kid-tok' });
    const after = searchSources(s).find(x => x.key === plex.key)!;
    expect(after.revision).not.toBe(plex.revision);
    expect(after.contextKey).not.toBe(plex.contextKey);
    const jf = searchSources(s)[0];
    s.markAuthExpired(s.get(jf.key)!.account.id);
    expect(searchSources(s)[0].signedIn).toBe(false);
  });
});

describe('labels and scope', () => {
  it('disambiguates the same name by provider, then by profile', () => {
    const labels = sourceLabels([
      source('a', { provider: 'jellyfin' }),
      source('b', { provider: 'plex' }),
      source('c', { provider: 'plex', profileName: 'kid' }),
      source('d', { label: 'Office' }),
    ]);
    expect([...labels.values()]).toEqual(['Home (Jellyfin)', 'Home (Plex) · will', 'Home (Plex) · kid', 'Office']);
  });

  it('searches everything for one viewer, only the active server when several people share the TV', () => {
    // Different names on different servers are usually one person.
    expect(defaultScope([source('a'), source('b', { profileName: 'will_plex' })], 'a')).toBe(ALL_SOURCES);
    // The same server saved for two profiles is two people.
    const owner = source('a', { serverId: 's', contextKey: 's.owner' });
    const kid = source('b', { serverId: 's', contextKey: 's.kid', profileName: 'kid' });
    expect(defaultScope([owner, kid, source('c')], 'b')).toBe('b');
    expect(defaultScope([owner, kid], undefined)).toBe(ALL_SOURCES);
  });
});

describe('classifySearchError', () => {
  it('maps provider failures to what search shows', () => {
    expect(classifySearchError(new JellyfinError('unauthorized', 'x'))).toBe('auth-required');
    expect(classifySearchError(new PlexError('forbidden', 'x'))).toBe('denied');
    expect(classifySearchError(new JellyfinError('cancelled', 'x'))).toBe('cancelled');
    expect(classifySearchError(new PlexError('timeout', 'x'))).toBe('timed-out');
    expect(classifySearchError(new TypeError('boom'))).toBe('unavailable');
  });
});

describe('card and status text', () => {
  const A = source('a', { label: 'Jelly' });
  const B = source('b', { label: 'Plexy', provider: 'plex' });
  const labels = sourceLabels([A, B]);

  it('names one server and its kind, or counts several', () => {
    const [single] = groupHits([makeHit(A, movie('1'), 0)], { query: 'm', sourceOrder: ['a', 'b'] });
    expect(sourceCaption(single, labels, [A, B])).toBe('Jelly · Jellyfin');
    const [both] = groupHits([makeHit(A, movie('1', { externalIds: { tmdb: '1' } }), 0), makeHit(B, movie('2', { externalIds: { tmdb: '1' } }), 0)], {
      query: 'm',
      sourceOrder: ['a', 'b'],
    });
    expect(sourceCaption(both, labels, [A, B])).toBe('On 2 servers');
  });

  it('numbers two copies on one server', () => {
    const choices = copyChoices([makeHit(A, movie('1', { runtimeMs: 8_160_000 }), 0), makeHit(A, movie('2'), 1), makeHit(B, movie('3'), 0)], labels);
    expect(choices.map(c => c.label)).toEqual(['Jelly, copy 1', 'Jelly, copy 2', 'Plexy']);
    expect(choices[0].detail).toBe('1999  ·  2 h 16 min');
  });

  const snap = (states: Array<[SearchSource, string]>, groups = 0): SearchSnapshot => ({
    request: { query: 'matrix', filter: 'all', scope: ALL_SOURCES },
    states: states.map(([s, status]) => ({ source: s, status: status as never, count: 0 })),
    groups: groups ? groupHits([makeHit(A, movie('1'), 0)], { query: 'matrix', sourceOrder: ['a'] }) : [],
    pending: states.filter(([, st]) => st === 'pending').length,
  });

  it('tells pending, failed, sign-in and empty apart', () => {
    expect(searchStatus(snap([[A, 'complete'], [B, 'pending']], 1), labels).line).toBe('Searching 1 more server…');
    expect(searchStatus(snap([[A, 'complete'], [B, 'timed-out']], 1), labels).line).toBe("Couldn't search Plexy.");
    expect(searchStatus(snap([[A, 'complete'], [B, 'complete']]), labels).empty).toBe('No results for “matrix”.');
    expect(searchStatus(snap([[A, 'complete'], [B, 'unavailable']]), labels).empty).toBe('No results for “matrix” on the servers that answered.');
    expect(searchStatus(snap([[A, 'unavailable'], [B, 'timed-out']]), labels).empty).toBe("Couldn't search any of your servers.");
    expect(searchStatus(snap([[A, 'auth-required'], [B, 'auth-required']]), labels)).toEqual({
      line: 'Jelly and Plexy need you to sign in again.',
      empty: 'Sign in again to search.',
    });
  });
});
