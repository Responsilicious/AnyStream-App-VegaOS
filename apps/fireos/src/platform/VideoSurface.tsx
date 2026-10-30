import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Video, { type OnBufferData, type OnLoadData, type OnProgressData, type OnVideoErrorData, type VideoRef } from 'react-native-video';
import type { VideoSurfaceProps } from '@anystream/core';
import { elementStore, reportTime, type FireVideoElement } from './videoElement';

/** How often ExoPlayer reports its position. The engine only shows whole seconds. */
const PROGRESS_INTERVAL_MS = 500;

/**
 * ExoPlayer, through react-native-video, following whichever element the engine has live. Fire OS has no
 * separate captions view: ExoPlayer renders the stream's subtitle tracks itself (HLS WebVTT, or burned-in).
 */
export function VideoSurface({ onSurfaceViewCreated, onSurfaceViewDestroyed }: VideoSurfaceProps) {
  const [element, setElement] = useState<FireVideoElement | null>(elementStore.current);
  const [, setVersion] = useState(0);
  const ref = useRef<VideoRef>(null);

  // The surface is "created" as soon as it mounts; the engine waits for this before loading.
  useEffect(() => {
    onSurfaceViewCreated('fireos-video');
    return () => onSurfaceViewDestroyed('fireos-video');
  }, [onSurfaceViewCreated, onSurfaceViewDestroyed]);

  useEffect(() => elementStore.subscribe(() => setElement(elementStore.current)), []);

  useEffect(() => {
    if (!element) {
      return;
    }
    const stop = element.watch(() => setVersion(v => v + 1));
    element.seekTo = seconds => ref.current?.seek(seconds);
    return () => {
      stop();
      if (element.seekTo) {
        element.seekTo = null;
      }
    };
  }, [element]);

  // Android only routes remote keys through the React root view while some view inside it has focus, and the
  // player screen has nothing focusable while a film plays. This invisible sink keeps focus (and takes it back
  // when the track menu closes), so useTVEventHandler keeps hearing the remote.
  const focusSink = <View focusable hasTVPreferredFocus style={styles.focusSink} />;

  if (!element || !element.view.uri) {
    return focusSink;
  }
  const { uri, paused } = element.view;

  const onLoad = (data: OnLoadData) => {
    element.duration = data.duration;
    reportTime(element, data.currentTime);
    element.dispatch('loadedmetadata');
    const pending = element.takePendingSeek();
    if (pending !== null) {
      ref.current?.seek(pending);
    }
    element.dispatch('canplay');
  };

  const onProgress = (data: OnProgressData) => {
    reportTime(element, data.currentTime);
    if (data.seekableDuration > 0 && data.seekableDuration !== element.duration) {
      element.duration = data.seekableDuration;
    }
    element.dispatch('timeupdate');
  };

  const onBuffer = (data: OnBufferData) => {
    element.dispatch(data.isBuffering ? 'waiting' : 'canplay');
  };

  const onPlaybackStateChanged = (data: { isPlaying: boolean }) => {
    if (data.isPlaying) {
      element.dispatch('playing');
    } else if (!element.ended && element.paused) {
      element.dispatch('pause');
    }
  };

  const onEnd = () => {
    element.ended = true;
    element.paused = true;
    element.dispatch('ended');
  };

  const onError = (data: OnVideoErrorData) => {
    const detail = data.error as { errorString?: string; errorCode?: string; code?: number } | undefined;
    element.error = { code: 4, message: detail?.errorString ?? detail?.errorCode ?? 'Playback failed' };
    element.dispatch('error');
  };

  return (
    <>
      <Video
        key={uri}
        ref={ref}
        style={StyleSheet.absoluteFill}
        source={{ uri }}
        paused={paused}
        resizeMode="contain"
        controls={false}
        disableFocus
        progressUpdateInterval={PROGRESS_INTERVAL_MS}
        onLoad={onLoad}
        onProgress={onProgress}
        onBuffer={onBuffer}
        onPlaybackStateChanged={onPlaybackStateChanged}
        onSeek={() => element.dispatch('seeked')}
        onEnd={onEnd}
        onError={onError}
      />
      {focusSink}
    </>
  );
}

const styles = StyleSheet.create({
  focusSink: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 },
});
