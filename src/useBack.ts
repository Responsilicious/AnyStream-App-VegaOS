import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Runs `handler` on the remote's Back key. Return true to keep the key (close a keyboard, go back a step);
 * false lets the platform have it, which leaves the app. The latest handler is used without re-subscribing.
 */
export function useBack(handler: () => boolean): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current());
    return () => sub.remove();
  }, []);
}
