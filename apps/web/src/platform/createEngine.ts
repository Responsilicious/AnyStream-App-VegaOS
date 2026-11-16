import Hls, { ErrorTypes, Events, type ErrorData } from 'hls.js';
import {
  DIRECT_PLAY_START_TIMEOUT_MS,
  SEEK_DEBOUNCE_MS,
  PlayerEngine,
  type AdaptiveLoader,
  type DeviceCapabilities,
  type MediaElementLike,
} from '@anystream/core';
import { webCapabilities } from './capabilities';
import { WebVideoElement } from './videoElement';

/** How often a fatal media error is retried in place before the film fails (hls.js's recoverMediaError). */
const MEDIA_RECOVERIES = 1;

/**
 * HLS through the public hls.js build where the browser has Media Source Extensions (Chrome, Edge, Firefox),
 * and the browser's own HLS player where it has one instead (Safari, iOS).
 */
function createLoader(element: MediaElementLike): AdaptiveLoader {
  const web = element as WebVideoElement;
  let hls: Hls | null = null;
  return {
    load: content => {
      if (Hls.isSupported()) {
        let recoveries = 0;
        hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60 });
        hls.on(Events.ERROR, (_event, data: ErrorData) => {
          if (!data.fatal || !hls) {
            return;
          }
          if (data.type === ErrorTypes.MEDIA_ERROR && recoveries < MEDIA_RECOVERIES) {
            recoveries += 1;
            hls.recoverMediaError();
            return;
          }
          console.log(`AnyStream web: hls.js fatal ${data.type} ${data.details}`);
          web.failFromLoader(data.type === ErrorTypes.NETWORK_ERROR ? 'The stream stopped loading' : 'This stream could not be played');
        });
        hls.loadSource(content.uri);
        hls.attachMedia(web.video);
        return;
      }
      web.src = content.uri;
    },
    unload: () => {
      hls?.destroy();
      hls = null;
    },
  };
}

export function createPlayerEngine(): PlayerEngine {
  return new PlayerEngine({
    directPlayTimeoutMs: DIRECT_PLAY_START_TIMEOUT_MS,
    seekDebounceMs: SEEK_DEBOUNCE_MS,
    createElement: () => new WebVideoElement(),
    createAdaptiveLoader: createLoader,
  });
}

export function probeDeviceCapabilities(): Promise<DeviceCapabilities> {
  const caps = webCapabilities();
  console.log(`AnyStream web capabilities: video ${caps.videoCodecs.join(',')}; audio ${caps.audioCodecs.join(',')}`);
  return Promise.resolve(caps);
}
