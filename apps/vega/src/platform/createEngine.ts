import * as W3C from '@amazon-devices/react-native-w3cmedia';
import {
  DEFAULT_CAPABILITIES,
  DIRECT_PLAY_START_TIMEOUT_MS,
  installTimerGuard,
  installTypeSupportGuard,
  PlayerEngine,
  probeCapabilities,
  type DecodingInfoFn,
  type DeviceCapabilities,
  type MediaElementLike,
} from '@anystream/core';
import { HlsJsPlayer } from '../hlsjsplayer/HlsJsPlayer';
import DocumentPolyfill from '../hlsjsplayer/polyfills/DocumentPolyfill';
import ElementPolyfill from '../hlsjsplayer/polyfills/ElementPolyfill';
import MiscPolyfill from '../hlsjsplayer/polyfills/MiscPolyfill';
import TextDecoderPolyfill from '../hlsjsplayer/polyfills/TextDecoderPolyfill';
import W3CMediaPolyfill from '../hlsjsplayer/polyfills/W3CMediaPolyfill';

let polyfillsInstalled = false;

/** hls.js expects a browser; Amazon's polyfills provide the pieces it needs. Install once per launch. */
function installPolyfills(): void {
  if (polyfillsInstalled) {
    return;
  }
  DocumentPolyfill.install();
  ElementPolyfill.install();
  TextDecoderPolyfill.install();
  W3CMediaPolyfill.install();
  MiscPolyfill.install();
  installTimerGuard();
  installTypeSupportGuard();
  polyfillsInstalled = true;
}

export function createPlayerEngine(): PlayerEngine {
  return new PlayerEngine({
    prepare: installPolyfills,
    directPlayTimeoutMs: DIRECT_PLAY_START_TIMEOUT_MS,
    createElement: () => new W3C.VideoPlayer() as unknown as MediaElementLike,
    createAdaptiveLoader: element => {
      if ((HlsJsPlayer as unknown as { isStub?: boolean }).isStub) {
        throw new Error(
          'HLS playback needs the Amazon hls.js build. See apps/vega/src/hlsjsplayer/README.md.',
        );
      }
      return new HlsJsPlayer(element as unknown as W3C.VideoPlayer);
    },
    // Amazon's hls.js build locates the active player through this global.
    setGlobalElement: element => {
      (globalThis as unknown as { gmedia: unknown }).gmedia = element;
    },
  });
}

/** Asks the device what it decodes. Falls back to safe defaults if the probe is unavailable. */
export function probeDeviceCapabilities(): Promise<DeviceCapabilities> {
  const decodingInfo = (W3C as unknown as { decodingInfo?: DecodingInfoFn }).decodingInfo;
  return probeCapabilities(typeof decodingInfo === 'function' ? decodingInfo : undefined).catch(
    () => DEFAULT_CAPABILITIES,
  );
}
