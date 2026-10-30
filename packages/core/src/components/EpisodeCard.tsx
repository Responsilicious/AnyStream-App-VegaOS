import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import type { MediaItem } from '../providers/types';
import { episodeStatus, progressOf } from '../titlePage';
import { colors, focus, type } from '../theme';
import { episodeLabel } from '../util/format';
import { ProgressBar } from './TitleParts';

interface Props {
  episode: MediaItem;
  /** The episode the details panel is showing: cyan border and a "Selected" label. Not the same as focus. */
  selected: boolean;
  onPress: () => void;
}

/** An episode in the row: still, "E4 · The Signal", and a text status. Pressing it selects it; it never plays. */
export function EpisodeCard({ episode, selected, onPress }: Props) {
  const s = useScale();
  const [focused, setFocused] = useState(false);
  const width = s(320);
  const height = s(180);
  const label = episodeLabel(episode).replace(/^S\d+\s*/, '');
  const progress = progressOf(episode);

  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${episode.title}, ${episodeStatus(episode)}${selected ? ', selected' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.card,
        { width: width + 2 * focus.borderWidth },
        selected && styles.selected,
        focused && styles.focused,
      ]}>
      <View style={[styles.art, { width, height }]}>
        {episode.thumbUrl || episode.landscapeUrl ? (
          <Image source={{ uri: episode.thumbUrl ?? episode.landscapeUrl }} style={{ width, height }} resizeMode="cover" />
        ) : null}
        {selected ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Selected</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {label ? `${label}  ·  ${episode.title}` : episode.title}
      </Text>
      <View style={styles.status}>
        {episode.played ? <Text style={styles.check}>✓</Text> : null}
        {progress > 0 ? <ProgressBar progress={progress} width={px(110)} /> : null}
        <Text style={[styles.statusText, progress > 0 && styles.statusLeft]} numberOfLines={1}>
          {episodeStatus(episode)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: focus.borderWidth, borderColor: 'transparent', borderRadius: px(12) },
  selected: { borderColor: colors.accent },
  focused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  art: { borderRadius: px(10), overflow: 'hidden', backgroundColor: colors.surface },
  badge: {
    position: 'absolute',
    top: px(10),
    right: px(10),
    paddingHorizontal: px(12),
    paddingVertical: px(4),
    borderRadius: px(8),
    backgroundColor: colors.accent,
  },
  badgeText: { color: colors.accentText, fontSize: type.caption, fontWeight: '700' },
  title: { color: colors.text, fontSize: type.card, fontWeight: '700', marginTop: px(10) },
  status: { flexDirection: 'row', alignItems: 'center', marginTop: px(4) },
  check: { color: colors.accent, fontSize: type.body, fontWeight: '800', marginRight: px(8) },
  statusText: { color: colors.textMuted, fontSize: type.caption },
  statusLeft: { marginLeft: px(10), color: colors.text },
});
