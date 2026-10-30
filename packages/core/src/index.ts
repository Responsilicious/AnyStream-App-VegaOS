/**
 * @anystream/core: everything in AnyStream that is the same on every TV. An app shell (apps/vega, apps/fireos)
 * registers its Platform and renders App.
 */
export { App } from './App';
export { setPlatform, hasPlatform, type Platform, type TVKeyEvent, type VideoSurfaceProps } from './platform';
export { PlayerEngine, type MediaElementLike, type AdaptiveLoader, type EngineDeps, type StreamContent } from './player/PlayerEngine';
export { DEFAULT_CAPABILITIES, probeCapabilities, type DecodingInfoFn } from './player/capabilities';
export { installTypeSupportGuard } from './player/mseGuard';
export { installTimerGuard } from './player/timerGuard';
export { MemoryStore, type KeyValueStore } from './storage/keyValueStore';
export { splitCidr, type LocalNetwork } from './discovery';
export type { RandomBytes } from './providers/plex/keys';
export type { DeviceCapabilities } from './providers/types';
export { DIRECT_PLAY_START_TIMEOUT_MS, SEEK_DEBOUNCE_MS, STORE_BUILD, APP_VERSION } from './config';
