import type { Platform } from '@anystream/core';
import { createPlayerEngine, probeDeviceCapabilities } from './createEngine';
import { useTVEventHandler, useTypedText } from './keys';
import { browserName } from './device';
import { createWebStore } from './storage';
import { VideoSurface } from './VideoSurface';

/**
 * Desktop browsers: <video> with hls.js, localStorage, the keyboard as the remote. A web page cannot read its
 * machine's network address, so "Find servers on this network" is unavailable and servers are added by address.
 * Secure random comes from crypto.getRandomValues, which the core finds by itself.
 */
export const webPlatform: Platform = {
  name: 'web',
  deviceName: browserName(navigator.userAgent),
  label: 'the web',
  createPlayerEngine,
  probeDeviceCapabilities,
  createKeyValueStore: createWebStore,
  readLocalNetwork: () => Promise.resolve(null),
  useTVEventHandler,
  useTypedText,
  VideoSurface,
};
