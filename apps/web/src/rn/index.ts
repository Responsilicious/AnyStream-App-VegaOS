/**
 * What the shared app gets when it imports 'react-native' in the web build (the bundler points the name here).
 * It is react-native-web, plus the few TV behaviours the screens rely on that react-native-web leaves out.
 */
import { createElement, forwardRef, useEffect, useRef, type ForwardedRef } from 'react';
import { Pressable as WebPressable } from 'react-native-web';
import { STAGE_METRICS } from '../platform/stage';

export * from 'react-native-web';
export { BackHandler } from '../platform/back';

/** `hasTVPreferredFocus`: on a TV the control takes focus when it appears; react-native-web ignores the prop. */
export const Pressable = forwardRef(function Pressable(props: any, ref: ForwardedRef<unknown>) {
  const node = useRef<HTMLElement | null>(null);
  const preferred = props.hasTVPreferredFocus === true && props.focusable !== false && !props.disabled;
  useEffect(() => {
    if (preferred) {
      node.current?.focus?.();
    }
  }, [preferred]);
  const setRef = (value: HTMLElement | null) => {
    node.current = value;
    if (typeof ref === 'function') {
      ref(value);
    } else if (ref) {
      ref.current = value;
    }
  };
  return createElement(WebPressable as any, { ...props, ref: setRef });
});

type Metrics = typeof STAGE_METRICS;

/** The app renders into a fixed 1920 × 1080 stage (see platform/stage.ts), so that is the window it sees. */
export const Dimensions = {
  get(_dim: 'window' | 'screen'): Metrics {
    return STAGE_METRICS;
  },
  addEventListener(): { remove(): void } {
    return { remove: () => undefined };
  },
  set(): void {},
};

export function useWindowDimensions(): Metrics {
  return STAGE_METRICS;
}
