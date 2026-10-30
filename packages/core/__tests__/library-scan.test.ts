import { ConnectionStore } from '../src/connections/connectionStore';
import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import { createEmbyProvider } from '../src/providers/emby';
import { createJellyfinProvider } from '../src/providers/jellyfin';
import { JellyfinError } from '../src/providers/jellyfin/errors';
import { createPlexProvider } from '../src/providers/plex';
import { PlexError } from '../src/providers/plex/errors';
import type { Session } from '../src/providers/types';
import { managerActions, scanFailure, scanStatusText } from '../src/servers';
import { MemoryStore } from '../src/storage/keyValueStore';
import { DEVICE, SESSION, fakeFetch } from './helpers/fakes';

const PLEX_SESSION: Session = {
  server: { id: 'machine-1', kind: 'plex', name: 'Test Plex', baseUrl: 'http://192.168.1.169:32400' },
  userId: 'u-1',
  userName: 'will',
  accessToken: 'server-token',
};

const EMBY_SESSION: Session = { ...SESSION, server: { ...SESSION.server, kind: 'emby', baseUrl: 'http://192.168.1.179:8096' } };

describe('Jellyfin and Emby library scans', () => {
  it('offers scanning to administrators only', async () => {
    const admin = fakeFetch(() => ({ body: { Id: 'user-1', Policy: { IsAdministrator: true } } }));
    expect(await createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, admin.fetchImpl).canScanLibraries()).toBe(true);
    expect(admin.calls[0].url).toBe('https://watch.example.com/Users/user-1');

    const viewer = fakeFetch(() => ({ body: { Id: 'user-1', Policy: { IsAdministrator: false } } }));
    expect(await createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, viewer.fetchImpl).canScanLibraries()).toBe(false);

    const noPolicy = fakeFetch(() => ({ body: { Id: 'user-1' } }));
    expect(await createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, noPolicy.fetchImpl).canScanLibraries()).toBe(false);
  });

  it('reads a refusal as no, but still rejects when the server cannot be reached', async () => {
    const refused = fakeFetch(() => ({ status: 403 }));
    expect(await createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, refused.fetchImpl).canScanLibraries()).toBe(false);
    const offline = fakeFetch(() => 'throw');
    await expect(createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, offline.fetchImpl).canScanLibraries()).rejects.toMatchObject({ kind: 'network' });
  });

  it('scans every library, or one library without replacing metadata or images', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 204 }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    await provider.scanLibraries();
    await provider.scanLibraries('lib-movies');
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://watch.example.com/Library/Refresh',
      'POST https://watch.example.com/Items/lib-movies/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false&ReplaceAllImages=false',
    ]);
  });

  it('uses the same calls on Emby, with Emby headers', async () => {
    const { calls, fetchImpl } = fakeFetch(call => (call.method === 'GET' ? { body: { Policy: { IsAdministrator: true } } } : { status: 204 }));
    const provider = createEmbyProvider(EMBY_SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    expect(await provider.canScanLibraries()).toBe(true);
    await provider.scanLibraries();
    expect(calls[1].url).toBe('http://192.168.1.179:8096/Library/Refresh');
    expect(calls[1].headers['X-Emby-Token']).toBe('token-abc');
  });

  it('passes a refused scan on as a refusal', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 403 }));
    await expect(createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl).scanLibraries()).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('Plex library scans', () => {
  it('offers scanning only when the token may read server settings (the owner)', async () => {
    const owner = fakeFetch(() => ({ body: { MediaContainer: { size: 1 } } }));
    expect(await createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, owner.fetchImpl).canScanLibraries()).toBe(true);
    expect(owner.calls[0].url).toBe('http://192.168.1.169:32400/:/prefs');

    for (const status of [401, 403]) {
      const shared = fakeFetch(() => ({ status }));
      expect(await createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, shared.fetchImpl).canScanLibraries()).toBe(false);
    }
    const offline = fakeFetch(() => 'throw');
    await expect(createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, offline.fetchImpl).canScanLibraries()).rejects.toMatchObject({ kind: 'network' });
  });

  it('scans every section, or one', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ text: '' }));
    const provider = createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    await provider.scanLibraries();
    await provider.scanLibraries('3');
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'GET http://192.168.1.169:32400/library/sections/all/refresh',
      'GET http://192.168.1.169:32400/library/sections/3/refresh',
    ]);
  });
});

describe('scan in the server manager', () => {
  function store() {
    const s = new ConnectionStore(new MemoryStore());
    const jf = s.addJellyfin({ serverNativeId: 'jf-1', serverName: 'Home', baseUrl: 'https://jf.example.com', userId: 'u1', userName: 'Will', accessToken: 'jf-tok' });
    return { s, jf };
  }

  it('shows Scan only when allowed and the server is online', () => {
    const { s, jf } = store();
    const view = s.get(jf.connection.id)!;
    expect(managerActions(view, 'online')).not.toContain('scan');
    expect(managerActions(view, 'online', true)).toEqual(['scan', 'rename', 'startup', 'remove']);
    expect(managerActions(view, 'unavailable', true)).not.toContain('scan');
    expect(managerActions(view, 'auth-required', true)).not.toContain('scan');
  });

  it('says whether the scan started, was refused or could not be sent', () => {
    expect(scanFailure(new JellyfinError('unauthorized', 'x', 403))).toBe('refused');
    expect(scanFailure(new PlexError('forbidden', 'x', 403))).toBe('refused');
    expect(scanFailure(new PlexError('network', 'x'))).toBe('failed');
    expect(scanStatusText('started', undefined, 'Home')).toBe('Home is scanning every library. New titles appear when it finishes.');
    expect(scanStatusText('started', 'Movies', 'Home')).toBe('Home is scanning Movies. New titles appear when it finishes.');
    expect(scanStatusText('refused', 'Movies', 'Home')).toContain("Only the server's administrator");
  });
});
