import { MemoryStore } from '../src/storage/keyValueStore';
import { SessionStore } from '../src/storage/sessionStore';
import {
  DEFAULT_CAPABILITIES,
  probeCapabilities,
  type DecodingInfoFn,
} from '../src/player/capabilities';
import { SESSION } from './helpers/fakes';

describe('SessionStore', () => {
  it('creates a stable device id and keeps it across restarts', () => {
    const backing = new MemoryStore();
    const first = new SessionStore(backing).getDeviceId();
    const second = new SessionStore(backing).getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it('saves a sign-in, makes it active, and survives a restart', () => {
    const backing = new MemoryStore();
    new SessionStore(backing).saveSession(SESSION);

    const reloaded = new SessionStore(backing);
    expect(reloaded.getActiveSession()).toEqual(SESSION);
    expect(reloaded.listServers()).toEqual([SESSION.server]);
  });

  it('replaces a server rather than duplicating it when signing in again', () => {
    const store = new SessionStore(new MemoryStore());
    store.saveSession(SESSION);
    store.saveSession({ ...SESSION, accessToken: 'newer' });
    expect(store.listServers()).toHaveLength(1);
    expect(store.getSession(SESSION.server.id)?.accessToken).toBe('newer');
  });

  it('switches the active server and ignores unknown ids', () => {
    const store = new SessionStore(new MemoryStore());
    const other = { ...SESSION, server: { ...SESSION.server, id: 'server-2', name: 'Other' } };
    store.saveSession(SESSION);
    store.saveSession(other);
    expect(store.getActiveSession()?.server.id).toBe('server-2');

    store.setActiveServer('server-1');
    expect(store.getActiveSession()?.server.id).toBe('server-1');
    store.setActiveServer('nope');
    expect(store.getActiveSession()?.server.id).toBe('server-1');
  });

  it('removes a server and its token, falling back to another', () => {
    const store = new SessionStore(new MemoryStore());
    const other = { ...SESSION, server: { ...SESSION.server, id: 'server-2' } };
    store.saveSession(SESSION);
    store.saveSession(other);

    store.removeServer('server-2');
    expect(store.getSession('server-2')).toBeUndefined();
    expect(store.getActiveSession()?.server.id).toBe('server-1');

    store.removeServer('server-1');
    expect(store.getActiveSession()).toBeUndefined();
    expect(store.listServers()).toEqual([]);
  });

  it('recovers from corrupt stored data with a fresh state', () => {
    const backing = new MemoryStore();
    backing.set('anystream.state.v1', '{not json');
    const store = new SessionStore(backing);
    expect(store.getActiveSession()).toBeUndefined();
    expect(store.getDeviceId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('probeCapabilities', () => {
  const supportsOnly =
    (...needles: string[]): DecodingInfoFn =>
    async config => {
      const type = config.video?.contentType ?? config.audio?.contentType ?? '';
      return { supported: needles.some(n => type.includes(n)) };
    };

  it('returns the defaults when no probe is available', async () => {
    expect(await probeCapabilities(undefined)).toEqual(DEFAULT_CAPABILITIES);
  });

  it('drops video codecs the device says it cannot decode', async () => {
    const caps = await probeCapabilities(supportsOnly('avc1', 'mp4a', 'ac-3'));
    expect(caps.videoCodecs).toEqual(['h264']);
  });

  it('keeps the audio list whatever the probe says, since the stick wrongly rejects AAC', async () => {
    const caps = await probeCapabilities(supportsOnly('avc1', 'hvc1', 'mpeg'));
    expect(caps.audioCodecs).toEqual(DEFAULT_CAPABILITIES.audioCodecs);
  });

  it('never adds anything beyond the defaults', async () => {
    const caps = await probeCapabilities(async () => ({ supported: true }));
    expect(caps).toEqual(DEFAULT_CAPABILITIES);
  });

  it('keeps the defaults for a media type if the probe would leave nothing', async () => {
    const caps = await probeCapabilities(async () => ({ supported: false }));
    expect(caps.videoCodecs).toEqual(DEFAULT_CAPABILITIES.videoCodecs);
  });

  it('treats a throwing probe as "not supported"', async () => {
    const caps = await probeCapabilities(async config => {
      if (config.video?.contentType.includes('hvc1')) {
        throw new Error('probe failed');
      }
      return { supported: true };
    });
    expect(caps.videoCodecs).toEqual(['h264']);
  });

  it('leaves HLS audio and direct-play containers alone', async () => {
    const caps = await probeCapabilities(supportsOnly('avc1'));
    expect(caps.hlsAudioCodecs).toEqual(['aac']);
    expect(caps.directPlayContainers).toEqual(['mp4', 'm4v', 'mkv']);
  });

  it('stops the server copying video the device cannot decode, keeping H.264 as the encode target', async () => {
    expect((await probeCapabilities(supportsOnly('avc1', 'mp4a'))).hlsVideoCodecs).toEqual(['h264']);
    expect((await probeCapabilities(supportsOnly('hvc1', 'mp4a'))).hlsVideoCodecs).toEqual(['h264', 'hevc']);
  });
});
