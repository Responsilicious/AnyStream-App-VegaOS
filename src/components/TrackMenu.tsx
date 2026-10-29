import { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import type { TrackInfo, TrackSelection } from '../providers/types';
import { colors, type } from '../theme';
import { FocusButton } from './FocusButton';

interface Props {
  tracks: TrackInfo | undefined;
  selection: TrackSelection | undefined;
  /** Set while a new stream is being made, so a second choice cannot start another. */
  busy: boolean;
  /** The last change that failed, in plain words. */
  error: string | null;
  onChoose: (change: Partial<TrackSelection>) => void;
  onClose: () => void;
}

/**
 * The in-player menu that the remote's Menu button (three lines) opens: audio tracks and subtitles side by side
 * on a panel over the right of the picture. Back closes it and leaves playback running.
 */
export function TrackMenu({ tracks, selection, busy, error, onChoose, onClose }: Props) {
  const s = useScale();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const audio = tracks?.audio ?? [];
  const subtitles = tracks?.subtitles ?? [];
  const currentSubtitle = selection?.subtitleIndex ?? -1;
  // Focus starts on what is playing now, so one press of Select confirms it and arrows browse from there.
  const focusAudio = audio.some(a => a.index === selection?.audioIndex) ? selection?.audioIndex : audio[0]?.index;

  return (
    <View style={[styles.panel, { width: s(760), padding: s(40) }]}>
      <Text style={styles.title}>Audio and subtitles</Text>
      {busy ? <Text style={styles.note}>Switching…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.columns}>
        <View style={styles.column}>
          <Text style={styles.heading}>Audio</Text>
          <ScrollView>
            {audio.length === 0 ? <Text style={styles.empty}>Only one audio track.</Text> : null}
            {audio.map(option => (
              <FocusButton
                key={`a${option.index}`}
                label={`${option.index === selection?.audioIndex ? '✓  ' : ''}${option.label}`}
                primary={option.index === selection?.audioIndex}
                preferred={option.index === focusAudio}
                disabled={busy}
                onPress={() => onChoose({ audioIndex: option.index })}
                style={styles.option}
              />
            ))}
          </ScrollView>
        </View>
        <View style={styles.column}>
          <Text style={styles.heading}>Subtitles</Text>
          <ScrollView>
            <FocusButton
              label={`${currentSubtitle < 0 ? '✓  ' : ''}Off`}
              primary={currentSubtitle < 0}
              preferred={audio.length === 0}
              disabled={busy}
              onPress={() => onChoose({ subtitleIndex: -1 })}
              style={styles.option}
            />
            {subtitles.map(option => (
              <FocusButton
                key={`s${option.index}`}
                label={`${option.index === currentSubtitle ? '✓  ' : ''}${option.label}`}
                primary={option.index === currentSubtitle}
                disabled={busy}
                onPress={() => onChoose({ subtitleIndex: option.index })}
                style={styles.option}
              />
            ))}
          </ScrollView>
        </View>
      </View>
      <Text style={styles.note}>
        Subtitles are drawn into the picture by your server, so turning them on can take a moment to start.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(11,16,27,0.94)',
  },
  title: { color: colors.text, fontSize: type.title, fontWeight: '800', marginBottom: px(12) },
  columns: { flex: 1, flexDirection: 'row', marginTop: px(8) },
  column: { flex: 1, marginRight: px(24) },
  heading: { color: colors.accent, fontSize: type.body, fontWeight: '800', marginBottom: px(12) },
  option: { marginBottom: px(12), alignItems: 'flex-start' },
  empty: { color: colors.textMuted, fontSize: type.body },
  note: { color: colors.textMuted, fontSize: type.caption, marginTop: px(8) },
  error: { color: colors.danger, fontSize: type.body, marginTop: px(8) },
});
