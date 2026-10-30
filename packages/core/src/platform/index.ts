import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { LocalNetwork } from '../discovery';
import type { PlayerEngine } from '../player/PlayerEngine';
import type { DeviceCapabilities } from '../providers/types';
import type { RandomBytes } from '../providers/plex/keys';
import type { KeyValueStore } from '../storage/keyValueStore';

/**
 * Everything the app needs from the device that differs between Vega and Fire OS. The core never imports a
 * native module itself; each app shell builds one of these and hands it over with `setPlatform` before the
 * first render. Unit tests run with no platform set and only touch the pure modules.
 */

/** A remote key event. Vega and react-native-tvos both report `eventKeyAction` 0 for press and 1 for release. */
export interface TVKeyEvent {
  eventType: string;
  eventKeyAction?: number;
}

/** What the player screen asks the platform to draw: the video surface and, where separate, the captions view. */
export interface VideoSurfaceProps {
  onSurfaceViewCreated(handle: string): void;
  onSurfaceViewDestroyed(handle: string): void;
  onCaptionViewCreated(handle: string): void;
  onCaptionViewDestroyed(handle: string): void;
  captionsStyle?: StyleProp<ViewStyle>;
}

export interface Platform {
  name: 'vega' | 'fireos';
  /** The media element and adaptive loader for this device, wrapped in the shared engine. */
  createPlayerEngine(): PlayerEngine;
  /** What the device decodes. Must resolve; fall back to safe defaults rather than reject. */
  probeDeviceCapabilities(): Promise<DeviceCapabilities>;
  /** Persistent app-private storage (tokens, preferences). */
  createKeyValueStore(): KeyValueStore;
  /** The TV's IPv4 address and netmask for "Find servers on this network", or null when unknown. */
  readLocalNetwork(): Promise<LocalNetwork | null>;
  /** A cryptographically secure random source, or undefined when the device has none (Plex linking then uses legacy tokens). */
  randomBytes?: RandomBytes;
  /** Subscribes to remote key events for the life of the calling component. A React hook. */
  useTVEventHandler(handler: (event: TVKeyEvent) => void): void;
  VideoSurface: ComponentType<VideoSurfaceProps>;
}

let current: Platform | null = null;

/** Called once by the app shell before rendering `App`. */
export function setPlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (!current) {
    throw new Error('AnyStream: setPlatform() must be called before the app renders');
  }
  return current;
}

/** True once a shell has registered a platform (false in unit tests). */
export function hasPlatform(): boolean {
  return current !== null;
}

export function useTVEventHandler(handler: (event: TVKeyEvent) => void): void {
  platform().useTVEventHandler(handler);
}
