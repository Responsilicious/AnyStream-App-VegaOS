import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import type { Platform } from '@anystream/core';
import { createPlayerEngine, probeDeviceCapabilities } from './createEngine';
import { readLocalNetwork } from './network';
import { keplerRandom } from './random';
import { createMmkvStore } from './storage';
import { VideoSurface } from './VideoSurface';

/** Vega OS (Fire TV Stick 4K Select and other Vega sticks): Amazon's media stack, MMKV, netmgr and keplercrypto. */
export const vegaPlatform: Platform = {
  name: 'vega',
  createPlayerEngine,
  probeDeviceCapabilities,
  createKeyValueStore: createMmkvStore,
  readLocalNetwork,
  randomBytes: keplerRandom(),
  useTVEventHandler,
  VideoSurface,
};
