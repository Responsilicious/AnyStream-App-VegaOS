import { directPlayVideoCodecsFor } from '../../player/capabilities';
import type { DeviceCapabilities } from '../types';

/** Jellyfin "DeviceProfile": tells the server what this TV plays so it can choose direct play or transcode. */
export interface ProfileOptions {
  /** Ask the server to draw every kind of subtitle into the picture, so none needs a captions view. */
  burnInSubtitles?: boolean;
  /**
   * Cap H.264 at 1080p 8-bit. Jellyfin folds every listed HLS codec's conditions into one stream URL
   * (MaxWidth=1920 for a 4K HEVC copy, Aladdin, 30 Oct 2026), so the cap is only sent when the server is going
   * to encode anyway (a burned-in subtitle, or video it cannot copy).
   */
  capH264?: boolean;
}

const H264_MAX_WIDTH = 1920;
const H264_MAX_HEIGHT = 1080;

export function toJellyfinProfile(
  caps: DeviceCapabilities,
  options: ProfileOptions = {},
): Record<string, unknown> {
  const conditions = (codecLevel: boolean) => {
    // H.264 stops at 1080p: the server also sizes its H.264 transcodes by these, and a 4K H.264 transcode of a 4K
    // HEVC file failed in the stick's H.264 decoder (Aladdin, 29 Oct 2026). 4K plays as HEVC.
    const cap = codecLevel && options.capH264 === true;
    const maxWidth = cap ? Math.min(caps.maxWidth, H264_MAX_WIDTH) : caps.maxWidth;
    const maxHeight = cap ? Math.min(caps.maxHeight, H264_MAX_HEIGHT) : caps.maxHeight;
    const list: Array<Record<string, unknown>> = [
      { Condition: 'LessThanEqual', Property: 'Width', Value: String(maxWidth), IsRequired: false },
      { Condition: 'LessThanEqual', Property: 'Height', Value: String(maxHeight), IsRequired: false },
    ];
    if (codecLevel) {
      // The stick's H.264 decoder takes 8-bit Baseline, Main and High only; a copied High 10 or 4:2:2 stream
      // failed in the decoder (Aladdin, 29 Oct 2026). These make the server re-encode such video instead.
      list.push(
        { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
        { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
        { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
      );
    }
    return list;
  };

  return {
    Name: 'AnyStream (Vega)',
    MaxStreamingBitrate: caps.maxBitrate,
    MaxStaticBitrate: caps.maxBitrate,
    MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: directPlayProfiles(caps),
    TranscodingProfiles: [
      {
        Type: 'Video',
        Context: 'Streaming',
        Protocol: 'hls',
        Container: caps.hlsContainer,
        VideoCodec: caps.hlsVideoCodecs.join(','),
        AudioCodec: caps.hlsAudioCodecs.join(','),
        MaxAudioChannels: '6',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      { Type: 'Video', Codec: 'h264', Conditions: conditions(true) },
      { Type: 'Video', Codec: 'hevc', Conditions: conditions(false) },
    ],
    ResponseProfiles: [],
    SubtitleProfiles: options.burnInSubtitles ? BURN_IN_SUBTITLES : SUBTITLES,
  };
}

/** One profile per set of containers that share the same video codecs (see `directPlayVideoCodecs`). */
function directPlayProfiles(caps: DeviceCapabilities): Array<Record<string, string>> {
  const groups = new Map<string, string[]>();
  for (const container of caps.directPlayContainers) {
    const key = directPlayVideoCodecsFor(caps, container).join(',');
    groups.set(key, [...(groups.get(key) ?? []), container]);
  }
  return [...groups.entries()].map(([videoCodec, containers]) => ({
    Type: 'Video',
    Container: containers.join(','),
    VideoCodec: videoCodec,
    AudioCodec: caps.audioCodecs.join(','),
  }));
}

/** Text subtitles can be fetched as separate files; styled and image subtitles cannot be drawn by the captions view. */
const SUBTITLES = [
  { Format: 'vtt', Method: 'External' },
  { Format: 'srt', Method: 'External' },
  { Format: 'subrip', Method: 'External' },
  // Styled and image subtitles cannot be drawn by the captions view: the server burns them in.
  { Format: 'ass', Method: 'Encode' },
  { Format: 'ssa', Method: 'Encode' },
  { Format: 'pgssub', Method: 'Encode' },
  { Format: 'dvdsub', Method: 'Encode' },
  { Format: 'dvbsub', Method: 'Encode' },
];

/** Every format drawn by the server: the menu's choice is shown whatever the format, with no captions plumbing. */
const BURN_IN_SUBTITLES = SUBTITLES.map(entry => ({ Format: entry.Format, Method: 'Encode' }));
