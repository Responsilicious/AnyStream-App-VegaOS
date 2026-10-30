import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { platform, useTVEventHandler } from '../platform';
import { FocusButton } from '../components/FocusButton';
import { TrackMenu } from '../components/TrackMenu';
import { usePlayback } from '../player/usePlayback';
import { describeError, isJellyfinError } from '../providers/jellyfin';
import type { MediaItem, PlaybackProvider, StartChoice, TrackSelection } from '../providers/types';
import { colors, spacing, type } from '../theme';
import { formatClock } from '../util/ticks';
import { px } from '../layout';

interface Props {
  provider: PlaybackProvider;
  item: MediaItem;
  /** The version and tracks chosen on the title page, if any. */
  choice?: StartChoice;
  onExit: () => void;
}

const OVERLAY_HIDE_MS = 5000;

export function PlayerScreen({ provider, item, choice, onExit }: Props) {
  const { VideoSurface } = platform();
  const playback = usePlayback(provider, item, choice);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuError(null);
  }, []);

  const chooseTracks = useCallback(
    async (change: Partial<TrackSelection>) => {
      setMenuBusy(true);
      setMenuError(null);
      try {
        await playback.changeTracks(change);
        setMenuOpen(false);
      } catch (e) {
        setMenuError(
          isJellyfinError(e) ? describeError(e) : 'That track could not be played. The current one is still playing.',
        );
      } finally {
        setMenuBusy(false);
      }
    },
    [playback],
  );

  const showOverlay = useCallback(() => {
    setOverlayVisible(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => setOverlayVisible(false), OVERLAY_HIDE_MS);
  }, []);

  useEffect(() => {
    showOverlay();
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, [showOverlay]);

  // Back leaves the player (and so stops playback and reports the position).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onExit();
      return true;
    });
    return () => subscription.remove();
  }, [onExit]);

  useTVEventHandler(event => {
    // Every key fires twice: 0 = pressed, 1 = released. Act on the press only. While the menu is open its own
    // buttons take the keys, so Select must not also pause the film behind it.
    if (playback.error || event.eventKeyAction === 1 || menuOpen) {
      return;
    }
    // Logged so the name the stick gives each remote key can be read back if a key does nothing.
    console.log(`player key: ${event.eventType}`);
    switch (event.eventType) {
      // The remote's Menu button (three lines) opens audio and subtitles. Down does too, as a fallback in case the
      // stick names the Menu key differently.
      case 'menu':
      case 'more':
      case 'down':
        setMenuOpen(true);
        return;
      case 'select':
      case 'playpause':
        playback.togglePlayPause();
        break;
      case 'right':
      case 'forward':
      case 'skip_forward':
        playback.skipForward();
        break;
      case 'left':
      case 'rewind':
      case 'skip_backward':
        playback.skipBack();
        break;
      default:
        break;
    }
    showOverlay();
  });

  const progress = playback.durationMs > 0 ? Math.min(1, playback.positionMs / playback.durationMs) : 0;
  const busy = playback.state === 'loading' || playback.state === 'buffering';

  return (
    <View style={styles.screen}>
      <VideoSurface
        onSurfaceViewCreated={playback.onSurfaceViewCreated}
        onSurfaceViewDestroyed={playback.onSurfaceViewDestroyed}
        onCaptionViewCreated={playback.onCaptionViewCreated}
        onCaptionViewDestroyed={playback.onCaptionViewDestroyed}
        captionsStyle={styles.captions}
      />

      {busy && !playback.error && (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={colors.text} size="large" />
        </View>
      )}

      {playback.error ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>Playback problem</Text>
          <Text style={styles.errorBody}>{playback.error}</Text>
          <FocusButton label="Back" primary preferred onPress={onExit} />
        </View>
      ) : (
        overlayVisible && (
          <Pressable focusable={false} style={styles.overlay} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <View style={styles.times}>
              <Text style={styles.time}>{formatClock(playback.positionMs)}</Text>
              <Text style={styles.time}>{playback.state === 'paused' ? 'Paused' : '☰  Menu: audio and subtitles'}</Text>
              <Text style={styles.time}>{formatClock(playback.durationMs)}</Text>
            </View>
          </Pressable>
        )
      )}

      {menuOpen && !playback.error ? (
        <TrackMenu
          tracks={playback.tracks}
          selection={playback.selection}
          busy={menuBusy}
          error={menuError}
          onChoose={change => void chooseTracks(change)}
          onClose={closeMenu}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  captions: { position: 'absolute', left: 0, right: 0, bottom: px(120), top: 0 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.safeMargin,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  title: { color: colors.text, fontSize: type.heading, fontWeight: '700', marginBottom: spacing.gap },
  bar: { height: px(8), borderRadius: px(4), backgroundColor: 'rgba(255,255,255,0.3)' },
  barFill: { height: px(8), borderRadius: px(4), backgroundColor: colors.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: px(8) },
  time: { color: colors.text, fontSize: type.caption },
  errorPanel: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', padding: spacing.safeMargin },
  errorTitle: { color: colors.text, fontSize: type.title, fontWeight: '800', marginBottom: spacing.gap },
  errorBody: { color: colors.textMuted, fontSize: type.body, textAlign: 'center', marginBottom: spacing.gapLarge, maxWidth: 800 },
});
