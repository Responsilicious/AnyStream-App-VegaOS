import type { MediaElementLike } from '@anystream/core';

/**
 * A real <video> element dressed as the media element the shared PlayerEngine drives. The engine makes one per
 * load and frees it afterwards, as on Vega; this one moves into whichever surface (a <div> in the player
 * screen) is registered under the handle the engine passes, and leaves it on release.
 */

const surfaces = new Map<string, HTMLElement>();

/** The player screen's surface registers its host <div> under a handle before telling the engine about it. */
export function registerSurface(handle: string, host: HTMLElement): void {
  surfaces.set(handle, host);
}

export function unregisterSurface(handle: string): void {
  surfaces.delete(handle);
}

export class WebVideoElement implements MediaElementLike {
  readonly video: HTMLVideoElement;
  /** A failure reported by hls.js, which the <video> itself does not know about. */
  private loaderError: { code: number; message?: string } | null = null;

  constructor() {
    const video = document.createElement('video');
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    Object.assign(video.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      backgroundColor: '#000',
    });
    this.video = video;
  }

  get src(): string {
    return this.video.getAttribute('src') ?? '';
  }

  set src(value: string) {
    this.loaderError = null;
    if (value) {
      this.video.src = value;
    } else {
      this.video.removeAttribute('src');
      this.video.load();
    }
  }

  get autoplay(): boolean {
    return this.video.autoplay;
  }

  set autoplay(value: boolean) {
    this.video.autoplay = value;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  set currentTime(seconds: number) {
    this.video.currentTime = seconds;
  }

  get duration(): number {
    return this.video.duration;
  }

  get paused(): boolean {
    return this.video.paused;
  }

  get ended(): boolean {
    return this.video.ended;
  }

  get error(): { code: number; message?: string } | null {
    if (this.loaderError) {
      return this.loaderError;
    }
    const e = this.video.error;
    return e ? { code: e.code, message: e.message || undefined } : null;
  }

  async initialize(): Promise<void> {}

  async deinitialize(): Promise<void> {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }

  setSurfaceHandle(handle: string): void {
    surfaces.get(handle)?.appendChild(this.video);
  }

  clearSurfaceHandle(handle: string): void {
    if (this.video.parentElement && this.video.parentElement === surfaces.get(handle)) {
      this.video.remove();
    }
  }

  // Subtitles are burned in by the server or carried in the stream; there is no separate captions view.
  setCaptionViewHandle(): void {}
  clearCaptionViewHandle(): void {}

  play(): void {
    const started = this.video.play();
    // A browser may refuse to start sound without a recent click or key press (autoplay policy). The film then
    // waits paused, and the viewer's next Play starts it.
    started?.catch((e: unknown) => console.log(`AnyStream web: play() refused: ${String(e)}`));
  }

  pause(): void {
    this.video.pause();
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    this.video.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.video.removeEventListener(type, listener);
  }

  /** hls.js gave up: report it through the element's own `error` event, as a native failure would be. */
  failFromLoader(message: string): void {
    this.loaderError = { code: 4, message };
    this.video.dispatchEvent(new Event('error'));
  }
}
