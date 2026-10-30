import type { PlaybackDecision } from '../providers/types';

/** The subset of Vega's VideoPlayer (an HTMLVideoElement) that the engine uses. */
export interface MediaElementLike {
  src: string;
  autoplay: boolean;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly error: { code: number; message?: string } | null;
  initialize(): Promise<void>;
  deinitialize(): Promise<void>;
  setSurfaceHandle(handle: string): void;
  clearSurfaceHandle(handle: string): void;
  setCaptionViewHandle(handle: string): void;
  clearCaptionViewHandle(handle: string): void;
  play(): void;
  pause(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

export interface StreamContent {
  secure: 'true' | 'false';
  uri: string;
  drm_scheme: string;
  drm_license_uri: string;
}

/** Amazon's patched hls.js wrapper: load a playlist, unload when done. */
export interface AdaptiveLoader {
  load(content: StreamContent, autoplay: boolean): Promise<void> | void;
  unload(): Promise<void> | void;
}

export interface EngineDeps {
  createElement(): MediaElementLike;
  createAdaptiveLoader(element: MediaElementLike): AdaptiveLoader;
  /** Runs once before the first element is created (hls.js needs browser shims on Vega). */
  prepare?(): void;
  /** Vega's hls.js build finds the active player through a global. */
  setGlobalElement?(element: MediaElementLike | null): void;
  /** How long direct play may take to start before it counts as failed (see DIRECT_PLAY_START_TIMEOUT_MS). */
  directPlayTimeoutMs?: number;
  /** Timers, injectable for tests. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export type EngineState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerFailure {
  /** True when the failure happened during direct play, so a transcode may still work. */
  recoverable: boolean;
  message: string;
  code?: number;
}

export interface EngineListener {
  onState?(state: EngineState): void;
  onTime?(positionMs: number, durationMs: number): void;
  onError?(failure: PlayerFailure): void;
}

const MEDIA_EVENTS = [
  'loadedmetadata',
  'playing',
  'pause',
  'waiting',
  'canplay',
  'seeked',
  'timeupdate',
  'ended',
  'error',
] as const;

/**
 * Owns one media element and one load at a time. The screen supplies the video surface;
 * the engine waits for it, loads the stream the server chose, and reports state changes.
 */
export class PlayerEngine {
  private element: MediaElementLike | null = null;
  private loader: AdaptiveLoader | null = null;
  private surface: string | null = null;
  private captions: string | null = null;
  private surfaceWaiters: Array<() => void> = [];
  private listeners = new Set<EngineListener>();
  private state: EngineState = 'idle';
  private decision: PlaybackDecision | null = null;
  private startMs = 0;
  private needsStartSeek = false;
  private released = false;
  /** Counts loads, so a start-up timer from an earlier load cannot fail a later one. */
  private loadCount = 0;
  private watchdog: unknown = null;

  constructor(private readonly deps: EngineDeps) {}

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): EngineState {
    return this.state;
  }

  getPositionMs(): number {
    return this.element ? Math.round(this.element.currentTime * 1000) : 0;
  }

  getDurationMs(): number {
    const seconds = this.element?.duration;
    if (seconds !== undefined && isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
    return this.decision?.durationMs ?? 0;
  }

  /** Creates and initialises the media element. Call once, before load. */
  async init(): Promise<void> {
    if (this.element) {
      return;
    }
    this.deps.prepare?.();
    await this.createElement();
  }

  /**
   * Swaps in a brand-new media element and loads the stream there. On the stick, giving a playing element a new
   * source hangs its native player while it shuts the old stream down (29 Oct 2026, subtitle switch), whereas
   * freeing the element, as leaving the player does, works. The surface and captions carry over.
   */
  async reload(decision: PlaybackDecision, startMs: number): Promise<void> {
    if (!this.element) {
      throw new Error('PlayerEngine.init() must finish before reload()');
    }
    await this.freeElement();
    if (this.released) {
      return;
    }
    await this.createElement();
    if (this.released || !this.element) {
      return;
    }
    await this.load(decision, startMs);
  }

  private async createElement(): Promise<void> {
    const element = this.deps.createElement();
    this.deps.setGlobalElement?.(element);
    await element.initialize();
    if (this.released) {
      await element.deinitialize();
      return;
    }
    element.autoplay = false;
    for (const type of MEDIA_EVENTS) {
      element.addEventListener(type, this.handleEvent);
    }
    this.element = element;
    if (this.surface) {
      element.setSurfaceHandle(this.surface);
    }
    if (this.captions) {
      element.setCaptionViewHandle(this.captions);
    }
  }

  /** Unloads and deinitialises the element, keeping the surface and captions for the next one. */
  private async freeElement(): Promise<void> {
    const element = this.element;
    await this.unloadCurrent();
    this.element = null;
    if (!element) {
      return;
    }
    for (const type of MEDIA_EVENTS) {
      element.removeEventListener(type, this.handleEvent);
    }
    if (this.captions) {
      element.clearCaptionViewHandle(this.captions);
    }
    if (this.surface) {
      element.clearSurfaceHandle(this.surface);
    }
    await element.deinitialize();
    this.deps.setGlobalElement?.(null);
  }

  /** The captions view exists (or was recreated). Text subtitles render there. */
  attachCaptions(handle: string): void {
    this.captions = handle;
    this.element?.setCaptionViewHandle(handle);
  }

  detachCaptions(handle: string): void {
    this.element?.clearCaptionViewHandle(handle);
    if (this.captions === handle) {
      this.captions = null;
    }
  }

  /** The video surface exists (or was recreated). Rendering starts once the player has a surface. */
  attachSurface(handle: string): void {
    this.surface = handle;
    this.element?.setSurfaceHandle(handle);
    const waiters = this.surfaceWaiters;
    this.surfaceWaiters = [];
    waiters.forEach(resolve => resolve());
  }

  detachSurface(handle: string): void {
    this.element?.clearSurfaceHandle(handle);
    if (this.surface === handle) {
      this.surface = null;
    }
  }

  async load(decision: PlaybackDecision, startMs: number): Promise<void> {
    if (!this.element) {
      throw new Error('PlayerEngine.init() must finish before load()');
    }
    await this.unloadCurrent();
    // Backing out can release the engine while the unload above is still in flight; registering a
    // surface wait after that would never be woken.
    if (this.released) {
      return;
    }
    this.decision = decision;
    this.startMs = Math.max(0, startMs);
    this.needsStartSeek = this.startMs > 0;
    this.setState('loading');

    if (!this.surface) {
      await new Promise<void>(resolve => this.surfaceWaiters.push(resolve));
    }
    if (this.released) {
      return;
    }

    const element = this.element;
    if (decision.mode === 'url') {
      element.autoplay = true;
      element.src = decision.url;
      this.armWatchdog();
    } else {
      this.loader = this.deps.createAdaptiveLoader(element);
      await this.loader.load(
        { secure: 'false', uri: decision.url, drm_scheme: '', drm_license_uri: '' },
        true,
      );
      // Amazon's sample starts the element once the surface is attached; the wrapper ignores its
      // autoplay flag, and without play() the stream never leaves buffering.
      if (!this.released) {
        element.play();
      }
    }
  }

  play(): void {
    this.element?.play();
  }

  pause(): void {
    this.element?.pause();
  }

  togglePlayPause(): void {
    if (!this.element) {
      return;
    }
    if (this.element.paused) {
      this.element.play();
    } else {
      this.element.pause();
    }
  }

  seekTo(ms: number): void {
    if (!this.element) {
      return;
    }
    const duration = this.getDurationMs();
    const clamped = duration > 0 ? Math.min(Math.max(0, ms), Math.max(0, duration - 1000)) : Math.max(0, ms);
    this.element.currentTime = clamped / 1000;
  }

  seekBy(deltaMs: number): void {
    this.seekTo(this.getPositionMs() + deltaMs);
  }

  /** Stops playback and frees the native player. Safe to call more than once. */
  async release(): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
    this.surfaceWaiters.forEach(resolve => resolve());
    this.surfaceWaiters = [];
    await this.freeElement();
    this.deps.setGlobalElement?.(null);
    this.surface = null;
    this.captions = null;
    this.listeners.clear();
  }

  /**
   * Direct play gets a deadline to show signs of life (metadata, or playing). The stick's player can stall on a
   * file it cannot decode without raising an error, and without an error the transcode fallback never runs.
   */
  private armWatchdog(): void {
    this.disarmWatchdog();
    const load = ++this.loadCount;
    const timeout = this.deps.directPlayTimeoutMs;
    if (!timeout || timeout <= 0) {
      return;
    }
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const handle: unknown = set(() => {
      // A cleared timer can still be called by a slow platform timer; only the armed one counts.
      if (this.watchdog !== handle) {
        return;
      }
      this.watchdog = null;
      if (this.released || load !== this.loadCount || this.decision?.mode !== 'url') {
        return;
      }
      this.setState('error');
      const failure: PlayerFailure = { recoverable: true, message: 'Direct play did not start' };
      this.listeners.forEach(l => l.onError?.(failure));
    }, timeout);
    this.watchdog = handle;
  }

  private disarmWatchdog(): void {
    if (this.watchdog !== null) {
      const clear = this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
      clear(this.watchdog);
      this.watchdog = null;
    }
  }

  private async unloadCurrent(): Promise<void> {
    this.disarmWatchdog();
    this.loadCount += 1;
    if (this.loader) {
      const loader = this.loader;
      this.loader = null;
      try {
        await loader.unload();
      } catch {
        // Unload failures must not block the next load or a release.
      }
    }
  }

  private setState(next: EngineState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.listeners.forEach(l => l.onState?.(next));
  }

  private readonly handleEvent = (event: { type?: string }): void => {
    const element = this.element;
    if (!element) {
      return;
    }
    switch (event.type) {
      case 'loadedmetadata':
        this.disarmWatchdog();
        if (this.needsStartSeek) {
          this.needsStartSeek = false;
          element.currentTime = this.startMs / 1000;
        }
        break;
      case 'playing':
        this.disarmWatchdog();
        this.setState('playing');
        break;
      case 'canplay':
      case 'seeked':
        if (this.state === 'buffering' || this.state === 'loading') {
          this.setState(element.paused ? 'paused' : 'playing');
        }
        break;
      case 'waiting':
        this.setState('buffering');
        break;
      case 'pause':
        if (!element.ended) {
          this.setState('paused');
        }
        break;
      case 'timeupdate':
        this.listeners.forEach(l => l.onTime?.(this.getPositionMs(), this.getDurationMs()));
        break;
      case 'ended':
        this.setState('ended');
        break;
      case 'error': {
        this.disarmWatchdog();
        const error = element.error;
        this.setState('error');
        const failure: PlayerFailure = {
          recoverable: this.decision?.method === 'DirectPlay',
          message: error?.message || 'Playback failed',
          code: error?.code,
        };
        this.listeners.forEach(l => l.onError?.(failure));
        break;
      }
      default:
        break;
    }
  };
}
