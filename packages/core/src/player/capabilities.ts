import type { DeviceCapabilities } from '../providers/types';

/**
 * Baseline for a Fire TV Stick 4K Select: H.264 and HEVC in MP4 or MKV play directly. Anything else goes over
 * HLS, where the server copies H.264 or HEVC video when it can and converts only what does not fit, so a 4K HEVC
 * file stays 4K HEVC. Probing (below) can only remove codecs from this list, never add risky ones.
 */
export const DEFAULT_CAPABILITIES: DeviceCapabilities = {
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3', 'mp3'],
  // An MKV of HEVC Main 10 and E-AC-3 stalled in URL mode on 29 Oct 2026. PlayerEngine's start-up watchdog now
  // turns such a stall into the HLS fallback, which keeps the video, so MKV is tried directly again.
  directPlayContainers: ['mp4', 'm4v', 'mkv'],
  // Amazon's hls.js (1.5.11) cannot demux HEVC or E-AC-3 from MPEG-TS ("Unsupported HEVC in M2TS"), but hands
  // fragmented MP4 straight to the decoder. H.264 first: when the server has to encode, that is the cheap target.
  hlsContainer: 'mp4',
  hlsVideoCodecs: ['h264', 'hevc'],
  // isTypeSupported throws for ac-3 through MSE on the stick (see mseGuard.ts), so HLS audio is AAC.
  hlsAudioCodecs: ['aac'],
  maxWidth: 3840,
  maxHeight: 2160,
  maxBitrate: 40000000,
};

/** MIME + codec strings used to ask the device what it can decode. */
export const VIDEO_PROBES: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
};

export const AUDIO_PROBES: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  mp3: 'audio/mpeg',
};

export interface DecodingProbeConfig {
  type: 'media-source';
  video?: { contentType: string; width: number; height: number; bitrate: number; framerate: number };
  audio?: { contentType: string; channels?: string; bitrate?: number; samplerate?: number };
}

export type DecodingInfoFn = (config: DecodingProbeConfig) => Promise<{ supported: boolean }>;

async function supports(probe: DecodingInfoFn, config: DecodingProbeConfig): Promise<boolean> {
  try {
    const result = await probe(config);
    return result.supported === true;
  } catch {
    return false;
  }
}

/**
 * Narrows the defaults to what this device reports it can decode.
 * If the probe is unavailable, or would leave nothing for a media type, the defaults stand,
 * so a flaky probe can never produce a profile that rejects everything.
 */
export async function probeCapabilities(
  decodingInfo: DecodingInfoFn | undefined,
  base: DeviceCapabilities = DEFAULT_CAPABILITIES,
): Promise<DeviceCapabilities> {
  if (!decodingInfo) {
    return base;
  }

  const videoResults = await Promise.all(
    base.videoCodecs.map(async codec => {
      const contentType = VIDEO_PROBES[codec];
      if (!contentType) {
        return { codec, ok: true };
      }
      const ok = await supports(decodingInfo, {
        type: 'media-source',
        video: { contentType, width: 1920, height: 1080, bitrate: 10000000, framerate: 30 },
      });
      return { codec, ok };
    }),
  );
  const audioResults = await Promise.all(
    base.audioCodecs.map(async codec => {
      const contentType = AUDIO_PROBES[codec];
      if (!contentType) {
        return { codec, ok: true };
      }
      const ok = await supports(decodingInfo, {
        type: 'media-source',
        audio: { contentType },
      });
      return { codec, ok };
    }),
  );

  const video = videoResults.filter(r => r.ok).map(r => r.codec);
  const audio = audioResults.filter(r => r.ok).map(r => r.codec);

  const videoCodecs = video.length > 0 ? video : base.videoCodecs;
  // The server may copy any HLS video codec straight through, so one the device cannot decode leaves that list
  // too. H.264 stays as the encode target whatever the probe says.
  const hlsVideo = base.hlsVideoCodecs.filter(c => c === 'h264' || videoCodecs.includes(c));
  return {
    ...base,
    videoCodecs,
    audioCodecs: audio.length > 0 ? audio : base.audioCodecs,
    hlsVideoCodecs: hlsVideo.length > 0 ? hlsVideo : base.hlsVideoCodecs,
  };
}
