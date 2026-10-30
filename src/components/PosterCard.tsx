import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MediaItem } from '../providers/types';
import { colors, focus, type } from '../theme';
import { px } from '../layout';

interface Props {
  item: MediaItem;
  width: number;
  onPress: (item: MediaItem) => void;
  preferred?: boolean;
  /** False while a panel covers the grid, so the remote cannot reach cards behind it. */
  focusable?: boolean;
  /** Reports the card that has focus, so the page can put focus back on it later. */
  onFocused?: (item: MediaItem) => void;
}

/** A poster tile. Scales up and gains a ring when focused; shows a resume bar for partly watched titles. */
export function PosterCard({ item, width, onPress, preferred, focusable = true, onFocused }: Props) {
  const [focused, setFocused] = useState(false);
  const height = Math.round(width * 1.5);
  const progress =
    item.resumeMs > 0 && item.runtimeMs ? Math.min(1, item.resumeMs / item.runtimeMs) : 0;

  return (
    <Pressable
      focusable={focusable}
      hasTVPreferredFocus={preferred && focusable}
      accessibilityRole="button"
      accessibilityLabel={item.year ? `${item.title}, ${item.year}` : item.title}
      onFocus={() => {
        setFocused(true);
        onFocused?.(item);
      }}
      onBlur={() => setFocused(false)}
      onPress={() => onPress(item)}
      style={[styles.card, { width }, focused && styles.focused]}>
      <View style={[styles.poster, { width, height }]}>
        {item.posterUrl ? (
          <Image source={{ uri: item.posterUrl }} style={{ width, height }} resizeMode="cover" />
        ) : (
          <View style={[styles.placeholder, { width, height }]}>
            <Text style={styles.placeholderText} numberOfLines={3}>
              {item.title}
            </Text>
          </View>
        )}
        {progress > 0 && (
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginRight: px(16), marginBottom: px(24), borderWidth: focus.borderWidth, borderColor: 'transparent', borderRadius: px(12), padding: px(4) },
  focused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  poster: { borderRadius: px(8), overflow: 'hidden', backgroundColor: colors.surface },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: px(12) },
  placeholderText: { color: colors.textMuted, fontSize: type.caption, textAlign: 'center' },
  title: { color: colors.text, fontSize: type.card, marginTop: px(8) },
  barTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(6), backgroundColor: 'rgba(255,255,255,0.3)' },
  barFill: { height: px(6), backgroundColor: colors.accent },
});
