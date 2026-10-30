import { PROGRESS_INTERVAL_MS } from '../config';
import type {
  MediaItem,
  PlaybackDecision,
  PlaybackProvider,
  ProgressReport,
  StartChoice,
  TrackInfo,
  TrackSelection,
} from '../providers/types';
import type { EngineListener, EngineState, PlayerEngine, PlayerFailure } from './PlayerEngine';

export interface ControllerListener {
  onState?(state: EngineState): void;
  onTime?(positionMs: number, durationMs: number): void;
  /** Called only when playback has failed for good. */
  onFatalError?(message: string): void;
  /** The tracks the file offers and the ones now playing: after the start, and after every change. */
  onTracks?(tracks: TrackInfo | undefined, selection: TrackSelection | undefined): void;
}

export interface ControllerDeps {
  provider: PlaybackProvider;
  engine: PlayerEngine;
  progressIntervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/**
 * Runs one viewing from start to finish:
 *  ask the server how to deliver it, play it, keep the server told where we are,
 *  fall back to a transcode if direct play fails, and tidy up on exit.
 */
export class PlaybackController {
  private item: MediaItem | null = null;
  private decision: PlaybackDecision | null = null;
  private retriedWithTranscode = false;
  private startedReported = false;
  private timer: unknown = null;
  private stopped = false;
  private lastPositionMs = 0;
  private paused = false;
  /** The audio track the server plays when none is asked for: choosing it again needs no special stream. */
  private defaultAudio: number | undefined;
  private changing = false;
  private readonly listeners = new Set<ControllerListener>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts `item`, with the version and tracks chosen on its title page when there is a `choice`. */
  async start(item: MediaItem, choice?: StartChoice): Promise<void> {
    this.item = item;
    this.stopped = false;
    this.retriedWithTranscode = false;
    this.startedReported = false;
    this.lastPositionMs = item.resumeMs;

    const engineListener: EngineListener = {
      onState: state => this.handleState(state),
      onTime: (position, duration) => {
        this.lastPositionMs = position;
        this.listeners.forEach(l => l.onTime?.(position, duration));
      },
      onError: failure => {
        void this.handleFailure(failure);
      },
    };
    this.unsubscribe = this.deps.engine.subscribe(engineListener);

    try {
      this.decision = await this.deps.provider.getPlayback(item.id, { startMs: item.resumeMs, ...choice });
      console.log(`playback: ${describeDecision(this.decision)}`);
      this.defaultAudio = this.decision.defaultAudioIndex ?? this.decision.selection?.audioIndex;
      this.announceTracks();
      await this.deps.engine.load(this.decision, item.resumeMs);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Could not start playback');
    }
  }

  /** Reports the final position, stops any server-side encode, and frees the player. */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;

    const report = this.buildReport();
    const decision = this.decision;
    await this.deps.engine.release();

    if (report && this.startedReported) {
      await this.safely(() => this.deps.provider.reportStopped(report));
    }
    if (decision && decision.method === 'Transcode') {
      await this.safely(() => this.deps.provider.stopTranscode(decision));
    }
    this.listeners.clear();
  }

  /**
   * Plays a different audio track or subtitle. The server builds the new stream, so this asks for a fresh one at
   * the current position, tells the server the old viewing ended, and swaps. If the server cannot make the new
   * stream nothing changes and the error is thrown for the menu to show. Choosing what already plays does nothing.
   */
  async changeTracks(change: Partial<TrackSelection>): Promise<void> {
    const item = this.item;
    const current = this.decision?.selection;
    if (!item || !this.decision || this.stopped || this.changing) {
      return;
    }
    const next: TrackSelection = {
      audioIndex: change.audioIndex ?? current?.audioIndex,
      subtitleIndex: change.subtitleIndex ?? current?.subtitleIndex ?? -1,
    };
    if (next.audioIndex === current?.audioIndex && next.subtitleIndex === (current?.subtitleIndex ?? -1)) {
      return;
    }

    this.changing = true;
    try {
      const position = this.deps.engine.getPositionMs() || this.lastPositionMs;
      const fresh = await this.deps.provider.getPlayback(item.id, {
        startMs: position,
        mediaSourceId: this.decision.mediaSourceId,
        ...this.trackOptions(next),
      });
      if (this.stopped) {
        return;
      }
      // What was asked for and what the server's stream actually carries, for when a choice seems to do nothing.
      console.log(
        `tracks: asked audio=${next.audioIndex} subtitle=${next.subtitleIndex}; stream ${fresh.mode} ` +
          `burnedSubtitle=${/[?&]SubtitleMethod=Encode/i.test(fresh.url)} subtitleParam=${/[?&]SubtitleStreamIndex=/i.test(fresh.url)}`,
      );

      // The old viewing is over as far as the server is concerned.
      const oldReport = this.buildReport();
      const old = this.decision;
      this.clearTimer();
      if (oldReport && this.startedReported) {
        await this.safely(() => this.deps.provider.reportStopped(oldReport));
      }

      this.decision = fresh;
      this.startedReported = false;
      this.announceTracks();
      await this.deps.engine.reload(fresh, position);

      if (old && old.method === 'Transcode') {
        await this.safely(() => this.deps.provider.stopTranscode(old));
      }
    } finally {
      this.changing = false;
    }
  }

  /** What to ask the server for to get `selection`. The default audio track needs no special stream. */
  private trackOptions(selection: TrackSelection | undefined): { audioIndex?: number; subtitleIndex?: number } {
    if (!selection) {
      return {};
    }
    return {
      audioIndex: selection.audioIndex !== undefined && selection.audioIndex !== this.defaultAudio ? selection.audioIndex : undefined,
      subtitleIndex: selection.subtitleIndex >= 0 ? selection.subtitleIndex : undefined,
    };
  }

  private announceTracks(): void {
    const decision = this.decision;
    this.listeners.forEach(l => l.onTracks?.(decision?.tracks, decision?.selection));
  }

  private handleState(state: EngineState): void {
    this.listeners.forEach(l => l.onState?.(state));
    this.paused = state === 'paused';

    if (state === 'playing' && !this.startedReported) {
      this.startedReported = true;
      const report = this.buildReport();
      if (report) {
        void this.safely(() => this.deps.provider.reportStarted(report));
      }
      this.startTimer();
    }
    if (state === 'paused' || state === 'playing') {
      // Immediate update on pause/resume so other devices see the right state.
      const report = this.buildReport();
      if (report && this.startedReported) {
        void this.safely(() => this.deps.provider.reportProgress(report));
      }
    }
    if (state === 'ended') {
      this.clearTimer();
    }
  }

  private async handleFailure(failure: PlayerFailure): Promise<void> {
    if (this.stopped || !this.item) {
      return;
    }
    // Direct play can fail on files the device claims to support. One retry as an HLS transcode.
    if (failure.recoverable && !this.retriedWithTranscode) {
      this.retriedWithTranscode = true;
      try {
        const resumeFrom = this.deps.engine.getPositionMs() || this.item.resumeMs;
        this.decision = await this.deps.provider.getPlayback(this.item.id, {
          startMs: resumeFrom,
          forceTranscode: true,
          mediaSourceId: this.decision?.mediaSourceId,
          ...this.trackOptions(this.decision?.selection),
        });
        console.log(`playback: direct play failed (${failure.message}); ${describeDecision(this.decision)}`);
        this.announceTracks();
        await this.deps.engine.load(this.decision, resumeFrom);
        return;
      } catch (e) {
        this.fail(e instanceof Error ? e.message : failure.message);
        return;
      }
    }
    this.fail(failure.message);
  }

  private fail(message: string): void {
    this.clearTimer();
    this.listeners.forEach(l => l.onFatalError?.(message));
  }

  private buildReport(): ProgressReport | null {
    if (!this.item || !this.decision) {
      return null;
    }
    return {
      item: this.item,
      decision: this.decision,
      positionMs: this.deps.engine.getPositionMs() || this.lastPositionMs,
      paused: this.paused,
    };
  }

  private startTimer(): void {
    this.clearTimer();
    const set = this.deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = set(() => {
      const report = this.buildReport();
      if (report) {
        void this.safely(() => this.deps.provider.reportProgress(report));
      }
    }, this.deps.progressIntervalMs ?? PROGRESS_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      const clear = this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as any));
      clear(this.timer);
      this.timer = null;
    }
  }

  /** Progress reporting is best effort: a dropped report must never interrupt playback. */
  private async safely(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // ignored on purpose
    }
  }
}

/**
 * How a stream is delivered, for the device log: mode, method and the URL with tokens removed. The URL's codec
 * and TranscodeReasons parameters say why a file was not played directly.
 */
export function describeDecision(decision: PlaybackDecision): string {
  const url = decision.url.replace(/([?&](?:api_key|X-Plex-Token|ApiKey)=)[^&]*/gi, '$1...');
  return `${decision.mode} ${decision.method} ${url}`;
}
