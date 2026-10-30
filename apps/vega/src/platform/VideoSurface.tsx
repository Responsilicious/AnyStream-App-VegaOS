import { StyleSheet } from 'react-native';
import { KeplerCaptionsView, KeplerVideoSurfaceView } from '@amazon-devices/react-native-w3cmedia';
import type { VideoSurfaceProps } from '@anystream/core';

/** Vega draws video and text subtitles in two native views; the engine gets a handle for each. */
export function VideoSurface({
  onSurfaceViewCreated,
  onSurfaceViewDestroyed,
  onCaptionViewCreated,
  onCaptionViewDestroyed,
  captionsStyle,
}: VideoSurfaceProps) {
  return (
    <>
      <KeplerVideoSurfaceView
        style={StyleSheet.absoluteFill}
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
      />
      <KeplerCaptionsView
        style={captionsStyle}
        show
        onCaptionViewCreated={onCaptionViewCreated}
        onCaptionViewDestroyed={onCaptionViewDestroyed}
      />
    </>
  );
}
