import type { MediaElementLike } from '@anystream/core';

/**
 * The shared PlayerEngine drives an HTMLVideoElement-like object. On Fire OS the real player is ExoPlayer inside
 * react-native-video's <Video>, a React component, so this object keeps the element state (source, paused,
 * position) and the mounted VideoSurface mirrors it into <Video> props and feeds the player's callbacks back as
 * media events. One element per load: the engine makes a fresh one for every stream, as it does on Vega.
 */

export interface VideoError {
  code: number;
  message?: string;
}

type Listener = (event: { type: string }) => void;

export class FireVideoElement implements MediaElementLike {
  autoplay = false;
  currentTime = 0;
  duration = NaN;
  paused = true;
  ended = false;
  error: VideoError | null = null;

  /** Increments on every change the view must render; the surface re-renders when it moves. */
  version = 0;
  /** Set by the surface when the native player is live, so seeks can be sent to it. */
  seekTo: ((seconds: number) => void) | null = null;

  private source = '';
  private listeners = new Map<string, Set<Listener>>();
  private watchers = new Set<() => void>();
  /** A seek asked for before the player had loaded, applied on the first onLoad. */
  private pendingSeek: number | null = null;

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    if (value === this.source) {
      return;
    }
    this.source = value;
    this.ended = false;
    this.error = null;
    this.duration = NaN;
    if (this.autoplay && value) {
      this.paused = false;
    }
    this.bump();
  }

  /** Where the surface reads what to render. */
  get view(): { uri: string; paused: boolean } {
    return { uri: this.source, paused: this.paused || !this.source };
  }

  async initialize(): Promise<void> {
    elementStore.set(this);
  }

  async deinitialize(): Promise<void> {
    this.source = '';
    this.paused = true;
    this.seekTo = null;
    if (elementStore.current === this) {
      elementStore.set(null);
    }
    this.bump();
  }

  // Fire OS draws the video inside the surface component itself; there are no native handles to pass around.
  setSurfaceHandle(): void {}
  clearSurfaceHandle(): void {}
  setCaptionViewHandle(): void {}
  clearCaptionViewHandle(): void {}

  play(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.bump();
  }

  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.bump();
  }

  /** The engine assigns currentTime to seek; the surface hands over the player's seek once it is ready. */
  seek(seconds: number): void {
    this.currentTime = seconds;
    if (this.seekTo) {
      this.seekTo(seconds);
    } else {
      this.pendingSeek = seconds;
    }
  }

  takePendingSeek(): number | null {
    const seek = this.pendingSeek;
    this.pendingSeek = null;
    return seek;
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Called by the surface with what the player reported. State is updated before the engine hears about it. */
  dispatch(type: string): void {
    const event = { type };
    this.listeners.get(type)?.forEach(listener => listener(event));
  }

  /** The surface re-renders when the element's view changes. */
  watch(callback: () => void): () => void {
    this.watchers.add(callback);
    return () => this.watchers.delete(callback);
  }

  private bump(): void {
    this.version += 1;
    this.watchers.forEach(w => w());
  }
}

/**
 * The element currently playing, for the one mounted VideoSurface. The engine creates and frees elements; the
 * surface follows whichever is live. Mirrors Vega's `gmedia` global without the global.
 */
class ElementStore {
  current: FireVideoElement | null = null;
  private subscribers = new Set<() => void>();

  set(element: FireVideoElement | null): void {
    if (this.current === element) {
      return;
    }
    this.current = element;
    this.subscribers.forEach(s => s());
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

export const elementStore = new ElementStore();

/** Seeks go through `currentTime` in the engine; intercept the assignment so the player hears about it. */
Object.defineProperty(FireVideoElement.prototype, 'currentTime', {
  get(this: FireVideoElement & { _time?: number }) {
    return this._time ?? 0;
  },
  set(this: FireVideoElement & { _time?: number; _fromPlayer?: boolean }, seconds: number) {
    const previous = this._time ?? 0;
    this._time = seconds;
    // The surface updates the position as the player plays; only a change from the engine is a seek.
    if (!this._fromPlayer && Math.abs(seconds - previous) > 0.001) {
      this.seek(seconds);
    }
  },
  configurable: true,
});

/** For the surface: record the player's own progress without triggering a seek. */
export function reportTime(element: FireVideoElement, seconds: number): void {
  const e = element as FireVideoElement & { _fromPlayer?: boolean };
  e._fromPlayer = true;
  try {
    element.currentTime = seconds;
  } finally {
    e._fromPlayer = false;
  }
}
