import { ConnectionStore } from '../src/connections/connectionStore';
import { plexSigner } from '../src/connections/plexKey';
import { checkConnection } from '../src/connections/status';
import { parseResources } from '../src/providers/plex';
import {
  endpointsFor,
  managerActions,
  pickerRows,
  pickerRowStatus,
  refreshRows,
  removeMessage,
  signOutMessage,
  toggleRow,
  routeOf,
  statusText,
  withReach,
} from '../src/servers';
import { MemoryStore } from '../src/storage/keyValueStore';
import { DEVICE, fakeFetch } from './helpers/fakes';

function storeWithBoth() {
  const store = new ConnectionStore(new MemoryStore());
  const jf = store.addJellyfin({
    serverNativeId: 'jf-1',
    serverName: 'Home',
    baseUrl: 'https://jf.example.com',
    userId: 'u1',
    userName: 'Will',
    accessToken: 'jf-tok',
  });
  const account = store.addPlexAccount({ userId: 'p1', userName: 'will', token: 'acct', tokenKind: 'jwt' });
  const [plex] = store.addPlexServers(account.id, [
    { machineId: 'm-1', name: 'Basement', accessToken: 'srv-tok', endpoints: ['https://a.plex.direct:32400', 'http://192.168.1.5:32400'] },
  ]);
  return { store, jf, plex, account };
}

describe('server manager wording', () => {
  it('offers Switch only for inactive rows and Sign in again when expired', () => {
    const { store, jf, plex, account } = storeWithBoth();
    expect(managerActions(store.get(jf.connection.id)!, 'online')).toEqual(['rename', 'startup', 'remove']);
    expect(managerActions(store.get(plex.connection.id)!, 'unavailable')).toEqual(['switch', 'rename', 'startup', 'remove']);
    store.markAuthExpired(account.id);
    expect(managerActions(store.get(plex.connection.id)!, 'auth-required')[0]).toBe('sign-in');
  });

  it('names what removal and account sign-out affect', () => {
    const { store, jf } = storeWithBoth();
    expect(removeMessage(store.get(jf.connection.id)!)).toBe(
      "Remove Home from this TV? Nothing on the server is deleted. You'll choose another server afterwards.",
    );
    expect(signOutMessage('will', ['Basement', 'Cabin', 'Attic'])).toBe('Sign will out of Plex on this TV? This also removes Basement, Cabin and Attic.');
  });
});

describe('Plex server picker', () => {
  const servers = parseResources([
    { name: 'A', provides: 'server', clientIdentifier: 'a', owned: true, accessToken: 't', connections: [{ protocol: 'https', uri: 'https://a1', local: true }, { protocol: 'https', uri: 'https://a2' }] },
    { name: 'B', provides: 'server', clientIdentifier: 'b', owned: false, sourceTitle: 'Sam', accessToken: 't', connections: [] },
    { name: 'C', provides: 'server', clientIdentifier: 'c', owned: true, accessToken: 't', connections: [] },
  ]);

  it('ticks nothing by default and cannot tick a server already on this TV', () => {
    let rows = pickerRows(servers, ['b'], ['c']);
    expect(rows.map(r => r.selected)).toEqual([false, false, false]);
    expect(rows[2].removedBefore).toBe(true);
    rows = toggleRow(toggleRow(rows, 'a'), 'b');
    expect(rows.map(r => r.selected)).toEqual([true, false, false]);
    expect(pickerRowStatus(rows[1])).toBe('Already added');
  });

  it('keeps ticks across a refresh and drops servers that went away', () => {
    const rows = toggleRow(pickerRows(servers, [], []), 'c');
    const next = refreshRows(rows, servers.slice(1), [], []);
    expect(next.map(r => [r.server.machineId, r.selected])).toEqual([
      ['b', false],
      ['c', true],
    ]);
  });

  it('describes reachability and saves the working address first', () => {
    let rows = pickerRows(servers, [], []);
    expect(pickerRowStatus(rows[0])).toBe('Checking…');
    rows = withReach(rows, 'a', { status: 'online', uri: 'https://a2', kind: 'remote' });
    expect(pickerRowStatus(rows[0])).toBe('Online · Remote');
    expect(endpointsFor(rows[0])).toEqual(['https://a2', 'https://a1']);
    rows = withReach(rows, 'b', { status: 'unreachable' });
    expect(pickerRowStatus(rows[1])).toBe('Unavailable');
  });
});

describe('checkConnection', () => {
  it('calls a reachable Plex server online, trying the next address after a failure', async () => {
    const { store, plex } = storeWithBoth();
    const { calls, fetchImpl } = fakeFetch(call => {
      if (call.url.startsWith('https://a.plex.direct')) {
        return 'throw';
      }
      if (call.url.endsWith('/identity')) {
        return { body: { MediaContainer: { machineIdentifier: 'm-1' } } };
      }
      return { body: {} };
    });
    const result = await checkConnection(store, plex.connection.id, DEVICE, undefined, fetchImpl);
    expect(result).toEqual({ status: 'online', endpoint: 'http://192.168.1.5:32400', workingEndpoint: 'http://192.168.1.5:32400' });
    // The working address goes first, so the next session uses it rather than the one that failed.
    expect(store.toSession(plex.connection.id)?.server.baseUrl).toBe('http://192.168.1.5:32400');
    const tokened = calls.filter(c => c.headers['X-Plex-Token']);
    expect(tokened.map(c => c.url)).toEqual(['http://192.168.1.5:32400/library/sections']);
  });

  it('does not send the token to an address that is a different machine', async () => {
    const { store, plex } = storeWithBoth();
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { MediaContainer: { machineIdentifier: 'other' } } }));
    expect((await checkConnection(store, plex.connection.id, DEVICE, undefined, fetchImpl)).status).toBe('unavailable');
    expect(calls.some(c => c.headers['X-Plex-Token'])).toBe(false);
  });

  it('tells a refused token apart from an unreachable server', async () => {
    const { store, plex, jf } = storeWithBoth();
    const refused = fakeFetch(call => (call.url.endsWith('/identity') ? { body: { MediaContainer: { machineIdentifier: 'm-1' } } } : { status: 401 }));
    expect((await checkConnection(store, plex.connection.id, DEVICE, undefined, refused.fetchImpl)).status).toBe('auth-required');
    const down = fakeFetch(() => 'throw');
    expect((await checkConnection(store, jf.connection.id, DEVICE, undefined, down.fetchImpl)).status).toBe('unavailable');
    const jfRefused = fakeFetch(() => ({ status: 401 }));
    expect((await checkConnection(store, jf.connection.id, DEVICE, undefined, jfRefused.fetchImpl)).status).toBe('auth-required');
  });

  it('needs no network to know a signed-out connection needs signing in', async () => {
    const { store, jf } = storeWithBoth();
    store.markAuthExpired(jf.account.id);
    const { calls, fetchImpl } = fakeFetch(() => ({ body: {} }));
    expect((await checkConnection(store, jf.connection.id, DEVICE, undefined, fetchImpl)).status).toBe('auth-required');
    expect(calls).toHaveLength(0);
  });
});

describe('plexSigner', () => {
  it('makes one key per TV and reuses it', () => {
    const store = new ConnectionStore(new MemoryStore());
    let n = 0;
    const random = (len: number) => Uint8Array.from({ length: len }, () => (n = (n + 37) & 0xff));
    const a = plexSigner(store, random)!;
    const b = plexSigner(store, () => {
      throw new Error('should not need randomness again');
    })!;
    expect(b.kid).toBe(a.kid);
    expect(Array.from(b.publicKey)).toEqual(Array.from(a.publicKey));
  });

  it('gives no key, rather than a weak one, without a secure random source', () => {
    const store = new ConnectionStore(new MemoryStore());
    expect(
      plexSigner(store, () => {
        throw new Error('no source');
      }),
    ).toBeUndefined();
  });
});

describe('routeOf', () => {
  it('calls private addresses and plex.direct LAN names local, everything else remote', () => {
    expect(routeOf('http://192.168.1.169:32400')).toEqual({ where: 'local', secure: false });
    expect(routeOf('https://192-168-1-5.abc123.plex.direct:32400')).toEqual({ where: 'local', secure: true });
    expect(routeOf('https://81-2-3-4.abc123.plex.direct:32400')).toEqual({ where: 'remote', secure: true });
    expect(routeOf('https://watch.example.com')).toEqual({ where: 'remote', secure: true });
    expect(routeOf('http://172.20.0.2:8096').where).toBe('local');
    expect(routeOf('http://172.40.0.2:8096').where).toBe('remote');
  });

  it('adds the route to Online only', () => {
    expect(statusText('online', { where: 'local', secure: true })).toBe('Online · Local');
    expect(statusText('unavailable', { where: 'local', secure: true })).toBe('Unavailable');
  });
});
