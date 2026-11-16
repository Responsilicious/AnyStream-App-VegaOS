import { useEffect, useRef, useState } from 'react';
import type { VideoSurfaceProps } from '@anystream/core';
import { dispatchBack } from './back';
import { emitTVKey } from './keys';
import { registerSurface, unregisterSurface } from './videoElement';

/** How long the mouse controls stay up after the pointer last moved. */
const MOUSE_CONTROLS_MS = 2500;

let nextHandle = 1;

/**
 * The host <div> the engine's <video> moves into. Keyboard control is the shared player's (Space or Enter
 * pauses, arrows skip, Down or M opens audio and subtitles, Escape leaves). For the mouse: a click pauses or
 * plays, a double click toggles full screen, a right click opens audio and subtitles, and moving the pointer
 * shows a Back button.
 */
export function VideoSurface({ onSurfaceViewCreated, onSurfaceViewDestroyed }: VideoSurfaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [mouseControls, setMouseControls] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) {
      return undefined;
    }
    const handle = `web-video-${nextHandle++}`;
    registerSurface(handle, node);
    onSurfaceViewCreated(handle);
    return () => {
      onSurfaceViewDestroyed(handle);
      unregisterSurface(handle);
    };
  }, [onSurfaceViewCreated, onSurfaceViewDestroyed]);

  useEffect(
    () => () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    },
    [],
  );

  const onMouseMove = () => {
    setMouseControls(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => setMouseControls(false), MOUSE_CONTROLS_MS);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <div
      ref={host}
      style={{ position: 'absolute', inset: 0, backgroundColor: '#000', cursor: mouseControls ? 'default' : 'none' }}
      onMouseMove={onMouseMove}
      onClick={() => emitTVKey('select')}
      onDoubleClick={toggleFullscreen}
      onContextMenu={event => {
        event.preventDefault();
        emitTVKey('menu');
      }}>
      {mouseControls && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Back"
          onClick={event => {
            event.stopPropagation();
            dispatchBack();
          }}
          style={backButton}>
          ‹ Back
        </button>
      )}
    </div>
  );
}

const backButton = {
  position: 'absolute' as const,
  zIndex: 2,
  left: 48,
  top: 40,
  padding: '14px 28px',
  borderRadius: 12,
  border: 'none',
  background: 'rgba(0, 0, 0, 0.6)',
  color: '#fff',
  fontSize: 28,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
