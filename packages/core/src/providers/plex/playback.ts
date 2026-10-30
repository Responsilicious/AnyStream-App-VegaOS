import { APP_NAME } from '../../config';
import { directPlayVideoCodecsFor, urlModeReaches } from '../../player/capabilities';
import { buildQuery, joinUrl, type QueryValue } from '../../util/url';
import type {
  DeviceCapabilities,
  MediaVersion,
  PlaybackDecision,
  PlaybackOptions,
  ProgressEvent,
  ProgressReport,
  TrackInfo,
  TrackOption,
} from '../types';
import { isPlexError, PlexError } from './errors';
import type { PlexHttp } from './http';
import { fetchRawItem, type PlexMedia, type PlexMetadata, type PlexStream } from './items';

const VIDEO = 1;
const AUDIO = 2;
const SUBTITLE = 3;

function option(stream: PlexStream, fallback: string): TrackOption {
  return {
    // Plex picks tracks by stream id, not by position, so the id is what goes back in a choice.
    index: stream.id,
    label: stream.extendedDisplayTitle || stream.displayTitle || stream.title || fallback,
    language: stream.languageCode,
    isDefault: stream.default === true,
    isForced: stream.forced === true ? true : undefined,
  };
}

export function plexTracks(media: PlexMedia): TrackInfo | undefined {
  const streams = media.Part?.[0]?.Stream ?? [];
  const audio = streams.filter(s => s.streamType === AUDIO).map(s => option(s, 'Audio'));
  const subtitles = streams.filter(s => s.streamType === SUBTITLE).map(s => option(s, 'Subtitles'));
  return audio.length > 0 || subtitles.length > 0 ? { audio, subtitles } : undefined;
}

function defaultAudio(media: PlexMedia): PlexStream | undefined {
  const audio = (media.Part?.[0]?.Stream ?? []).filter(s => s.streamType === AUDIO);
  return audio.find(s => s.selected) ?? audio.find(s => s.default) ?? audio[0];
}

const UHD_MIN_WIDTH = 3200;

/** One Plex Media entry as the title page shows it. Badges describe the file, never what the TV can play. */
export function toPlexVersion(media: PlexMedia, position: number): MediaVersion {
  const streams = media.Part?.[0]?.Stream ?? [];
  const video = streams.find(s => s.streamType === VIDEO);
  const audio = defaultAudio(media);
  const badges: string[] = [];
  if ((video?.width ?? media.width ?? 0) >= UHD_MIN_WIDTH || media.videoResolution === '4k') {
    badges.push('4K');
  }
  if (video?.DOVIPresent) {
    badges.push('Dolby Vision');
  } else if (video?.colorTrc === 'smpte2084' || video?.colorTrc === 'arib-std-b67') {
    badges.push('HDR');
  }
  const channels = audio?.channels ?? 0;
  if (channels >= 8) {
    badges.push('7.1');
  } else if (channels >= 6) {
    badges.push('5.1');
  }
  if (/atmos/i.test(`${audio?.profile ?? ''} ${audio?.displayTitle ?? ''} ${audio?.extendedDisplayTitle ?? ''}`)) {
    badges.push('Atmos');
  }
  const resolution = media.videoResolution ? (/^\d+$/.test(media.videoResolution) ? `${media.videoResolution}p` : media.videoResolution.toUpperCase()) : '';
  return {
    id: String(media.id),
    name: media.title?.trim() || resolution || `Version ${position + 1}`,
    runtimeMs: media.duration,
    badges,
    tracks: plexTracks(media),
    defaultAudioIndex: audio?.id,
  };
}

export async function fetchPlexVersions(http: PlexHttp, id: string): Promise<MediaVersion[]> {
  const raw = await fetchRawItem(http, id);
  return (raw?.Media ?? []).map(toPlexVersion);
}

/**
 * What the TV asks Plex to stream: the device's HLS codecs in its HLS container, so Plex copies HEVC video
 * instead of re-encoding it. H.264 is capped at 1080p 8-bit, because the stick's H.264 decoder failed on 4K
 * 10-bit (see AGENTS.md); only an encode lands there.
 */
export function clientProfileExtra(caps: DeviceCapabilities): string {
  const video = caps.hlsVideoCodecs.join(',') || 'h264';
  const audio = caps.hlsAudioCodecs.join(',') || 'aac';
  const container = caps.hlsContainer === 'mp4' ? 'mp4' : 'mpegts';
  return [
    `add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=${container}&videoCodec=${video}&audioCodec=${audio})`,
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.width&value=1920)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.height&value=1080)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.bitDepth&value=8)',
  ].join('+');
}

interface DecisionResponse {
  MediaContainer?: {
    generalDecisionCode?: number;
    generalDecisionText?: string;
    transcodeDecisionCode?: number;
    transcodeDecisionText?: string;
  };
}

function chooseMedia(raw: PlexMetadata, mediaSourceId?: string): { media: PlexMedia; index: number } {
  const all = raw.Media ?? [];
  const index = Math.max(0, mediaSourceId ? all.findIndex(m => String(m.id) === mediaSourceId) : 0);
  const media = all[index];
  if (!media?.Part?.[0]) {
    throw new PlexError('not-found', 'Title has no playable file');
  }
  return { media, index };
}

function lower(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

/**
 * Plays a Plex title. A plain MP4 whose codecs the TV decodes is fetched directly ('url'); anything else goes
 * through Plex's universal transcoder as HLS, which copies what it can and converts the rest. A provider
 * refusal (for example remote playback needing a Plex Pass) is a 'playback-restricted' error, not a sign-in one.
 */
export async function getPlexPlayback(
  http: PlexHttp,
  caps: DeviceCapabilities,
  id: string,
  sessionId: string,
  options: PlaybackOptions = {},
): Promise<PlaybackDecision> {
  const raw = await fetchRawItem(http, id);
  if (!raw) {
    throw new PlexError('not-found', 'Title not found');
  }
  const { media, index } = chooseMedia(raw, options.mediaSourceId);
  const part = media.Part![0];
  const subtitleOn = options.subtitleIndex !== undefined && options.subtitleIndex >= 0;
  const audioChosen = options.audioIndex !== undefined;
  const force = options.forceTranscode === true;

  if (audioChosen || options.subtitleIndex !== undefined) {
    // Plex applies track choices from the part's saved selection; 0 means no subtitles.
    await http.request('PUT', `/library/parts/${part.id}`, {
      query: {
        allParts: 1,
        audioStreamID: audioChosen ? options.audioIndex : undefined,
        subtitleStreamID: subtitleOn ? options.subtitleIndex : 0,
      },
    });
  }

  const tracks = plexTracks(media);
  const fallbackAudio = defaultAudio(media)?.id;
  const selection = { audioIndex: options.audioIndex ?? fallbackAudio, subtitleIndex: options.subtitleIndex ?? -1 };
  const common = { mediaSourceId: String(media.id), playSessionId: sessionId, durationMs: media.duration ?? raw.duration, tracks, selection, defaultAudioIndex: fallbackAudio };

  const container = lower(part.container ?? media.container);
  const direct =
    !force &&
    !subtitleOn &&
    !audioChosen &&
    urlModeReaches(caps, http.baseUrl) &&
    caps.directPlayContainers.includes(container) &&
    directPlayVideoCodecsFor(caps, container).includes(lower(media.videoCodec)) &&
    caps.audioCodecs.includes(lower(media.audioCodec));
  if (direct) {
    return {
      ...common,
      mode: 'url',
      method: 'DirectPlay',
      url: joinUrl(http.baseUrl, part.key) + buildQuery({ 'X-Plex-Token': http.token }),
    };
  }

  const maxBitrate = Math.min(options.maxBitrate ?? caps.maxBitrate, caps.maxBitrate);
  const params: Record<string, QueryValue> = {
    hasMDE: 1,
    path: `/library/metadata/${id}`,
    mediaIndex: index,
    partIndex: 0,
    protocol: 'hls',
    fastSeek: 1,
    directPlay: 0,
    // Copy video and audio when they already fit the profile; burning a subtitle needs a full encode.
    directStream: subtitleOn ? 0 : 1,
    directStreamAudio: 1,
    subtitles: subtitleOn ? 'burn' : undefined,
    offset: Math.floor((options.startMs ?? 0) / 1000),
    maxVideoBitrate: Math.floor(maxBitrate / 1000),
    // The screen, not 1080p: a fixed 1920x1080 made Plex scale every 4K file down, which needs a full encode.
    videoResolution: `${caps.maxWidth}x${caps.maxHeight}`,
    session: sessionId,
    location: 'lan',
    'X-Plex-Session-Identifier': sessionId,
    'X-Plex-Client-Identifier': http.device.id,
    'X-Plex-Product': APP_NAME,
    'X-Plex-Platform': 'Generic',
    // Plex picks its client profile by name; an unknown platform such as Vega has none, and the decision
    // endpoint answered 400 without one (29 Oct 2026). Generic ships with every server.
    'X-Plex-Client-Profile-Name': 'Generic',
    'X-Plex-Client-Profile-Extra': clientProfileExtra(caps),
  };

  try {
    const decision = await http.get<DecisionResponse>('/video/:/transcode/universal/decision', { query: params });
    const code = decision?.MediaContainer?.generalDecisionCode;
    if (code !== undefined && code >= 2000) {
      throw new PlexError('playback-restricted', `Plex declined playback (${code})`);
    }
  } catch (e) {
    if (isPlexError(e) && e.kind === 'forbidden') {
      throw new PlexError('playback-restricted', 'Plex declined playback', e.status);
    }
    throw e;
  }

  return {
    ...common,
    mode: 'hls',
    method: 'Transcode',
    // The player cannot send headers, so identity and token go in the query, to this server only.
    url: joinUrl(http.baseUrl, '/video/:/transcode/universal/start.m3u8') + buildQuery({ ...params, 'X-Plex-Token': http.token }),
  };
}

function timeline(http: PlexHttp, report: ProgressReport, state: 'playing' | 'paused' | 'stopped'): Promise<void> {
  return http.get<void>('/:/timeline', {
    query: {
      ratingKey: report.item.id,
      key: `/library/metadata/${report.item.id}`,
      state,
      time: Math.floor(report.positionMs),
      duration: report.decision.durationMs ?? report.item.runtimeMs,
      hasMDE: 1,
      'X-Plex-Session-Identifier': report.decision.playSessionId,
    },
  });
}

export function reportPlex(http: PlexHttp, report: ProgressReport, event: ProgressEvent): Promise<void> {
  const state = event === 'stop' ? 'stopped' : report.paused || event === 'pause' ? 'paused' : 'playing';
  return timeline(http, report, state);
}

/** Ends the server's transcode so an abandoned stream stops using its CPU. */
export function stopPlexTranscode(http: PlexHttp, decision: PlaybackDecision): Promise<void> {
  if (decision.mode !== 'hls' || !decision.playSessionId) {
    return Promise.resolve();
  }
  return http.get<void>('/video/:/transcode/universal/stop', { query: { session: decision.playSessionId } });
}
