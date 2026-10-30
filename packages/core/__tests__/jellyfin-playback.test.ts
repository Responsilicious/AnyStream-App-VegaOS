import { JellyfinHttp } from '../src/providers/jellyfin/http';
import { createJellyfinProvider } from '../src/providers/jellyfin';
import { mapItem } from '../src/providers/jellyfin/items';
import { getPlaybackDecision, reportStopped, stopTranscode } from '../src/providers/jellyfin/playback';
import { toJellyfinProfile } from '../src/providers/jellyfin/deviceProfile';
import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import type { MediaItem, PlaybackDecision } from '../src/providers/types';
import { DEVICE, SERVER, SESSION, fakeFetch, type Reply } from './helpers/fakes';

function httpWith(reply: (url: string) => Reply) {
  const fake = fakeFetch(call => reply(call.url));
  const http = new JellyfinHttp(SERVER.baseUrl, DEVICE, 'tok', fake.fetchImpl);
  return { ...fake, http };
}

const MP4_SOURCE = {
  Id: 'src1',
  Container: 'mp4',
  ETag: 'etag1',
  RunTimeTicks: 72000000000,
  SupportsDirectPlay: true,
  SupportsDirectStream: true,
  SupportsTranscoding: true,
  TranscodingUrl: '/videos/item1/master.m3u8?MediaSourceId=src1',
};

const AVI_SOURCE = {
  Id: 'src2',
  Container: 'avi',
  RunTimeTicks: 36000000000,
  SupportsDirectPlay: true,
  SupportsDirectStream: true,
  SupportsTranscoding: true,
  TranscodingUrl: '/videos/item2/master.m3u8?MediaSourceId=src2&api_key=tok',
};

describe('getPlaybackDecision', () => {
  it('direct plays an MP4 over a plain URL', async () => {
    const { http } = httpWith(() => ({ body: { MediaSources: [MP4_SOURCE], PlaySessionId: 'ps1' } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1');

    expect(decision.mode).toBe('url');
    expect(decision.method).toBe('DirectPlay');
    expect(decision.mediaSourceId).toBe('src1');
    expect(decision.playSessionId).toBe('ps1');
    expect(decision.durationMs).toBe(7200000);
    expect(decision.url).toContain('https://watch.example.com/Videos/item1/stream?');
    expect(decision.url).toContain('static=true');
    expect(decision.url).toContain('mediaSourceId=src1');
    expect(decision.url).toContain('api_key=tok');
    expect(decision.url).toContain('Tag=etag1');
    expect(decision.url).toContain('deviceId=device-1');
  });

  it('direct plays an MKV the server allows', async () => {
    const mkv = { ...AVI_SOURCE, Container: 'mkv' };
    const { http } = httpWith(() => ({ body: { MediaSources: [mkv], PlaySessionId: 'ps3' } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item2');

    expect(decision.mode).toBe('url');
    expect(decision.method).toBe('DirectPlay');
    expect(decision.url).toContain('static=true');
  });

  it('skips direct play on a plain http server when URL mode needs https', async () => {
    const fake = fakeFetch(() => ({ body: { MediaSources: [MP4_SOURCE], PlaySessionId: 'ps1' } }));
    const http = new JellyfinHttp('http://192.168.1.3:8096', DEVICE, 'tok', fake.fetchImpl);
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1');

    expect(decision.mode).toBe('hls');
    expect(fake.calls[0].body.EnableDirectPlay).toBe(false);
    expect(fake.calls[0].body.EnableDirectStream).toBe(true);
    const opens = await getPlaybackDecision(http, 'u1', { ...DEFAULT_CAPABILITIES, directPlayNeedsHttps: false }, 'item1');
    expect(opens.mode).toBe('url');
  });

  it('streams an MKV over HLS when another audio track is chosen, letting the server copy the video', async () => {
    const mkv = { ...AVI_SOURCE, Container: 'mkv' };
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [mkv], PlaySessionId: 'ps3' } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item2', { audioIndex: 2, mediaSourceId: 'src2' });

    expect(decision.mode).toBe('hls');
    expect(calls[0].body.EnableDirectPlay).toBe(false);
    expect(calls[0].body.EnableDirectStream).toBe(true);
    expect(calls[0].body.AudioStreamIndex).toBe(2);
    expect(calls[0].body.DeviceProfile.TranscodingProfiles[0]).toMatchObject({ Container: 'mp4', VideoCodec: 'h264,hevc' });
  });

  it('sends the device profile, user and start position to the server', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [MP4_SOURCE] } }));
    await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1', { startMs: 90000 });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://watch.example.com/Items/item1/PlaybackInfo?UserId=u1&SubtitleStreamIndex=-1');
    expect(calls[0].body.UserId).toBe('u1');
    expect(calls[0].body.StartTimeTicks).toBe(900000000);
    expect(calls[0].body.EnableDirectPlay).toBe(true);
    expect(calls[0].body.DeviceProfile.Name).toBe('AnyStream (Vega)');
    expect(calls[0].headers.Authorization).toContain('Token="tok"');
  });

  it('keeps H.264 at 1080p 8-bit, so a 4K file is not transcoded to 4K H.264', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [MP4_SOURCE] } }));
    await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1');

    const profiles = calls[0].body.DeviceProfile.CodecProfiles as Array<{ Codec: string; Conditions: any[] }>;
    const value = (codec: string, property: string) =>
      profiles.find(p => p.Codec === codec)?.Conditions.find(c => c.Property === property)?.Value;
    expect(value('h264', 'Width')).toBe('1920');
    expect(value('h264', 'Height')).toBe('1080');
    expect(value('h264', 'VideoBitDepth')).toBe('8');
    expect(value('hevc', 'Width')).toBe('3840');
  });

  it('uses HLS for a container the device does not direct play, keeping the token on the URL', async () => {
    const { http } = httpWith(() => ({ body: { MediaSources: [AVI_SOURCE], PlaySessionId: 'ps2' } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item2');

    expect(decision.mode).toBe('hls');
    expect(decision.method).toBe('Transcode');
    expect(decision.url).toBe(
      'https://watch.example.com/videos/item2/master.m3u8?MediaSourceId=src2&api_key=tok',
    );
  });

  it('adds the token when the server leaves it off the transcoding URL', async () => {
    const source = { ...AVI_SOURCE, TranscodingUrl: '/videos/item2/master.m3u8?MediaSourceId=src2' };
    const { http } = httpWith(() => ({ body: { MediaSources: [source] } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item2');
    expect(decision.url.endsWith('&api_key=tok')).toBe(true);
  });

  it('forces a transcode on request, even for a direct-playable file', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [MP4_SOURCE] } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1', {
      forceTranscode: true,
    });

    expect(decision.mode).toBe('hls');
    expect(decision.method).toBe('Transcode');
    expect(calls[0].body.EnableDirectPlay).toBe(false);
    expect(calls[0].body.EnableDirectStream).toBe(false);
  });

  it('never asks for more bandwidth than the device allows', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [MP4_SOURCE] } }));
    await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1', { maxBitrate: 999999999 });
    expect(calls[0].body.MaxStreamingBitrate).toBe(DEFAULT_CAPABILITIES.maxBitrate);
  });

  it('fails with no-compatible-stream when the server reports an error code', async () => {
    const { http } = httpWith(() => ({ body: { ErrorCode: 'NoCompatibleStream', MediaSources: [] } }));
    await expect(getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'x')).rejects.toMatchObject({
      kind: 'no-compatible-stream',
    });
  });

  it('fails when the server offers neither direct play nor a transcode', async () => {
    const source = { ...AVI_SOURCE, SupportsDirectPlay: false, TranscodingUrl: undefined };
    const { http } = httpWith(() => ({ body: { MediaSources: [source] } }));
    await expect(getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'x')).rejects.toMatchObject({
      kind: 'no-compatible-stream',
    });
  });
});

describe('audio and subtitle tracks', () => {
  const STREAMS = [
    { Index: 0, Type: 'Video', Codec: 'h264' },
    { Index: 1, Type: 'Audio', Language: 'eng', Codec: 'ac3', Channels: 6, ChannelLayout: '5.1', IsDefault: true },
    { Index: 2, Type: 'Audio', Language: 'fre', Codec: 'aac', Channels: 2 },
    { Index: 3, Type: 'Subtitle', Language: 'eng', Codec: 'subrip', IsDefault: false },
    { Index: 4, Type: 'Subtitle', Language: 'eng', Codec: 'pgssub', IsForced: true },
  ];
  const source = { ...MP4_SOURCE, MediaStreams: STREAMS, DefaultAudioStreamIndex: 1 };

  it('lists the tracks with readable labels and reports the default selection', async () => {
    const { http } = httpWith(() => ({ body: { MediaSources: [source], PlaySessionId: 'p' } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1');
    expect(decision.tracks?.audio).toEqual([
      { index: 1, label: 'English  ·  AC3 5.1', language: 'eng', isDefault: true, isForced: undefined },
      { index: 2, label: 'French  ·  AAC stereo', language: 'fre', isDefault: false, isForced: undefined },
    ]);
    expect(decision.tracks?.subtitles.map(t => t.label)).toEqual(['English', 'English  ·  Forced']);
    expect(decision.selection).toEqual({ audioIndex: 1, subtitleIndex: -1 });
    expect(decision.mode).toBe('url');
  });

  it('a chosen audio track rules out direct play but still allows a remux', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [source] } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1', { audioIndex: 2 });
    expect(calls[0].body.AudioStreamIndex).toBe(2);
    expect(calls[0].url).toContain('AudioStreamIndex=2');
    expect(calls[0].body.EnableDirectPlay).toBe(false);
    expect(calls[0].body.EnableDirectStream).toBe(true);
    expect(decision.mode).toBe('hls');
    expect(decision.selection).toEqual({ audioIndex: 2, subtitleIndex: -1 });
  });

  it('a chosen subtitle is burned in by the server: no direct play, no remux, every format encoded', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [source] } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1', {
      subtitleIndex: 3,
      mediaSourceId: 'src1',
    });
    // The server ignores a track choice that does not name the media source it belongs to.
    expect(calls[0].url).toContain('MediaSourceId=src1');
    expect(calls[0].body.MediaSourceId).toBe('src1');
    expect(calls[0].body.SubtitleStreamIndex).toBe(3);
    expect(calls[0].url).toContain('SubtitleStreamIndex=3');
    expect(calls[0].body.EnableDirectPlay).toBe(false);
    expect(calls[0].body.EnableDirectStream).toBe(false);
    const methods = calls[0].body.DeviceProfile.SubtitleProfiles.map((p: { Method: string }) => p.Method);
    expect(new Set(methods)).toEqual(new Set(['Encode']));
    expect(decision.selection).toEqual({ audioIndex: 1, subtitleIndex: 3 });
  });

  it('asks for no subtitle, and nothing about audio, when none are chosen', async () => {
    const { http, calls } = httpWith(() => ({ body: { MediaSources: [source] } }));
    await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1');
    expect(calls[0].body.AudioStreamIndex).toBeUndefined();
    expect(calls[0].body.SubtitleStreamIndex).toBe(-1);
    expect(calls[0].body.EnableDirectPlay).toBe(true);
  });

  it('has no track list for a source that describes no streams', async () => {
    const { http } = httpWith(() => ({ body: { MediaSources: [MP4_SOURCE] } }));
    const decision = await getPlaybackDecision(http, 'u1', DEFAULT_CAPABILITIES, 'item1');
    expect(decision.tracks).toBeUndefined();
  });
});

describe('progress reporting', () => {
  const item: MediaItem = { id: 'item1', title: 'T', kind: 'movie', resumeMs: 0, played: false };
  const decision: PlaybackDecision = {
    mode: 'hls',
    method: 'Transcode',
    url: 'u',
    mediaSourceId: 'src1',
    playSessionId: 'ps1',
  };

  it('converts position to ticks and carries the play session', async () => {
    const { http, calls } = httpWith(() => ({ status: 204 }));
    await reportStopped(http, { item, decision, positionMs: 61500, paused: false });

    expect(calls[0].url).toBe('https://watch.example.com/Sessions/Playing/Stopped');
    expect(calls[0].body).toMatchObject({
      ItemId: 'item1',
      MediaSourceId: 'src1',
      PlaySessionId: 'ps1',
      PositionTicks: 615000000,
      PlayMethod: 'Transcode',
      IsPaused: false,
    });
  });

  it('tells the server to stop the encode', async () => {
    const { http, calls } = httpWith(() => ({ status: 204 }));
    await stopTranscode(http, decision);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(
      'https://watch.example.com/Videos/ActiveEncodings?deviceId=device-1&playSessionId=ps1',
    );
  });
});

describe('items', () => {
  it('maps a movie with resume point, artwork and runtime', () => {
    const item = mapItem('https://watch.example.com', {
      Id: 'm1',
      Name: 'Film',
      Type: 'Movie',
      ProductionYear: 1999,
      Overview: 'About',
      RunTimeTicks: 60000000000,
      ImageTags: { Primary: 'ptag' },
      BackdropImageTags: ['btag'],
      UserData: { PlaybackPositionTicks: 12000000000, Played: false },
    });

    expect(item).toMatchObject({
      id: 'm1',
      title: 'Film',
      kind: 'movie',
      year: 1999,
      runtimeMs: 6000000,
      resumeMs: 1200000,
      played: false,
    });
    expect(item.posterUrl).toBe(
      'https://watch.example.com/Items/m1/Images/Primary?maxWidth=300&quality=90&tag=ptag',
    );
    expect(item.backdropUrl).toContain('/Items/m1/Images/Backdrop?maxWidth=1280');
  });

  it('copes with a bare item and an unknown type', () => {
    const item = mapItem('https://a.com', { Id: 'x', Name: 'X', Type: 'BoxSet' });
    expect(item.kind).toBe('other');
    expect(item.posterUrl).toBeUndefined();
    expect(item.resumeMs).toBe(0);
    expect(item.played).toBe(false);
  });

  it('lists only movie and show libraries', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: {
        Items: [
          { Id: 'a', Name: 'Movies', CollectionType: 'movies' },
          { Id: 'b', Name: 'Shows', CollectionType: 'tvshows' },
          { Id: 'c', Name: 'Music', CollectionType: 'music' },
        ],
        TotalRecordCount: 3,
      },
    }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    const libraries = await provider.getLibraries();

    expect(libraries.map(l => l.name)).toEqual(['Movies', 'Shows']);
    expect(calls[0].url).toBe('https://watch.example.com/Users/user-1/Views');
  });

  it('pages items and filters by genre', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: { Items: [{ Id: 'm1', Name: 'Film', Type: 'Movie' }], TotalRecordCount: 120 },
    }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    const page = await provider.getItems({ parentId: 'lib1', startIndex: 60, limit: 60, genres: ['Action', 'Sci-Fi'] });

    expect(page.total).toBe(120);
    expect(page.items[0].title).toBe('Film');
    expect(calls[0].url).toContain('/Users/user-1/Items?');
    expect(calls[0].url).toContain('ParentId=lib1');
    expect(calls[0].url).toContain('StartIndex=60');
    expect(calls[0].url).toContain('Genres=Action%7CSci-Fi');
  });
});

describe('toJellyfinProfile', () => {
  it('lists the codecs and containers the device was given', () => {
    const profile = toJellyfinProfile(DEFAULT_CAPABILITIES) as any;
    expect(profile.DirectPlayProfiles[0]).toMatchObject({
      Container: 'mp4,m4v,mkv',
      VideoCodec: 'h264,hevc',
      AudioCodec: 'aac,ac3,eac3,mp3',
    });
    // Fragmented MP4 segments, so the server can copy HEVC: Amazon's hls.js cannot read HEVC from MPEG-TS.
    expect(profile.TranscodingProfiles[0]).toMatchObject({
      Protocol: 'hls',
      Container: 'mp4',
      VideoCodec: 'h264,hevc',
      AudioCodec: 'aac',
    });
  });

  it('uses MPEG-TS segments for a player that reads them', () => {
    const profile = toJellyfinProfile({ ...DEFAULT_CAPABILITIES, hlsContainer: 'ts', hlsAudioCodecs: ['aac', 'ac3', 'eac3'] }) as any;
    expect(profile.TranscodingProfiles[0]).toMatchObject({ Container: 'ts', AudioCodec: 'aac,ac3,eac3' });
  });

  it('keeps 4K for HEVC while capping H.264 at 1080p', () => {
    const profile = toJellyfinProfile(DEFAULT_CAPABILITIES) as any;
    const width = (codec: string) =>
      profile.CodecProfiles.find((p: any) => p.Codec === codec).Conditions.find((c: any) => c.Property === 'Width').Value;
    expect(width('hevc')).toBe('3840');
    expect(width('h264')).toBe('1920');
  });

  it('asks the server to burn in subtitles the captions view cannot draw', () => {
    const profile = toJellyfinProfile(DEFAULT_CAPABILITIES) as any;
    const method = (format: string) =>
      profile.SubtitleProfiles.find((p: any) => p.Format === format)?.Method;
    expect(method('srt')).toBe('External');
    expect(method('vtt')).toBe('External');
    expect(method('pgssub')).toBe('Encode');
    expect(method('ass')).toBe('Encode');
  });
});
