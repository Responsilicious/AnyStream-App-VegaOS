import { urlModeReaches } from '../../player/capabilities';
import { buildQuery, joinUrl } from '../../util/url';
import { msToTicks, ticksToMs } from '../../util/ticks';
import type {
  DeviceCapabilities,
  PlaybackDecision,
  PlaybackOptions,
  ProgressReport,
  TrackInfo,
  TrackOption,
} from '../types';
import { toJellyfinProfile } from './deviceProfile';
import { JellyfinError } from './errors';
import type { JellyfinHttp } from './http';

export interface MediaStream {
  Index: number;
  Type?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  Codec?: string;
  Profile?: string;
  Channels?: number;
  ChannelLayout?: string;
  Width?: number;
  Height?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
}

export interface MediaSource {
  Id: string;
  Name?: string;
  MediaStreams?: MediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  Container?: string;
  ETag?: string;
  RunTimeTicks?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
}

interface PlaybackInfoResponse {
  MediaSources?: MediaSource[];
  PlaySessionId?: string;
  ErrorCode?: string;
}

/** Plain-language names for the languages a menu is likely to show; anything else falls back to its code. */
const LANGUAGES: Record<string, string> = {
  eng: 'English',
  fra: 'French',
  fre: 'French',
  deu: 'German',
  ger: 'German',
  spa: 'Spanish',
  ita: 'Italian',
  por: 'Portuguese',
  nld: 'Dutch',
  dut: 'Dutch',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  pol: 'Polish',
  rus: 'Russian',
  jpn: 'Japanese',
  kor: 'Korean',
  zho: 'Chinese',
  chi: 'Chinese',
  ara: 'Arabic',
  hin: 'Hindi',
  tur: 'Turkish',
};

function languageName(code: string | undefined): string | undefined {
  if (!code || code === 'und') {
    return undefined;
  }
  return LANGUAGES[code.toLowerCase()] ?? code.toUpperCase();
}

/** "AC3 5.1" or "AAC stereo": what an audio track is, so two English tracks can be told apart. */
function audioDetail(stream: MediaStream): string {
  const codec = (stream.Codec ?? '').toUpperCase().replace('EAC3', 'E-AC3');
  const layout =
    stream.ChannelLayout && /^\d\.\d$/.test(stream.ChannelLayout)
      ? stream.ChannelLayout
      : stream.Channels === 1
      ? 'mono'
      : stream.Channels === 2
      ? 'stereo'
      : stream.Channels
      ? stream.Channels === 6
        ? '5.1'
        : stream.Channels === 8
        ? '7.1'
        : `${stream.Channels} ch`
      : '';
  return [codec, layout].filter(Boolean).join(' ');
}

function toOption(stream: MediaStream, label: string): TrackOption {
  return {
    index: stream.Index,
    label,
    language: stream.Language,
    isDefault: stream.IsDefault === true,
    isForced: stream.IsForced === true ? true : undefined,
  };
}

/** The audio and subtitle tracks of one source, labelled for a menu. Undefined when the source lists none. */
export function buildTracks(source: MediaSource): TrackInfo | undefined {
  const streams = source.MediaStreams ?? [];
  const audio = streams
    .filter(s => s.Type === 'Audio')
    .map(s => toOption(s, [languageName(s.Language) ?? s.Title ?? 'Audio', audioDetail(s)].filter(Boolean).join('  ·  ')));
  const subtitles = streams
    .filter(s => s.Type === 'Subtitle')
    .map(s => {
      const name = languageName(s.Language) ?? s.Title ?? 'Subtitles';
      const note = s.IsForced ? 'Forced' : s.Title && s.Title !== name ? s.Title : '';
      return toOption(s, [name, note].filter(Boolean).join('  ·  '));
    });
  return audio.length > 0 || subtitles.length > 0 ? { audio, subtitles } : undefined;
}

/** Whether a transcoding URL the server built burns in a subtitle track. */
function hasSubtitleParam(url: string | undefined): boolean {
  return url !== undefined && /[?&]SubtitleStreamIndex=\d/.test(url);
}

function hasContainer(source: MediaSource, allowed: string[]): boolean {
  const containers = (source.Container ?? '').toLowerCase().split(',');
  return containers.some(c => allowed.includes(c.trim()));
}

/**
 * Asks the server how this title should be delivered, then turns the answer into one of two modes:
 *  - 'url': a plain MP4 the TV can fetch directly (Direct Play)
 *  - 'hls': an adaptive stream the server builds (remux or transcode)
 */
export async function getPlaybackDecision(
  http: JellyfinHttp,
  userId: string,
  caps: DeviceCapabilities,
  itemId: string,
  options: PlaybackOptions = {},
): Promise<PlaybackDecision> {
  const token = http.token ?? '';
  const maxBitrate = Math.min(options.maxBitrate ?? caps.maxBitrate, caps.maxBitrate);
  const force = options.forceTranscode === true;
  // A subtitle is drawn into the picture by the server, so it needs an encode. Direct play and a plain remux
  // cannot do that, and direct play (a plain file) also cannot choose a different audio track.
  const subtitleOn = options.subtitleIndex !== undefined && options.subtitleIndex >= 0;
  const audioChosen = options.audioIndex !== undefined;
  const directAllowed = !force && !subtitleOn && !audioChosen && urlModeReaches(caps, http.baseUrl);

  // Jellyfin only applies audio and subtitle choices when the request also names the media source they belong
  // to (StreamBuilder options are set only when MediaSourceId matches); without it a chosen subtitle came back
  // not burned in (29 Oct 2026) and, worse, "no subtitles" (-1) was dropped and the server burned in the file's
  // default track for every transcode (Aladdin, 30 Oct 2026). The choice goes in the query as well as the body,
  // which the server reads first.
  const playbackInfo = (mediaSourceId: string | undefined) => http.post<PlaybackInfoResponse>(`/Items/${itemId}/PlaybackInfo`, {
    query: {
      UserId: userId,
      MediaSourceId: mediaSourceId,
      AudioStreamIndex: audioChosen ? options.audioIndex : undefined,
      // -1 when none is chosen: otherwise the server may burn in a default image subtitle nobody asked for.
      SubtitleStreamIndex: options.subtitleIndex ?? -1,
    },
    body: {
      UserId: userId,
      DeviceProfile: toJellyfinProfile({ ...caps, maxBitrate }, { burnInSubtitles: subtitleOn }),
      MaxStreamingBitrate: maxBitrate,
      StartTimeTicks: msToTicks(options.startMs ?? 0),
      AutoOpenLiveStream: false,
      EnableDirectPlay: directAllowed,
      EnableDirectStream: !force && !subtitleOn,
      EnableTranscoding: true,
      ...(mediaSourceId ? { MediaSourceId: mediaSourceId } : {}),
      ...(audioChosen ? { AudioStreamIndex: options.audioIndex } : {}),
      SubtitleStreamIndex: options.subtitleIndex ?? -1,
    },
  });

  let info = await playbackInfo(options.mediaSourceId);
  let source = info.MediaSources?.[0];
  if (info.ErrorCode || !source) {
    throw new JellyfinError('no-compatible-stream', `No playable source: ${info.ErrorCode ?? 'empty'}`);
  }
  if (!options.mediaSourceId && !subtitleOn && hasSubtitleParam(source.TranscodingUrl)) {
    // The source id is only known from the answer, so ask again naming it; now the -1 counts.
    info = await playbackInfo(source.Id);
    source = info.MediaSources?.[0];
    if (info.ErrorCode || !source) {
      throw new JellyfinError('no-compatible-stream', `No playable source: ${info.ErrorCode ?? 'empty'}`);
    }
  }

  const durationMs = source.RunTimeTicks ? ticksToMs(source.RunTimeTicks) : undefined;
  const tracks = buildTracks(source);
  const selection = {
    audioIndex: options.audioIndex ?? source.DefaultAudioStreamIndex,
    subtitleIndex: options.subtitleIndex ?? -1,
  };

  if (directAllowed && source.SupportsDirectPlay && hasContainer(source, caps.directPlayContainers)) {
    const query = buildQuery({
      static: true,
      mediaSourceId: source.Id,
      deviceId: http.device.id,
      api_key: token,
      Tag: source.ETag,
      PlaySessionId: info.PlaySessionId,
    });
    return {
      mode: 'url',
      method: 'DirectPlay',
      url: joinUrl(http.baseUrl, `/Videos/${itemId}/stream`) + query,
      mediaSourceId: source.Id,
      playSessionId: info.PlaySessionId,
      durationMs,
      tracks,
      selection,
      defaultAudioIndex: source.DefaultAudioStreamIndex,
    };
  }

  if (source.TranscodingUrl) {
    // Jellyfin returns a server-relative path. Make sure the token rides along for every segment request.
    let url = joinUrl(http.baseUrl, source.TranscodingUrl);
    if (!/[?&]api_key=/i.test(url)) {
      url += `${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(token)}`;
    }
    return {
      mode: 'hls',
      method: 'Transcode',
      url,
      mediaSourceId: source.Id,
      playSessionId: info.PlaySessionId,
      durationMs,
      tracks,
      selection,
      defaultAudioIndex: source.DefaultAudioStreamIndex,
    };
  }

  throw new JellyfinError('no-compatible-stream', 'Server offered no direct stream or transcode');
}

function progressBody(report: ProgressReport): Record<string, unknown> {
  return {
    ItemId: report.item.id,
    MediaSourceId: report.decision.mediaSourceId,
    PlaySessionId: report.decision.playSessionId,
    PositionTicks: msToTicks(report.positionMs),
    IsPaused: report.paused,
    IsMuted: false,
    PlayMethod: report.decision.method,
    CanSeek: true,
  };
}

export function reportStarted(http: JellyfinHttp, report: ProgressReport): Promise<void> {
  return http.post<void>('/Sessions/Playing', { body: progressBody(report) });
}

export function reportProgress(http: JellyfinHttp, report: ProgressReport): Promise<void> {
  return http.post<void>('/Sessions/Playing/Progress', { body: progressBody(report) });
}

export function reportStopped(http: JellyfinHttp, report: ProgressReport): Promise<void> {
  return http.post<void>('/Sessions/Playing/Stopped', { body: progressBody(report) });
}

/** Tells the server to stop encoding so a finished or abandoned transcode does not keep using its CPU. */
export function stopTranscode(http: JellyfinHttp, decision: PlaybackDecision): Promise<void> {
  return http.delete<void>('/Videos/ActiveEncodings', {
    query: { deviceId: http.device.id, playSessionId: decision.playSessionId },
  });
}
