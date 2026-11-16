import { useEffect, useRef } from 'react';
import type { TVKeyEvent, TypedKey } from '@anystream/core';
import { dispatchBack } from './back';
import { moveFocus, type Direction } from './spatialNavigation';

/**
 * The keyboard as a TV remote. Keys are mapped to the names the shared screens switch on (Vega's), arrows move
 * focus between controls as a D-pad does, Enter presses the focused control (react-native-web does that), and
 * Escape or Backspace is the remote's Back. While an on-screen keyboard is open, letters, digits, symbols and
 * Backspace type into its field instead.
 */
const KEY_NAMES: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'select',
  ' ': 'playpause',
  MediaPlayPause: 'playpause',
  MediaPlay: 'playpause',
  MediaPause: 'playpause',
  MediaFastForward: 'forward',
  MediaRewind: 'rewind',
  MediaTrackNext: 'skip_forward',
  MediaTrackPrevious: 'skip_backward',
  ContextMenu: 'menu',
  m: 'menu',
  M: 'menu',
};

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

type TVHandler = (event: TVKeyEvent) => void;
type TypedHandler = (key: TypedKey) => boolean;

const tvHandlers = new Set<{ current: TVHandler }>();
/** Newest last: only the most recently mounted keyboard gets typing. */
const typedHandlers: Array<{ current: TypedHandler }> = [];

/** Sends a remote key to every screen listening, as a press then a release. For mouse gestures too. */
export function emitTVKey(eventType: string): void {
  tvHandlers.forEach(h => h.current({ eventType, eventKeyAction: 0 }));
  tvHandlers.forEach(h => h.current({ eventType, eventKeyAction: 1 }));
}

function emit(eventType: string, eventKeyAction: number): void {
  tvHandlers.forEach(h => h.current({ eventType, eventKeyAction }));
}

function inEditableField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/** Typing, ahead of everything else so a focused key on the on-screen keyboard is not also pressed by Space. */
function onTypingKey(event: KeyboardEvent): void {
  const handler = typedHandlers[typedHandlers.length - 1];
  if (!handler || hasModifier(event) || inEditableField(event.target)) {
    return;
  }
  let key: TypedKey | null = null;
  if (event.key === 'Backspace' || event.key === 'Delete') {
    key = { type: 'delete' };
  } else if (event.key.length === 1 || /^\p{L}$/u.test(event.key)) {
    key = { type: 'text', value: event.key };
  }
  if (key && handler.current(key)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || hasModifier(event)) {
    return;
  }
  const editing = inEditableField(event.target);
  if (event.key === 'Escape' || event.key === 'BrowserBack' || (event.key === 'Backspace' && !editing)) {
    event.preventDefault();
    dispatchBack();
    return;
  }
  const direction = DIRECTIONS[event.key];
  if (direction && !(editing && (direction === 'left' || direction === 'right'))) {
    event.preventDefault();
    moveFocus(direction);
  }
  if (event.key === ' ' && !editing) {
    // The page must not scroll; Space is play/pause.
    event.preventDefault();
  }
  const name = KEY_NAMES[event.key];
  if (name && !(editing && name !== 'select' && !direction)) {
    emit(name, 0);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  const name = KEY_NAMES[event.key];
  if (name && !hasModifier(event) && !inEditableField(event.target)) {
    emit(name, 1);
  }
}

/** Starts listening to the keyboard. Call once at start-up. */
export function installKeyboard(): void {
  window.addEventListener('keydown', onTypingKey, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

export function useTVEventHandler(handler: TVHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    tvHandlers.add(ref);
    return () => {
      tvHandlers.delete(ref);
    };
  }, []);
}

export function useTypedText(handler: TypedHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    typedHandlers.push(ref);
    return () => {
      const index = typedHandlers.indexOf(ref);
      if (index >= 0) {
        typedHandlers.splice(index, 1);
      }
    };
  }, []);
}
