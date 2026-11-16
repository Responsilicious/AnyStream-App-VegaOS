/**
 * React Native's BackHandler for the browser. react-native-web's own is a stub, but the shared screens close
 * menus and leave pages on the remote's Back key, so this one keeps the handlers and runs them, newest first
 * (as on a TV), when the keyboard, the mouse's back button or the browser's Back button asks.
 */
type Handler = () => boolean | null | undefined;

const handlers: Handler[] = [];

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', handler: Handler): { remove(): void } {
    handlers.push(handler);
    return { remove: () => removeHandler(handler) };
  },
  removeEventListener(_event: 'hardwareBackPress', handler: Handler): void {
    removeHandler(handler);
  },
  /** A web page cannot quit; Back on the first screen simply does nothing. */
  exitApp(): void {},
};

function removeHandler(handler: Handler): void {
  const index = handlers.lastIndexOf(handler);
  if (index >= 0) {
    handlers.splice(index, 1);
  }
}

/** Runs the Back handlers, newest first, until one keeps the key. True when one did. */
export function dispatchBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) {
      return true;
    }
  }
  return false;
}

/**
 * The browser's Back button (and a mouse's back button, which browsers send the same way) goes back inside
 * the app. One extra history entry sits on top of the page; a Back pops it, the app handles the key, and the
 * entry goes back on. When nothing in the app wants the key (the first screen), the page is left alone so a
 * second Back leaves the site as usual.
 */
export function installHistoryBack(): void {
  const marker = { anystream: true };
  history.pushState(marker, '');
  window.addEventListener('popstate', () => {
    if (dispatchBack()) {
      history.pushState(marker, '');
    }
  });
}
