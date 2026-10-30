import { ticksToMs } from '../../util/ticks';
import type { MediaVersion } from '../types';
import type { JellyfinHttp } from './http';
import { buildTracks, type MediaSource, type MediaStream } from './playback';

interface ItemWithSources {
  MediaSources?: Array<MediaSource & { RunTimeTicks?: number }>;
}

/** 4K counts by width, so a 3840 × 1600 scope film is 4K too. */
const UHD_MIN_WIDTH = 3200;

function videoBadges(video: MediaStream | undefined): string[] {
  if (!video) {
    return [];
  }
  const badges: string[] = [];
  if ((video.Width ?? 0) >= UHD_MIN_WIDTH) {
    badges.push('4K');
  }
  const rangeType = (video.VideoRangeType ?? '').toUpperCase();
  if (rangeType.startsWith('DOVI')) {
    badges.push('Dolby Vision');
  } else if (['HDR10', 'HDR10PLUS', 'HLG'].includes(rangeType) || video.VideoRange?.toUpperCase() === 'HDR') {
    badges.push('HDR');
  }
  return badges;
}

function audioBadges(audio: MediaStream | undefined): string[] {
  if (!audio) {
    return [];
  }
  const badges: string[] = [];
  const channels = audio.Channels ?? 0;
  if (channels >= 8) {
    badges.push('7.1');
  } else if (channels >= 6) {
    badges.push('5.1');
  }
  if (/atmos/i.test(`${audio.Profile ?? ''} ${audio.DisplayTitle ?? ''} ${audio.Title ?? ''}`)) {
    badges.push('Atmos');
  }
  return badges;
}

/** One source as the title page shows it. Badges describe the file itself, as the default audio track plays it. */
export function toVersion(source: MediaSource & { RunTimeTicks?: number }, position: number): MediaVersion {
  const streams = source.MediaStreams ?? [];
  const video = streams.find(s => s.Type === 'Video');
  const audioTracks = streams.filter(s => s.Type === 'Audio');
  const defaultAudio =
    audioTracks.find(s => s.Index === source.DefaultAudioStreamIndex) ?? audioTracks.find(s => s.IsDefault) ?? audioTracks[0];
  return {
    id: source.Id,
    name: source.Name?.trim() || `Version ${position + 1}`,
    runtimeMs: source.RunTimeTicks ? ticksToMs(source.RunTimeTicks) : undefined,
    badges: [...videoBadges(video), ...audioBadges(defaultAudio)],
    tracks: buildTracks(source),
    defaultAudioIndex: defaultAudio?.Index,
  };
}

/** The versions of one movie or episode. The single-item endpoint lists every source with its streams. */
export async function fetchVersions(http: JellyfinHttp, userId: string, itemId: string): Promise<MediaVersion[]> {
  const raw = await http.get<ItemWithSources>(`/Users/${userId}/Items/${itemId}`);
  return (raw.MediaSources ?? []).map(toVersion);
}
