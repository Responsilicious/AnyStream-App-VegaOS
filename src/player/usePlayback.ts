import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaItem, PlaybackProvider, StartChoice, TrackInfo, TrackSelection } from '../providers/types';
import { SEEK_STEP_MS } from '../config';
import { createPlayerEngine } from './createEngine';
import { PlaybackController } from './PlaybackController';
import type { EngineState, PlayerEngine } from './PlayerEngine';

export interface PlaybackView {
  state: EngineState;
  positionMs: number;
  durationMs: number;
  error: string | null;
  onSurfaceViewCreated(handle: string): void;
  onSurfaceViewDestroyed(handle: string): void;
  onCaptionViewCreated(handle: string): void;
  onCaptionViewDestroyed(handle: string): void;
  togglePlayPause(): void;
  seekBy(deltaMs: number): void;
  skipForward(): void;
  skipBack(): void;
  /** The file's audio and subtitle tracks, once the server has said. */
  tracks: TrackInfo | undefined;
  /** The tracks now playing. */
  selection: TrackSelection | undefined;
  /** Switches track; rejects with a readable message when the server cannot make that stream. */
  changeTracks(change: Partial<TrackSelection>): Promise<void>;
}

/** React binding for one viewing. Mount it, give the surface props to the video view, unmount to stop. */
export function usePlayback(provider: PlaybackProvider, item: MediaItem, choice?: StartChoice): PlaybackView {
  const [state, setState] = useState<EngineState>('loading');
  const [positionMs, setPositionMs] = useState(item.resumeMs);
  const [durationMs, setDurationMs] = useState(item.runtimeMs ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo | undefined>(undefined);
  const [selection, setSelection] = useState<TrackSelection | undefined>(undefined);

  const engineRef = useRef<PlayerEngine | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  // The native surface can appear before the engine exists; remember the handles and hand them over later.
  const surfaceRef = useRef<string | null>(null);
  const captionsRef = useRef<string | null>(null);
  // Read once at the start: the choice belongs to this viewing, and changing it later goes through changeTracks.
  const choiceRef = useRef(choice);

  useEffect(() => {
    let cancelled = false;
    const engine = createPlayerEngine();
    const controller = new PlaybackController({ provider, engine });
    engineRef.current = engine;
    controllerRef.current = controller;

    let lastSecond = -1;
    controller.subscribe({
      onState: next => setState(next),
      // The element ticks several times a second; the UI only shows whole seconds.
      onTime: (position, duration) => {
        const second = Math.floor(position / 1000);
        if (second !== lastSecond) {
          lastSecond = second;
          setPositionMs(position);
        }
        setDurationMs(prev => (duration > 0 && duration !== prev ? duration : prev));
      },
      onFatalError: message => setError(message),
      onTracks: (nextTracks, nextSelection) => {
        setTracks(nextTracks);
        setSelection(nextSelection);
      },
    });

    if (surfaceRef.current) {
      engine.attachSurface(surfaceRef.current);
    }
    if (captionsRef.current) {
      engine.attachCaptions(captionsRef.current);
    }

    (async () => {
      try {
        await engine.init();
        if (!cancelled) {
          await controller.start(item, choiceRef.current);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not start playback');
        }
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current = null;
      controllerRef.current = null;
      void controller.stop();
    };
  }, [provider, item]);

  const onSurfaceViewCreated = useCallback((handle: string) => {
    surfaceRef.current = handle;
    engineRef.current?.attachSurface(handle);
  }, []);

  const onSurfaceViewDestroyed = useCallback((handle: string) => {
    if (surfaceRef.current === handle) {
      surfaceRef.current = null;
    }
    engineRef.current?.detachSurface(handle);
  }, []);

  const onCaptionViewCreated = useCallback((handle: string) => {
    captionsRef.current = handle;
    engineRef.current?.attachCaptions(handle);
  }, []);

  const onCaptionViewDestroyed = useCallback((handle: string) => {
    if (captionsRef.current === handle) {
      captionsRef.current = null;
    }
    engineRef.current?.detachCaptions(handle);
  }, []);

  const togglePlayPause = useCallback(() => engineRef.current?.togglePlayPause(), []);
  const seekBy = useCallback((deltaMs: number) => engineRef.current?.seekBy(deltaMs), []);
  const skipForward = useCallback(() => engineRef.current?.seekBy(SEEK_STEP_MS), []);
  const skipBack = useCallback(() => engineRef.current?.seekBy(-SEEK_STEP_MS), []);
  const changeTracks = useCallback(async (change: Partial<TrackSelection>) => {
    await controllerRef.current?.changeTracks(change);
  }, []);

  return {
    state,
    positionMs,
    durationMs,
    error,
    onSurfaceViewCreated,
    onSurfaceViewDestroyed,
    onCaptionViewCreated,
    onCaptionViewDestroyed,
    togglePlayPause,
    seekBy,
    skipForward,
    skipBack,
    tracks,
    selection,
    changeTracks,
  };
}
