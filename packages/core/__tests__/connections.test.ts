import { ConnectionStore, type JellyfinSignIn } from '../src/connections/connectionStore';
import { ContextCoordinator } from '../src/connections/contextCoordinator';
import { contextKey } from '../src/connections/model';
import { MemoryStore } from '../src/storage/keyValueStore';

const JF: JellyfinSignIn = {
  serverNativeId: 'jf-abc',
  serverName: 'Home',
  baseUrl: 'https://watch.example.com',
  userId: 'u1',
  userName: 'Will',
  accessToken: 'jf-token-secret',
};

function makeStore(kv = new MemoryStore()) {
  let clock = 1000;
  const store = new ConnectionStore(kv, () => (clock += 1000));
  return { kv, store };
}

function addPlex(store: ConnectionStore) {
  const account = store.addPlexAccount({ userId: 'plex-u', userName: 'will_plex', token: 'plex-account-secret', tokenKind: 'jwt' });
  const views = store.addPlexServers(account.id, [
    { machineId: 'm-1', name: 'Basement', accessToken: 'srv-secret-1', endpoints: ['https://a.plex.direct:32400'] },
    { machineId: 'm-2', name: 'Home', ownerName: 'Sam', accessToken: 'srv-secret-2', endpoints: ['https://b.plex.direct:32400'] },
  ]);
  return { account, views };
}

describe('ConnectionStore', () => {
  it('activates the first connection, but adding more leaves the active one alone', () => {
    const { store } = makeStore();
    const first = store.addJellyfin(JF);
    expect(store.getActive()?.connection.id).toBe(first.connection.id);
    addPlex(store);
    expect(store.getActive()?.connection.id).toBe(first.connection.id);
    expect(store.list()).toHaveLength(3);
  });

  it('keeps tokens out of the saved records', () => {
    const { kv, store } = makeStore();
    store.addJellyfin(JF);
    addPlex(store);
    const blob = kv.getString('anystream.connections.v2') as string;
    for (const secret of ['jf-token-secret', 'plex-account-secret', 'srv-secret-1', 'srv-secret-2']) {
      expect(blob).not.toContain(secret);
    }
    expect(store.toSession(store.list().find(v => v.server.nativeId === 'm-1')!.connection.id)?.accessToken).toBe('srv-secret-1');
  });

  it('does not duplicate a server reached at a new address, and puts the new address first', () => {
    const { store } = makeStore();
    store.addJellyfin(JF);
    store.addJellyfin({ ...JF, baseUrl: 'http://192.168.1.10:8096' });
    const views = store.list();
    expect(views).toHaveLength(1);
    expect(views[0].server.endpoints).toEqual(['http://192.168.1.10:8096', 'https://watch.example.com']);
  });

  it('keeps different servers with the same name apart', () => {
    const { store } = makeStore();
    store.addJellyfin(JF);
    store.addJellyfin({ ...JF, serverNativeId: 'jf-other' });
    expect(store.list().map(v => v.displayName)).toEqual(['Home', 'Home']);
  });

  it('adds several Plex servers under one account sign-in', () => {
    const { store } = makeStore();
    const { account, views } = addPlex(store);
    expect(store.accounts().filter(a => a.provider === 'plex')).toHaveLength(1);
    expect(views.map(v => v.account.id)).toEqual([account.id, account.id]);
    expect(views[1].server.ownerName).toBe('Sam');
    expect(store.getActive()).toBeUndefined();
  });

  it('renames on this TV only and falls back to the server’s name', () => {
    const { store } = makeStore();
    const v = store.addJellyfin(JF);
    store.rename(v.connection.id, '  Living room ');
    expect(store.get(v.connection.id)?.displayName).toBe('Living room');
    expect(store.get(v.connection.id)?.server.name).toBe('Home');
    store.rename(v.connection.id, ' ');
    expect(store.get(v.connection.id)?.displayName).toBe('Home');
  });

  it('removing one Plex server leaves the others and the account, and stops discovery re-adding it', () => {
    const { store } = makeStore();
    const { account, views } = addPlex(store);
    store.remove(views[0].connection.id);
    expect(store.list().map(v => v.server.nativeId)).toEqual(['m-2']);
    expect(store.accounts().map(a => a.id)).toContain(account.id);
    expect(store.isRemovedPlexServer('m-1')).toBe(true);
    store.addPlexServers(account.id, [{ machineId: 'm-1', name: 'Basement', accessToken: 't', endpoints: [] }]);
    expect(store.isRemovedPlexServer('m-1')).toBe(false);
  });

  it('removing the active or pinned connection clears those choices', () => {
    const { store } = makeStore();
    const v = store.addJellyfin(JF);
    store.setStartup('pinned', v.connection.id);
    store.remove(v.connection.id);
    expect(store.getActive()).toBeUndefined();
    expect(store.preferences()).toMatchObject({ startup: 'last-used', pinnedConnectionId: undefined });
  });

  it('describes and performs an account-wide sign-out', () => {
    const { kv, store } = makeStore();
    store.addJellyfin(JF);
    const { account } = addPlex(store);
    expect(store.accountImpact(account.id)?.connections.map(v => v.server.nativeId)).toEqual(['m-1', 'm-2']);
    store.signOutAccount(account.id);
    expect(store.list().map(v => v.server.provider)).toEqual(['jellyfin']);
    expect([...(kv as any).data.keys()].filter((k: string) => k.includes('plex'))).toEqual([]);
  });

  it('keeps an expired sign-in as an entry without a token', () => {
    const { store } = makeStore();
    const v = store.addJellyfin(JF);
    store.markAuthExpired(v.account.id);
    expect(store.list()).toHaveLength(1);
    expect(store.get(v.connection.id)?.account.authStatus).toBe('expired');
    expect(store.toSession(v.connection.id)).toBeUndefined();
    store.addJellyfin(JF);
    expect(store.toSession(v.connection.id)?.accessToken).toBe('jf-token-secret');
  });

  it('starts on the pinned connection, else the active one', () => {
    const { store } = makeStore();
    const a = store.addJellyfin(JF);
    const b = store.addJellyfin({ ...JF, serverNativeId: 'jf-2', serverName: 'Cabin' });
    expect(store.startupConnection()?.connection.id).toBe(a.connection.id);
    store.setStartup('pinned', b.connection.id);
    expect(store.startupConnection()?.connection.id).toBe(b.connection.id);
  });

  it('survives a reload', () => {
    const { kv, store } = makeStore();
    store.addJellyfin(JF);
    addPlex(store);
    expect(new ConnectionStore(kv).list()).toHaveLength(3);
  });

  it('namespaces per-context data by server, account and profile', () => {
    const { store } = makeStore();
    const a = store.addJellyfin(JF);
    const b = store.addJellyfin({ ...JF, serverNativeId: 'jf-2' });
    expect(contextKey(a.connection)).not.toBe(contextKey(b.connection));
  });
});

describe('migration from the single-server save', () => {
  it('turns saved Jellyfin sessions into connections and keeps the active server', () => {
    const kv = new MemoryStore();
    kv.set(
      'anystream.state.v1',
      JSON.stringify({
        deviceId: 'd',
        servers: [
          { id: 's1', kind: 'jellyfin', name: 'One', baseUrl: 'https://one' },
          { id: 's2', kind: 'jellyfin', name: 'Two', baseUrl: 'https://two' },
        ],
        sessions: {
          s1: { server: { id: 's1' }, userId: 'u1', userName: 'a', accessToken: 'tok1' },
          s2: { server: { id: 's2' }, userId: 'u2', userName: 'b', accessToken: 'tok2' },
        },
        activeServerId: 's2',
      }),
    );
    const store = new ConnectionStore(kv);
    expect(store.list()).toHaveLength(2);
    const active = store.getActive()!;
    expect(active.server.nativeId).toBe('s2');
    expect(store.toSession(active.connection.id)).toMatchObject({ server: { id: 's2', baseUrl: 'https://two' }, accessToken: 'tok2' });
    expect(kv.getString('anystream.state.v1')).toBeDefined();
  });

  it('keeps a server whose sign-in had expired, ready for Sign in again', () => {
    const kv = new MemoryStore();
    kv.set(
      'anystream.state.v1',
      JSON.stringify({
        deviceId: 'd',
        servers: [{ id: 's1', kind: 'jellyfin', name: 'One', baseUrl: 'https://one' }],
        sessions: {},
        activeServerId: 's1',
        lastUserNames: { s1: 'will' },
      }),
    );
    const store = new ConnectionStore(kv);
    const v = store.getActive()!;
    expect(v.account.authStatus).toBe('expired');
    expect(v.connection.profileName).toBe('will');
  });

  it('starts empty with no legacy save, and ignores a damaged one', () => {
    expect(new ConnectionStore(new MemoryStore()).list()).toEqual([]);
    const kv = new MemoryStore();
    kv.set('anystream.state.v1', '{nope');
    expect(new ConnectionStore(kv).list()).toEqual([]);
  });
});

describe('ContextCoordinator', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('commits only after check and prepare succeed', async () => {
    const committed: string[] = [];
    const c = new ContextCoordinator<string>({
      check: async () => undefined,
      prepare: async id => `data-${id}`,
      commit: id => committed.push(id),
    });
    const result = await c.switchTo('a');
    expect(result).toMatchObject({ outcome: 'switched', context: { connectionId: 'a', data: 'data-a' } });
    expect(committed).toEqual(['a']);
  });

  it('prepares the destination title before committing, and commits nothing if it has gone', async () => {
    const committed: string[] = [];
    const c = new ContextCoordinator<string>({
      check: async () => undefined,
      prepare: async id => `data-${id}`,
      commit: id => committed.push(id),
    });
    await c.switchTo('a');
    const gone = await c.switchTo('b', async () => {
      throw new Error('not found');
    });
    expect(gone.outcome).toBe('failed');
    expect(c.current()?.connectionId).toBe('a');
    expect(committed).toEqual(['a']);
    const seen: string[] = [];
    const ok = await c.switchTo('b', async data => {
      seen.push(data);
    });
    expect(ok.outcome).toBe('switched');
    expect(seen).toEqual(['data-b']);
    expect(committed).toEqual(['a', 'b']);
  });

  it('a switch cancelled while its title is prepared changes nothing', async () => {
    const title = deferred<void>();
    const c = new ContextCoordinator<string>({ check: async () => undefined, prepare: async id => id });
    await c.switchTo('a');
    const pending = c.switchTo('b', () => title.promise);
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    c.cancel();
    title.resolve();
    expect(await pending).toEqual({ outcome: 'superseded' });
    expect(c.current()?.connectionId).toBe('a');
  });

  it('a failed switch leaves the current context in place', async () => {
    const c = new ContextCoordinator<string>({
      check: async id => {
        if (id === 'b') {
          throw new Error('offline');
        }
      },
      prepare: async id => id,
    });
    await c.switchTo('a');
    const before = c.current();
    const result = await c.switchTo('b');
    expect(result.outcome).toBe('failed');
    expect(c.current()).toBe(before);
    expect(c.currentPhase()).toBe('failed');
  });

  it('a newer switch supersedes an older one that finishes late', async () => {
    const slow = deferred<string>();
    const c = new ContextCoordinator<string>({
      check: async () => undefined,
      prepare: id => (id === 'slow' ? slow.promise : Promise.resolve(id)),
    });
    const first = c.switchTo('slow');
    await Promise.resolve();
    const second = await c.switchTo('fast');
    slow.resolve('slow');
    expect(await first).toEqual({ outcome: 'superseded' });
    expect(second.outcome).toBe('switched');
    expect(c.current()?.connectionId).toBe('fast');
  });

  it('cancelling aborts the switch and keeps the current context', async () => {
    let seen: AbortSignal | undefined;
    const c = new ContextCoordinator<string>({
      check: (_id, signal) => {
        seen = signal;
        return new Promise(() => undefined);
      },
      prepare: async id => id,
    });
    const pending = c.switchTo('x');
    c.cancel();
    expect(seen?.aborted).toBe(true);
    expect(c.current()).toBeUndefined();
    void pending;
  });

  it('work started under an old context cannot apply after a switch', async () => {
    const c = new ContextCoordinator<string>({ check: async () => undefined, prepare: async id => id });
    await c.switchTo('a');
    const gen = c.current()!.generation;
    await c.switchTo('b');
    const applied: string[] = [];
    expect(c.ifCurrent(gen, () => applied.push('late'))).toBe(false);
    expect(applied).toEqual([]);
    expect(c.isCurrent(c.current()!.generation)).toBe(true);
  });
});

describe('relinking Plex', () => {
  it('gives saved servers their fresh tokens without adding new ones', () => {
    const { store } = makeStore();
    const { account, views } = addPlex(store);
    store.markAuthExpired(account.id);
    store.addPlexAccount({ userId: 'plex-u', userName: 'will_plex', token: 'new-account', tokenKind: 'legacy' });
    store.refreshPlexServers(account.id, [
      { machineId: 'm-1', name: 'Basement', accessToken: 'new-srv-1', endpoints: ['https://plex.example.com:443'] },
      { machineId: 'm-9', name: 'Not saved', accessToken: 'x', endpoints: [] },
    ]);
    expect(store.list()).toHaveLength(2);
    const session = store.toSession(views[0].connection.id);
    expect(session?.accessToken).toBe('new-srv-1');
    // The address that already worked stays first; the new one is a fallback.
    expect(store.get(views[0].connection.id)?.server.endpoints).toEqual(['https://a.plex.direct:32400', 'https://plex.example.com:443']);
  });
});

describe('Plex Home profile on a connection', () => {
  it('browses as the chosen profile with its own token, and a relink does not overwrite it', () => {
    const { store } = makeStore();
    const { account, views } = addPlex(store);
    const id = views[0].connection.id;
    const before = contextKey(store.get(id)!.connection);
    store.setPlexProfile(id, { profileId: 'kid', profileName: 'Kid', serverToken: 'kid-srv' });
    expect(store.toSession(id)).toMatchObject({ userId: 'kid', userName: 'Kid', accessToken: 'kid-srv' });
    expect(contextKey(store.get(id)!.connection)).not.toBe(before);
    store.refreshPlexServers(account.id, [{ machineId: 'm-1', name: 'Basement', accessToken: 'owner-srv', endpoints: [] }]);
    expect(store.toSession(id)?.accessToken).toBe('kid-srv');
  });
});
