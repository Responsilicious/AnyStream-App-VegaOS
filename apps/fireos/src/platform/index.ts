import type { Platform } from '@anystream/core';
import { createPlayerEngine, probeDeviceCapabilities } from './createEngine';
import { useTVEventHandler } from './keys';
import { readLocalNetwork } from './network';
import { createMmkvStore } from './storage';
import { VideoSurface } from './VideoSurface';

/**
 * Fire OS (Android TV) on Fire TV sticks with Fire OS 6 and 7: ExoPlayer through react-native-video, MMKV,
 * NetInfo. Secure random comes from react-native-get-random-values (installed in index.js), which the core
 * finds on globalThis.crypto, so no randomBytes here.
 */
export const fireosPlatform: Platform = {
  name: 'fireos',
  createPlayerEngine,
  probeDeviceCapabilities,
  createKeyValueStore: createMmkvStore,
  readLocalNetwork,
  useTVEventHandler,
  VideoSurface,
};
