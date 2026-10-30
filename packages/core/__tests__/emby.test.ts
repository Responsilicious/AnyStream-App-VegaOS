import { connectProblem, connectStatus, signInError } from '../src/connect';
import { ConnectionStore } from '../src/connections/connectionStore';
import { checkConnection } from '../src/connections/status';
import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import { createProvider } from '../src/providers/create';
import { createEmbyProvider, fetchPublicUsers, initials } from '../src/providers/emby';
import { httpForServer, identifyServer, probeServer, serverProduct, signInWithPassword } from '../src/providers/jellyfin';
import { JellyfinError } from '../src/providers/jellyfin/errors';
import type { ServerRecord, Session } from '../src/providers/types';
import { providerName } from '../src/servers';
import { MemoryStore } from '../src/storage/keyValueStore';
import { DEVICE, fakeFetch } from './helpers/fakes';

const EMBY_INFO = { Id: 'emby-1', ServerName: 'Home Cinema', Version: '4.8.10.0' };
const JELLYFIN_INFO = { Id: 'jf-1', ServerName: 'Home', Version: '10.10.3', ProductName: 'Jellyfin Server' };

const EMBY: ServerRecord = { id: 'emby-1', kind: 'emby', name: 'Home Cinema', baseUrl: 'http://192.168.1.20:8096' };
const EMBY_SESSION: Session = { server: EMBY, userId: 'u-alex', userName: 'Alex', accessToken: 'emby-token' };

describe('serverProduct', () => {
  it('tells Jellyfin from Emby by product name, then version', () => {
    expect(serverProduct(JELLYFIN_INFO)).toBe('jellyfin');
    expect(serverProduct({ Id: 'x', ServerName: 'x', Version: '10.8.0' })).toBe('jellyfin');
    expect(serverProduct(EMBY_INFO)).toBe('emby');
    expect(serverProduct({ ...EMBY_INFO, ProductName: 'Emby Server' })).toBe('emby');
    expect(serverProduct({ Id: 'x', ServerName: 'x', Version: '' })).toBeNull();
  });
});

describe('Emby headers', () => {
  it('sends the client header and token the way Emby reads them, and Jellyfin keeps its own', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: {} }));
    await httpForServer(EMBY, DEVICE, 'emby-token', fetchImpl).get('/Users/u-alex');
    expect(calls[0].headers['X-Emby-Authorization']).toBe('Emby Client="AnyStream", Device="Fire TV", DeviceId="device-1", Version="0.1.0"');
    expect(calls[0].headers['X-Emby-Token']).toBe('emby-token');
    expect(calls[0].headers.Authorization).toBeUndefined();

    await httpForServer({ kind: 'jellyfin', baseUrl: 'https://watch.example.com' }, DEVICE, 'jf-token', fetchImpl).get('/Users/u');
    expect(calls[1].headers.Authorization).toContain('Token="jf-token"');
    expect(calls[1].headers['X-Emby-Token']).toBeUndefined();
  });

  it('never sends a token before sign-in', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: EMBY_INFO }));
    await probeServer('http://192.168.1.20:8096', DEVICE, { fetchImpl, product: 'emby' });
    expect(calls[0].headers['X-Emby-Token']).toBeUndefined();
  });
});

describe('probeServer for Emby', () => {
  it('uses the address as typed when Emby answers there', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: EMBY_INFO }));
    const result = await probeServer('http://192.168.1.20:8096', DEVICE, { fetchImpl, product: 'emby' });
    expect(result.baseUrl).toBe('http://192.168.1.20:8096');
    expect(result.product).toBe('emby');
    expect(calls).toHaveLength(1);
  });

  it('falls back to the /emby API path when only that answers', async () => {
    const { calls, fetchImpl } = fakeFetch(call => (call.url.includes('/emby/') ? { body: EMBY_INFO } : { status: 404 }));
    const result = await probeServer('https://media.example.com', DEVICE, { fetchImpl, product: 'emby' });
    expect(result.baseUrl).toBe('https://media.example.com/emby');
    expect(calls.map(c => c.url)).toEqual(['https://media.example.com/System/Info/Public', 'https://media.example.com/emby/System/Info/Public']);
  });

  it('also tries /emby when the root serves a web page instead of the API', async () => {
    const { fetchImpl } = fakeFetch(call => (call.url.includes('/emby/') ? { body: EMBY_INFO } : { text: '<html>Emby</html>' }));
    await expect(probeServer('https://media.example.com', DEVICE, { fetchImpl, product: 'emby' })).resolves.toMatchObject({
      baseUrl: 'https://media.example.com/emby',
    });
  });

  it('never doubles a path the person already typed', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 404 }));
    await expect(probeServer('https://media.example.com/emby', DEVICE, { fetchImpl, product: 'emby' })).rejects.toBeInstanceOf(JellyfinError);
    expect(calls.map(c => c.url)).toEqual(['https://media.example.com/emby/System/Info/Public']);
  });

  it('keeps a custom path and port', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: EMBY_INFO }));
    await probeServer('https://example.com:8920/Media', DEVICE, { fetchImpl, product: 'emby' });
    expect(calls[0].url).toBe('https://example.com:8920/Media/System/Info/Public');
  });

  it('does not ask /emby when nothing answers at all', async () => {
    const { calls, fetchImpl } = fakeFetch(() => 'throw');
    await expect(probeServer('https://media.example.com', DEVICE, { fetchImpl, product: 'emby' })).rejects.toMatchObject({ kind: 'network' });
    expect(calls.every(c => !c.url.includes('/emby/'))).toBe(true);
  });

  it('refuses a Jellyfin server on the Emby screen, naming what it is', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: JELLYFIN_INFO }));
    const error = await probeServer('https://watch.example.com', DEVICE, { fetchImpl, product: 'emby' }).catch(e => e);
    expect(error).toMatchObject({ kind: 'wrong-product', detected: 'jellyfin' });
    expect(connectProblem(error)).toBe('wrong-product');
    expect(connectStatus('wrong-product', undefined, 'emby', 'jellyfin').title).toBe('That address is a Jellyfin server');
  });

  it('refuses an Emby server on the Jellyfin screen too', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: EMBY_INFO }));
    await expect(probeServer('http://192.168.1.20:8096', DEVICE, { fetchImpl })).rejects.toMatchObject({ kind: 'wrong-product', detected: 'emby' });
  });
});

describe('identifyServer', () => {
  it('reports which product answered, and asks /emby only after a 404', async () => {
    const emby = fakeFetch(call => (call.url.includes('/emby/') ? { body: EMBY_INFO } : { status: 404 }));
    await expect(identifyServer('http://10.0.0.5:8096', DEVICE, { fetchImpl: emby.fetchImpl })).resolves.toEqual({
      id: 'emby-1',
      name: 'Home Cinema',
      address: 'http://10.0.0.5:8096/emby',
      product: 'emby',
    });
    const nothing = fakeFetch(() => 'throw');
    await expect(identifyServer('http://10.0.0.6:8096', DEVICE, { fetchImpl: nothing.fetchImpl })).rejects.toBeDefined();
    expect(nothing.calls).toHaveLength(1);
  });
});

describe('Emby public users', () => {
  it('lists the users the server shows, with a resized picture where there is one', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: [
        { Id: 'u-alex', Name: 'Alex', HasPassword: true, PrimaryImageTag: 'tag1' },
        { Id: 'u-guest', Name: 'Guest', HasPassword: false },
        { Id: 'u-bad' },
        { Name: 'No id' },
      ],
    }));
    const users = await fetchPublicUsers(EMBY, DEVICE, { fetchImpl });
    expect(calls[0].url).toBe('http://192.168.1.20:8096/Users/Public');
    expect(users).toEqual([
      { id: 'u-alex', name: 'Alex', hasPassword: true, imageUrl: 'http://192.168.1.20:8096/Users/u-alex/Images/Primary?tag=tag1&maxWidth=240&quality=90' },
      { id: 'u-guest', name: 'Guest', hasPassword: false, imageUrl: undefined },
    ]);
  });

  it('treats a refusal or an odd answer as no list, so the sign-in form opens', async () => {
    await expect(fetchPublicUsers(EMBY, DEVICE, { fetchImpl: fakeFetch(() => ({ status: 401 })).fetchImpl })).resolves.toEqual([]);
    await expect(fetchPublicUsers(EMBY, DEVICE, { fetchImpl: fakeFetch(() => ({ body: { Items: [] } })).fetchImpl })).resolves.toEqual([]);
  });

  it('still rejects when cancelled', async () => {
    const controller = new AbortController();
    const promise = fetchPublicUsers(EMBY, DEVICE, { fetchImpl: fakeFetch(() => 'hang').fetchImpl, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('makes initials for users without a picture', () => {
    expect(initials('Alex')).toBe('AL');
    expect(initials('Media Room')).toBe('MR');
    expect(initials('  ')).toBe('');
  });
});

describe('Emby sign-in', () => {
  it('sends the name and password once, exactly as typed, in the body', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { AccessToken: 'tok', User: { Id: 'u-alex', Name: 'Alex' }, ServerId: 'emby-1' } }));
    const session = await signInWithPassword(httpForServer(EMBY, DEVICE, undefined, fetchImpl), EMBY, 'Alex ', 'pä ss', undefined);
    expect(calls[0].url).toBe('http://192.168.1.20:8096/Users/AuthenticateByName');
    expect(calls[0].url).not.toContain('pä');
    expect(calls[0].body).toEqual({ Username: 'Alex ', Pw: 'pä ss' });
    expect(session).toEqual({ server: EMBY, userId: 'u-alex', userName: 'Alex', accessToken: 'tok' });
  });

  it('allows an empty password, and does not accept a token without a user', async () => {
    const empty = fakeFetch(() => ({ body: { AccessToken: 'tok', User: { Id: 'u-guest', Name: 'Guest' } } }));
    await signInWithPassword(httpForServer(EMBY, DEVICE, undefined, empty.fetchImpl), EMBY, 'Guest', '');
    expect(empty.calls[0].body).toEqual({ Username: 'Guest', Pw: '' });

    const noUser = fakeFetch(() => ({ body: { AccessToken: 'tok' } }));
    await expect(signInWithPassword(httpForServer(EMBY, DEVICE, undefined, noUser.fetchImpl), EMBY, 'x', 'y')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('uses the Emby spec wording for a refused sign-in', () => {
    expect(signInError(new JellyfinError('unauthorized', 'no', 401), 'Home Cinema', 'emby')).toBe('Sign-in failed. Check your server username and password.');
    expect(signInError(new JellyfinError('network', 'no'), 'Home Cinema', 'emby')).toBe('Could not reach Home Cinema. Check your network, then try again.');
  });
});

describe('Emby provider', () => {
  it('is an Emby provider that browses with Emby headers under the saved API base', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { Items: [] } }));
    const server = { ...EMBY, baseUrl: 'https://media.example.com/emby' };
    const provider = createProvider({ ...EMBY_SESSION, server }, DEVICE, DEFAULT_CAPABILITIES);
    expect(provider.kind).toBe('emby');
    // createProvider uses the real fetch; build the same provider with the fake to see the requests.
    await createEmbyProvider({ ...EMBY_SESSION, server }, DEVICE, DEFAULT_CAPABILITIES, fetchImpl).getLibraries();
    expect(calls[0].url).toBe('https://media.example.com/emby/Users/u-alex/Views');
    expect(calls[0].headers['X-Emby-Token']).toBe('emby-token');
  });

  it('plays a transcode from the API base with the token on every segment', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      body: {
        PlaySessionId: 'ps1',
        MediaSources: [{ Id: 'src1', Container: 'mkv', SupportsDirectPlay: false, TranscodingUrl: '/videos/i1/master.m3u8?MediaSourceId=src1' }],
      },
    }));
    const server = { ...EMBY, baseUrl: 'https://media.example.com/emby' };
    const decision = await createEmbyProvider({ ...EMBY_SESSION, server }, DEVICE, DEFAULT_CAPABILITIES, fetchImpl).getPlayback('i1');
    expect(decision.mode).toBe('hls');
    expect(decision.url).toBe('https://media.example.com/emby/videos/i1/master.m3u8?MediaSourceId=src1&api_key=emby-token');
  });
});

describe('saved Emby servers', () => {
  const SIGN_IN = {
    provider: 'emby' as const,
    serverNativeId: 'shared-id',
    serverName: 'Home Cinema',
    baseUrl: 'http://192.168.1.20:8096',
    userId: 'u-alex',
    userName: 'Alex',
    accessToken: 'emby-secret',
  };

  it('saves under its own provider, apart from a Jellyfin server with the same id', () => {
    const store = new ConnectionStore(new MemoryStore());
    const jf = store.addJellyfin({ ...SIGN_IN, provider: undefined, accessToken: 'jf-secret' });
    const emby = store.addJellyfin(SIGN_IN);
    expect(emby.server.id).toBe('emby:shared-id');
    expect(emby.account.id).toBe('emby:shared-id:u-alex');
    expect(jf.server.id).toBe('jellyfin:shared-id');
    expect(store.list()).toHaveLength(2);
    expect(store.toSession(emby.connection.id)?.server.kind).toBe('emby');
    expect(providerName(emby.server.provider)).toBe('Emby');
  });

  it('signing in again as the same user refreshes the entry instead of adding one', () => {
    const store = new ConnectionStore(new MemoryStore());
    store.addJellyfin(SIGN_IN);
    store.addJellyfin({ ...SIGN_IN, accessToken: 'new-secret', baseUrl: 'https://media.example.com/emby' });
    expect(store.list()).toHaveLength(1);
    const view = store.list()[0];
    expect(store.getSecret(view.connection.credentialRef)).toBe('new-secret');
    expect(view.server.endpoints[0]).toBe('https://media.example.com/emby');
  });

  it('a refused token clears only that Emby sign-in', () => {
    const store = new ConnectionStore(new MemoryStore());
    const jf = store.addJellyfin({ ...SIGN_IN, provider: undefined, accessToken: 'jf-secret' });
    const emby = store.addJellyfin(SIGN_IN);
    store.markAuthExpired(emby.account.id);
    expect(store.getSecret(emby.connection.credentialRef)).toBeUndefined();
    expect(store.getSecret(jf.connection.credentialRef)).toBe('jf-secret');
    expect(store.list()).toHaveLength(2);
  });

  it('keeps no token in the saved records', () => {
    const kv = new MemoryStore();
    new ConnectionStore(kv).addJellyfin(SIGN_IN);
    expect(kv.getString('anystream.connections.v2')).not.toContain('emby-secret');
  });

  it('checks a saved Emby server with its own headers', async () => {
    const store = new ConnectionStore(new MemoryStore());
    const view = store.addJellyfin(SIGN_IN);
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { Id: 'u-alex' } }));
    await expect(checkConnection(store, view.connection.id, DEVICE, undefined, fetchImpl)).resolves.toMatchObject({ status: 'online' });
    expect(calls[0].url).toBe('http://192.168.1.20:8096/Users/u-alex');
    expect(calls[0].headers['X-Emby-Token']).toBe('emby-secret');

    const refused = fakeFetch(() => ({ status: 401 }));
    await expect(checkConnection(store, view.connection.id, DEVICE, undefined, refused.fetchImpl)).resolves.toMatchObject({ status: 'auth-required' });
  });
});

describe('Emby connect wording', () => {
  it('follows the spec copy table', () => {
    expect(connectStatus('unavailable', undefined, 'emby').title).toBe('Could not reach this server');
    expect(connectStatus('certificate', undefined, 'emby').title).toBe('Could not verify the secure connection');
    expect(connectStatus('not-jellyfin', undefined, 'emby').title).toBe('This address could not be used as an Emby server');
    expect(connectStatus('invalid', 'Enter the server address.', 'emby')).toMatchObject({ title: 'Check the server address', detail: 'Enter the server address.' });
    // Jellyfin's wording is unchanged.
    expect(connectStatus('not-jellyfin').title).toBe('Address does not point to a Jellyfin server');
  });
});
