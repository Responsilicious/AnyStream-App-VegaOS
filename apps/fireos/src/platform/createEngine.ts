import {
  DEFAULT_CAPABILITIES,
  DIRECT_PLAY_START_TIMEOUT_MS,
  SEEK_DEBOUNCE_MS,
  PlayerEngine,
  type DeviceCapabilities,
  type MediaElementLike,
} from '@anystream/core';
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
 * What the device decodes. Fire OS sticks differ (the 2nd gen 4K stick does HEVC and AV1, the Lite does not),
 * and Android's MediaCodecList is not reachable from JS without a native module, so for now every Fire OS device
 * gets the same conservative set as Vega: H.264 and HEVC in MP4 direct, everything else through the server.
 * Widen this only after testing on the device in question.
 */
export function probeDeviceCapabilities(): Promise<DeviceCapabilities> {
  return Promise.resolve(DEFAULT_CAPABILITIES);
}

export type { MediaElementLike };
