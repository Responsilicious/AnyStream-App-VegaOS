import type { DeviceCapabilities } from '@anystream/core';
// The module itself, not the package index, so unit tests can load this without React Native.
import { DEFAULT_CAPABILITIES } from '@anystream/core/src/player/capabilities';

/** Asks Media Source Extensions (what hls.js plays through) or, without it, the <video> element. */
export function canDecode(type: string): boolean {
  const mse = (globalThis as { MediaSource?: { isTypeSupported(t: string): boolean } }).MediaSource;
  try {
    if (mse && mse.isTypeSupported(type)) {
      return true;
    }
    return document.createElement('video').canPlayType(type) === 'probably';
  } catch {
    return false;
  }
}

/** Codec questions for the browser: one answer per codec name the servers use. */
const VIDEO_TYPES: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
};

const AUDIO_TYPES: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mpeg',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  flac: 'audio/mp4; codecs="flac"',
  opus: 'audio/mp4; codecs="opus"',
};

/**
 * What this browser decodes. Unlike a TV's probe, a desktop browser's MediaSource answers are reliable, so the
 * lists are built from them; H.264 and AAC stay in whatever the answers, as every browser plays them. HEVC only
 * appears where the browser has a hardware decoder for it (Safari, Edge, Chrome on most recent machines).
 * Browsers do not open MKV, so only MP4 plays directly and the server remuxes everything else to HLS in
 * fragmented MP4, which hls.js and Safari both take with HEVC inside.
 */
export function webCapabilities(decode: (type: string) => boolean = canDecode): DeviceCapabilities {
  const video = Object.keys(VIDEO_TYPES).filter(c => c === 'h264' || decode(VIDEO_TYPES[c]));
  const audio = Object.keys(AUDIO_TYPES).filter(c => c === 'aac' || decode(AUDIO_TYPES[c]));
  return {
    ...DEFAULT_CAPABILITIES,
    videoCodecs: video,
    audioCodecs: audio,
    directPlayContainers: ['mp4', 'm4v'],
    // The browser opens http and https alike (an https page cannot reach an http server at all: mixed content).
    directPlayNeedsHttps: false,
    directPlayVideoCodecs: undefined,
    hlsContainer: 'mp4',
    hlsVideoCodecs: video,
    // AC-3 and E-AC-3 are copied into the stream only where MSE plays them (Safari, Edge on Windows).
    hlsAudioCodecs: audio.filter(c => c === 'aac' || c === 'ac3' || c === 'eac3' || c === 'mp3'),
  };
}
