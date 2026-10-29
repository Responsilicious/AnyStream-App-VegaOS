import { JellyfinHttp } from '../src/providers/jellyfin/http';
import { fetchVersions, toVersion } from '../src/providers/jellyfin/versions';
import { playItem, currentRoute, HOME } from '../src/navigation';
import type { MediaItem, MediaVersion } from '../src/providers/types';
import {
  hasTrackChoices,
  NO_PREFERENCE,
  selectionFor,
  startChoice,
  trackSummary,
  updatePreference,
} from '../src/titlePage';
import { DEVICE, SERVER, fakeFetch } from './helpers/fakes';

const UHD = {
  Id: 'v4k',
  Name: '2160p',
  RunTimeTicks: 76800000000,
  DefaultAudioStreamIndex: 1,
  MediaStreams: [
    { Index: 0, Type: 'Video', Width: 3840, Height: 1600, VideoRange: 'HDR', VideoRangeType: 'HDR10' },
    { Index: 1, Type: 'Audio', Language: 'eng', Codec: 'truehd', Channels: 8, Profile: 'TrueHD + Atmos', IsDefault: true },
    { Index: 2, Type: 'Audio', Language: 'fra', Codec: 'ac3', Channels: 6 },
    { Index: 3, Type: 'Subtitle', Language: 'eng', Codec: 'pgssub' },
  ],
};

const HD = {
  Id: 'vhd',
  Name: '',
  RunTimeTicks: 72000000000,
  MediaStreams: [
    { Index: 0, Type: 'Video', Width: 1920, Height: 1080, VideoRange: 'SDR', VideoRangeType: 'SDR' },
    { Index: 1, Type: 'Audio', Language: 'eng', Codec: 'aac', Channels: 2, IsDefault: true },
  ],
};

describe('versions', () => {
  it('reads badges, runtime, tracks and the default audio from each source', async () => {
    const fake = fakeFetch(() => ({ body: { MediaSources: [UHD, HD] } }));
    const http = new JellyfinHttp(SERVER.baseUrl, DEVICE, 'tok', fake.fetchImpl);
    const versions = await fetchVersions(http, 'u1', 'item1');

    expect(fake.calls[0].url).toBe(`${SERVER.baseUrl}/Users/u1/Items/item1`);
    expect(versions.map(v => v.name)).toEqual(['2160p', 'Version 2']);
    expect(versions[0].badges).toEqual(['4K', 'HDR', '7.1', 'Atmos']);
    expect(versions[0].runtimeMs).toBe(7680000);
    expect(versions[0].defaultAudioIndex).toBe(1);
    expect(versions[0].tracks?.audio).toHaveLength(2);
    expect(versions[1].badges).toEqual([]);
    expect(versions[1].defaultAudioIndex).toBe(1);
  });

  it('calls Dolby Vision by name and 5.1 by channel count', () => {
    const version = toVersion(
      {
        Id: 'dv',
        MediaStreams: [
          { Index: 0, Type: 'Video', Width: 3840, VideoRangeType: 'DOVIWithHDR10' },
          { Index: 1, Type: 'Audio', Channels: 6 },
        ],
      },
      0,
    );
    expect(version.badges).toEqual(['4K', 'Dolby Vision', '5.1']);
  });
});

describe('title page track choices', () => {
  const versions: MediaVersion[] = [toVersion(UHD, 0), toVersion(HD, 1)];

  it('sends nothing when the defaults are kept on a single version', () => {
    expect(startChoice(versions[0], [versions[0]], { audioIndex: 1, subtitleIndex: -1 })).toBeUndefined();
  });

  it('names the version when there are several, and only the tracks that differ', () => {
    expect(startChoice(versions[0], versions, { audioIndex: 1, subtitleIndex: -1 })).toEqual({ mediaSourceId: 'v4k' });
    expect(startChoice(versions[0], [versions[0]], { audioIndex: 2, subtitleIndex: 3 })).toEqual({
      mediaSourceId: 'v4k',
      audioIndex: 2,
      subtitleIndex: 3,
    });
  });

  it('summarises the choice for the button', () => {
    expect(trackSummary(versions[0], { audioIndex: 1, subtitleIndex: -1 })).toBe('English  ·  Subtitles off');
    expect(trackSummary(versions[0], { audioIndex: 2, subtitleIndex: 3 })).toBe('French  ·  English subtitles');
  });

  it('offers the panel only when there is something to choose', () => {
    expect(hasTrackChoices(versions[0])).toBe(true);
    expect(hasTrackChoices(versions[1])).toBe(false);
  });

  it('carries a series choice to the next episode by language', () => {
    const next = toVersion(
      {
        Id: 'e2',
        DefaultAudioStreamIndex: 1,
        MediaStreams: [
          { Index: 1, Type: 'Audio', Language: 'eng', IsDefault: true },
          { Index: 2, Type: 'Audio', Language: 'fra' },
          { Index: 5, Type: 'Subtitle', Language: 'eng', IsForced: true },
          { Index: 6, Type: 'Subtitle', Language: 'eng' },
        ],
      },
      0,
    );
    let preference = NO_PREFERENCE;
    expect(selectionFor(next, preference)).toEqual({ audioIndex: 1, subtitleIndex: -1 });

    preference = updatePreference(preference, versions[0], { subtitleIndex: 3 });
    preference = updatePreference(preference, versions[0], { audioIndex: 2 });
    expect(selectionFor(next, preference)).toEqual({ audioIndex: 2, subtitleIndex: 6 });

    preference = updatePreference(preference, versions[0], { subtitleIndex: -1 });
    expect(selectionFor(next, preference).subtitleIndex).toBe(-1);
  });

  it('carries the choice to the player route', () => {
    const movie: MediaItem = { id: 'm', title: 'Film', kind: 'movie', resumeMs: 0, played: false };
    const route = currentRoute(playItem(HOME, movie, { subtitleIndex: 3 }));
    expect(route).toEqual({ name: 'player', item: movie, choice: { subtitleIndex: 3 } });
  });
});
