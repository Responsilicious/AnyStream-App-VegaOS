import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import { colors, focus, type } from '../theme';

interface Props {
  title: string;
  subtitle?: string;
  /** A third line under the subtitle, such as "10 min left". */
  caption?: string;
  imageUrl?: string;
  /** 0 to 1. Draws the progress bar along the bottom of the artwork. */
  progress?: number;
  preferred?: boolean;
  /** Artwork width in layout units; the default is the 320 design pixel card. Height is always 16:9. */
  width?: number;
  onPress: () => void;
  /** Press and hold: opens the card menu. */
  onLongPress?: () => void;
  onFocus?: () => void;
  /** Drawn over the artwork's bottom-left corner, such as the server chip on a search card. */
  badge?: ReactNode;
}

/** A 320 × 180 landscape card (design pixels) with its title always beneath, as in docs/design.md section 4. */
export function WideCard({
  title,
  subtitle,
  caption,
  imageUrl,
  progress = 0,
  preferred,
  width: widthOverride,
  onPress,
  onLongPress,
  onFocus,
  badge,
}: Props) {
  const s = useScale();
  const [focused, setFocused] = useState(false);
  const width = widthOverride ?? s(320);
  const height = Math.round((width * 9) / 16);

  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, caption].filter(Boolean).join(', ')}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.card, { width: width + 2 * focus.borderWidth }, focused && styles.focused]}>
      <View style={[styles.art, { width, height }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width, height }} resizeMode="cover" />
        ) : (
          <View style={[styles.placeholder, { width, height }]}>
            <Text style={styles.placeholderText} numberOfLines={3}>
              {title}
            </Text>
          </View>
        )}
        {badge}
        {progress > 0 && (
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round(Math.min(1, progress) * 100)}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {caption ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: focus.borderWidth, borderColor: 'transparent', borderRadius: px(12), padding: 0 },
  focused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  art: { borderRadius: px(10), overflow: 'hidden', backgroundColor: colors.surface },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: px(16) },
  placeholderText: { color: colors.textMuted, fontSize: type.body, textAlign: 'center' },
  barTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(6), backgroundColor: 'rgba(255,255,255,0.3)' },
  barFill: { height: px(6), backgroundColor: colors.accent },
  title: { color: colors.text, fontSize: type.card, fontWeight: '600', marginTop: px(10) },
  subtitle: { color: colors.textMuted, fontSize: type.caption, marginTop: px(2) },
  caption: { color: colors.accent, fontSize: type.caption, marginTop: px(2), fontWeight: '600' },
});
