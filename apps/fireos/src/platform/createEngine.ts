import {
  DEFAULT_CAPABILITIES,
  DIRECT_PLAY_START_TIMEOUT_MS,
  SEEK_DEBOUNCE_MS,
  PlayerEngine,
  type DeviceCapabilities,
  type MediaElementLike,
} from '@anystream/core';
import { Platform } from 'react-native';
import { FireVideoElement } from './videoElement';

export function createPlayerEngine(): PlayerEngine {
  return new PlayerEngine({
    directPlayTimeoutMs: DIRECT_PLAY_START_TIMEOUT_MS,
    seekDebounceMs: SEEK_DEBOUNCE_MS,
    createElement: () => new FireVideoElement(),
    // ExoPlayer plays HLS itself, so the "adaptive loader" just hands the playlist to the element.
    createAdaptiveLoader: element => ({
      load: content => {
        element.autoplay = true;
        element.src = content.uri;
      },
      unload: () => {
        element.src = '';
      },
    }),
  });
}

/**
 * Fire TV models that output 4K. Android's display modes and MediaCodecList are not reachable from JS without a
 * native module, so anything else (the Lite, 3rd gen, unknown models) is treated as 1080p: the server scales 4K
 * down for it rather than sending a picture the stick may not decode.
 */
const UHD_MODELS = new Set(['AFTMM', 'AFTKA', 'AFTKM', 'AFTKRT', 'AFTA', 'AFTR', 'AFTN', 'AFTGAZL']);

/**
 * What ExoPlayer plays on Fire OS. Unlike Vega's hls.js it reads MKV and MPEG-TS itself, HEVC included, and Fire
 * TV sticks decode Dolby Digital and Digital Plus, so MKV plays directly and HLS keeps the original audio.
 */
export function fireosCapabilities(model: string | undefined): DeviceCapabilities {
  const uhd = model !== undefined && UHD_MODELS.has(model.toUpperCase());
  return {
    ...DEFAULT_CAPABILITIES,
    audioCodecs: ['aac', 'ac3', 'eac3', 'mp3', 'flac'],
    directPlayContainers: ['mp4', 'm4v', 'mkv', 'mov'],
    hlsContainer: 'ts',
    hlsVideoCodecs: ['h264', 'hevc'],
    hlsAudioCodecs: ['aac', 'ac3', 'eac3'],
    maxWidth: uhd ? 3840 : 1920,
    maxHeight: uhd ? 2160 : 1080,
  };
}

export function probeDeviceCapabilities(): Promise<DeviceCapabilities> {
  const model = (Platform.constants as { Model?: string }).Model;
  console.log(`AnyStream device model: ${model}`);
  return Promise.resolve(fireosCapabilities(model));
}

export type { MediaElementLike };
