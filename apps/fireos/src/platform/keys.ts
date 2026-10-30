import { useTVEventHandler as useNativeTVEventHandler, type HWEvent } from 'react-native';
import type { TVKeyEvent } from '@anystream/core';

/**
 * Android TV key names as react-native-tvos reports them, mapped to the names the shared screens switch on
 * (which are Vega's). Unknown keys pass through lower-cased.
 */
const KEY_NAMES: Record<string, string> = {
  playPause: 'playpause',
  play: 'playpause',
  pause: 'playpause',
  fastForward: 'forward',
  rewind: 'rewind',
  skipForward: 'skip_forward',
  skipBackward: 'skip_backward',
  select: 'select',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  menu: 'menu',
  info: 'more',
};

export function useTVEventHandler(handler: (event: TVKeyEvent) => void): void {
  useNativeTVEventHandler((event: HWEvent) => {
    const name = event.eventType ?? '';
    handler({
      eventType: KEY_NAMES[name] ?? name.toLowerCase(),
      // Android reports 0 for a press and 1 for a release, as Vega does; the screens act on the press.
      eventKeyAction: event.eventKeyAction,
    });
  });
}
