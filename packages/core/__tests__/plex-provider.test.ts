import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import { describeError } from '../src/providers/jellyfin';
import { createPlexProvider } from '../src/providers/plex';
import { clientProfileExtra } from '../src/providers/plex/playback';
import type { Session } from '../src/providers/types';
import { DEVICE, fakeFetch, type Call } from './helpers/fakes';

const BASE = 'http://192.168.1.169:32400';
const PLEX_SESSION: Session = {
  server: { id: 'machine-1', kind: 'plex', name: 'Test Plex', baseUrl: BASE },
  userId: 'u-1',
  userName: 'will',
  accessToken: 'server-token',
};

const EPISODE = {
  ratingKey: '501',
  type: 'episode',
  title: 'Pilot',
  grandparentTitle: 'The Show',
  grandparentRatingKey: '500',
  parentIndex: 1,
  index: 1,
  duration: 1_800_000,
  viewOffset: 600_000,
  lastViewedAt: 1_700_000_000,
  thumb: '/library/metadata/501/thumb/1',
  grandparentThumb: '/library/metadata/500/thumb/1',
  grandparentArt: '/library/metadata/500/art/1',
};

const MOVIE = {
  ratingKey: '42',
  type: 'movie',
  title: 'Film',
  year: 2020,
  duration: 7_200_000,
  viewCount: 1,
  thumb: '/library/metadata/42/thumb/1',
  art: '/library/metadata/42/art/1',
  Genre: [{ tag: 'Drama' }],
  Role: [{ tag: 'A. Actor' }],
  Media: [
    {
      id: 7,
      container: 'mkv',
      videoCodec: 'hevc',
      audioCodec: 'eac3',
      videoResolution: '4k',
      duration: 7_200_000,
      Part: [
        {
          id: 70,
          key: '/library/parts/70/123/file.mkv',
          container: 'mkv',
          Stream: [
            { id: 1, streamType: 1, codec: 'hevc', width: 3840, colorTrc: 'smpte2084' },
            { id: 2, streamType: 2, codec: 'eac3', channels: 6, languageCode: 'eng', displayTitle: 'English (EAC3 5.1)', selected: true },
            { id: 3, streamType: 3, codec: 'srt', languageCode: 'eng', displayTitle: 'English (SRT)' },
          ],
        },
      ],
    },
  ],
};

const MP4 = {
  ...MOVIE,
  ratingKey: '43',
  Media: [{ id: 8, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', duration: 1000, Part: [{ id: 80, key: '/library/parts/80/1/f.mp4', container: 'mp4', Stream: [] }] }],
};

function provider(handler: (call: Call) => any) {
  const { calls, fetchImpl } = fakeFetch(handler);
  return { calls, plex: createPlexProvider(PLEX_SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl) };
}

const meta = (...items: object[]) => ({ body: { MediaContainer: { Metadata: items } } });

describe('Plex library', () => {
  it('lists movie and show libraries only', async () => {
    const { plex, calls } = provider(() => ({
      body: { MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'TV', type: 'show' }, { key: '3', title: 'Music', type: 'artist' }] } },
    }));
    expect(await plex.getLibraries()).toEqual([
      { id: '1', name: 'Movies', kind: 'movies' },
      { id: '2', name: 'TV', kind: 'tvshows' },
    ]);
    expect(calls[0].headers['X-Plex-Token']).toBe('server-token');
  });

  it('maps an episode: show poster, own still, numbering and resume point', async () => {
    const { plex } = provider(() => meta(EPISODE));
    const item = await plex.getItem('501');
    expect(item).toMatchObject({
      id: '501',
      kind: 'episode',
      seriesId: '500',
      seriesTitle: 'The Show',
      seasonIndex: 1,
      index: 1,
      resumeMs: 600_000,
      runtimeMs: 1_800_000,
      played: false,
      lastPlayed: 1_700_000_000_000,
    });
    expect(item.posterUrl).toContain(encodeURIComponent('/library/metadata/500/thumb/1'));
    expect(item.thumbUrl).toContain(encodeURIComponent('/library/metadata/501/thumb/1'));
    expect(item.posterUrl!.startsWith(`${BASE}/photo/:/transcode?`)).toBe(true);
  });

  it('pages a library with Plex container headers and reports the total', async () => {
    const { plex, calls } = provider(call =>
      call.url.includes('/library/sections/1/all')
        ? { body: { MediaContainer: { totalSize: 250, Metadata: [MOVIE] } } }
        : { body: { MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }] } } },
    );
    const page = await plex.getItems({ parentId: '1', startIndex: 60, limit: 60, sort: 'recent' });
    expect(page.total).toBe(250);
    expect(page.items[0]).toMatchObject({ id: '42', kind: 'movie', played: true, genres: ['Drama'], cast: ['A. Actor'] });
    const url = calls.find(c => c.url.includes('/all'))!.url;
    expect(url).toContain('type=1');
    expect(url).toContain('sort=addedAt%3Adesc');
    expect(url).toContain('X-Plex-Container-Start=60');
  });

  it('splits On Deck into Continue Playing and Up Next', async () => {
    const next = { ...EPISODE, ratingKey: '600', viewOffset: undefined, lastViewedAt: undefined };
    const { plex } = provider(() => meta(EPISODE, next, { ...MOVIE, viewOffset: 10, lastViewedAt: 1_800_000_000 }));
    expect((await plex.getContinuePlaying()).map(i => i.id)).toEqual(['42', '501']);
    expect((await plex.getUpNext()).map(i => i.id)).toEqual(['600']);
  });

  it('searches hubs and keeps only the asked-for kinds', async () => {
    const { plex } = provider(() => ({
      body: { MediaContainer: { Hub: [{ type: 'movie', Metadata: [MOVIE] }, { type: 'episode', Metadata: [EPISODE] }, { type: 'actor', Metadata: [] }] } },
    }));
    expect((await plex.search('film', 'movies')).map(i => i.id)).toEqual(['42']);
    expect((await plex.search('film', 'all')).map(i => i.id)).toEqual(['42', '501']);
    expect(await plex.search('  ', 'all')).toEqual([]);
  });

  it('asks search for external ids and passes the cancel signal on', async () => {
    const withGuids = { ...MOVIE, guid: 'plex://movie/5d77', Guid: [{ id: 'imdb://tt0133093' }, { id: 'tmdb://603' }] };
    const { plex, calls } = provider(() => ({ body: { MediaContainer: { Hub: [{ type: 'movie', Metadata: [withGuids] }] } } }));
    const controller = new AbortController();
    const [item] = await plex.search('film', 'all', controller.signal);
    expect(calls[0].url).toContain('includeGuids=1');
    expect(item.externalIds).toEqual({ imdb: 'tt0133093', tmdb: '603' });
    const hung = provider(() => 'hang');
    const pending = hung.plex.search('film', 'all', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('scrobbles and unscrobbles for watched state', async () => {
    const { plex, calls } = provider(() => ({ text: '' }));
    await plex.setPlayed('42', true);
    await plex.setPlayed('42', false);
    expect(calls.map(c => c.url.split('?')[0])).toEqual([`${BASE}/:/scrobble`, `${BASE}/:/unscrobble`]);
    expect(calls[0].url).toContain('key=42');
  });

  it('says plainly that Plex has no favourites', async () => {
    const { plex } = provider(() => ({ text: '' }));
    const error = await plex.setFavorite('42', true).catch(e => e);
    expect(describeError(error)).toBe('Plex does not offer that.');
  });

  it('describes versions with real badges and stream-id tracks', async () => {
    const { plex } = provider(() => meta(MOVIE));
    const [version] = await plex.getVersions('42');
    expect(version).toMatchObject({ id: '7', name: '4K', badges: ['4K', 'HDR', '5.1'], defaultAudioIndex: 2 });
    expect(version.tracks?.subtitles).toEqual([{ index: 3, label: 'English (SRT)', language: 'eng', isDefault: false, isForced: undefined }]);
  });
});

describe('Plex playback', () => {
  it('direct-plays an MP4 whose codecs the TV decodes', async () => {
    const { plex } = provider(() => meta(MP4));
    const decision = await plex.getPlayback('43');
    expect(decision).toMatchObject({ mode: 'url', method: 'DirectPlay', mediaSourceId: '8' });
    expect(decision.url).toBe(`${BASE}/library/parts/80/1/f.mp4?X-Plex-Token=server-token`);
  });

  it('sends an MKV through the universal transcoder as HLS, after a decision check', async () => {
    const { plex, calls } = provider(call =>
      call.url.includes('/decision') ? { body: { MediaContainer: { generalDecisionCode: 1001 } } } : meta(MOVIE),
    );
    const decision = await plex.getPlayback('42', { startMs: 61_500 });
    expect(decision).toMatchObject({ mode: 'hls', method: 'Transcode', mediaSourceId: '7', durationMs: 7_200_000 });
    expect(decision.url.startsWith(`${BASE}/video/:/transcode/universal/start.m3u8?`)).toBe(true);
    expect(decision.url).toContain('offset=61');
    expect(decision.url).toContain('directPlay=0');
    expect(decision.url).toContain('X-Plex-Token=server-token');
    expect(decision.url).toContain(`session=${decision.playSessionId}`);
    expect(calls.some(c => c.url.includes('/video/:/transcode/universal/decision'))).toBe(true);
  });

  it('applies chosen tracks to the part, and burns subtitles', async () => {
    const { plex, calls } = provider(call =>
      call.url.includes('/decision') ? { body: { MediaContainer: { generalDecisionCode: 1001 } } } : call.method === 'PUT' ? { text: '' } : meta(MOVIE),
    );
    const decision = await plex.getPlayback('42', { audioIndex: 2, subtitleIndex: 3, mediaSourceId: '7' });
    const put = calls.find(c => c.method === 'PUT')!;
    expect(put.url).toContain('/library/parts/70?');
    expect(put.url).toContain('audioStreamID=2');
    expect(put.url).toContain('subtitleStreamID=3');
    expect(decision.url).toContain('subtitles=burn');
    expect(decision.selection).toEqual({ audioIndex: 2, subtitleIndex: 3 });
  });

  it('turns a Plex refusal into a playback restriction, not a sign-in problem', async () => {
    const refused = provider(call => (call.url.includes('/decision') ? { status: 403 } : meta(MOVIE)));
    const e1 = await refused.plex.getPlayback('42').catch(e => e);
    expect(e1).toMatchObject({ kind: 'playback-restricted' });
    expect(describeError(e1)).toMatch(/Plex Pass/);
    const declined = provider(call => (call.url.includes('/decision') ? { body: { MediaContainer: { generalDecisionCode: 2000 } } } : meta(MOVIE)));
    await expect(declined.plex.getPlayback('42')).rejects.toMatchObject({ kind: 'playback-restricted' });
  });

  it('caps H.264 transcodes at 1080p 8-bit for the stick', () => {
    const extra = clientProfileExtra(DEFAULT_CAPABILITIES);
    expect(extra).toContain('videoCodec=h264&audioCodec=aac');
    expect(extra).toContain('name=video.height&value=1080');
    expect(extra).toContain('name=video.bitDepth&value=8');
  });

  it('reports progress on the timeline and stops the transcode session', async () => {
    const { plex, calls } = provider(call =>
      call.url.includes('/decision') ? { body: { MediaContainer: { generalDecisionCode: 1001 } } } : call.url.includes('/library/metadata') ? meta(MOVIE) : { text: '' },
    );
    const decision = await plex.getPlayback('42');
    const item = { id: '42', title: 'Film', kind: 'movie' as const, resumeMs: 0, played: false };
    await plex.reportProgress({ item, decision, positionMs: 5000.7, paused: true });
    await plex.reportStopped({ item, decision, positionMs: 6000, paused: false });
    await plex.stopTranscode(decision);
    const timeline = calls.filter(c => c.url.includes('/:/timeline'));
    expect(timeline[0].url).toContain('state=paused');
    expect(timeline[0].url).toContain('time=5000');
    expect(timeline[1].url).toContain('state=stopped');
    expect(calls[calls.length - 1].url).toContain(`/video/:/transcode/universal/stop?session=${decision.playSessionId}`);
  });
});
