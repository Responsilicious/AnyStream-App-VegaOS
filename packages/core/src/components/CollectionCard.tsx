import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import { colors, focus, type } from '../theme';

interface Props {
  title: string;
  /** The line under the title: a member's type ("Movie · 1999"). Left out on collection cards. */
  caption?: string;
  /** Portrait artwork from the server. Without it a plain branded tile shows the title, never another title's art. */
  imageUrl?: string;
  width: number;
  /** What a screen reader says; defaults to the title and caption. */
  spokenLabel?: string;
  preferred?: boolean;
  /** False while a panel covers the page, so the remote cannot reach cards behind it. */
  focusable?: boolean;
  /** Shown instead of the caption when this card cannot be opened (an item type the app has no page for). */
  unavailable?: string;
  onFocus?: () => void;
  onPress: () => void;
}

/**
 * A portrait card for a collection or one of its members (docs/collections.md). Title always below the art, never
 * over it; one white focus ring; the art is decoration and takes no input of its own.
 */
export function CollectionCard({ title, caption, imageUrl, width, spokenLabel, preferred, focusable = true, unavailable, onFocus, onPress }: Props) {
  const [focused, setFocused] = useState(false);
  const height = Math.round(width * 1.5);
  const spoken = spokenLabel ?? [title, caption, unavailable].filter(Boolean).join(', ');
  return (
    <Pressable
      focusable={focusable}
      hasTVPreferredFocus={preferred && focusable}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.card, { width: width + 2 * (focus.borderWidth + px(4)) }, focused && styles.focused]}>
      <View style={[styles.art, { width, height }]} importantForAccessibility="no-hide-descendants">
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width, height }} resizeMode="cover" />
        ) : (
          <View style={[styles.fallback, { width, height }]}>
            <View style={styles.fallbackMark} />
            <Text style={styles.fallbackText} numberOfLines={4}>
              {title}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {unavailable ? (
        <Text style={styles.unavailable} numberOfLines={2}>
          {unavailable}
        </Text>
      ) : caption ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: focus.borderWidth, borderColor: 'transparent', borderRadius: px(12), padding: px(4) },
  focused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  art: { borderRadius: px(8), overflow: 'hidden', backgroundColor: colors.surface },
  fallback: { alignItems: 'center', justifyContent: 'center', padding: px(16), backgroundColor: colors.surfaceFocused },
  // A short cyan bar: the brand accent, so a missing poster still looks deliberate.
  fallbackMark: { width: px(48), height: px(6), borderRadius: px(3), backgroundColor: colors.accent, marginBottom: px(16) },
  fallbackText: { color: colors.text, fontSize: type.body, fontWeight: '700', textAlign: 'center' },
  title: { color: colors.text, fontSize: type.card, fontWeight: '600', marginTop: px(8) },
  caption: { color: colors.textMuted, fontSize: type.caption, marginTop: px(2) },
  unavailable: { color: colors.danger, fontSize: type.caption, marginTop: px(2) },
});
