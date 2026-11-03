import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import { colors, focus, type } from '../theme';

/** "View all ›" at the right of a reel heading. */
export function ViewAllLink({ label = 'View all', onPress }: { label?: string; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.link, focused && styles.linkFocused]}>
      <Text style={styles.linkText}>{`${label}  ›`}</Text>
    </Pressable>
  );
}

/**
 * The last tile of a reel, the same size as a card: a way to the full list. 320 × 180 by default (wide cards);
 * a poster reel passes its own size.
 */
export function ViewAllTile({
  onPress,
  onFocus,
  width = 320,
  height = 180,
  label = 'View all',
}: {
  onPress: () => void;
  onFocus?: () => void;
  /** Design pixels. */
  width?: number;
  height?: number;
  /** What a screen reader says, such as "View all collections". */
  label?: string;
}) {
  const s = useScale();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.tileOuter, { width: s(width) + 2 * focus.borderWidth }, focused && styles.tileFocused]}>
      <View style={[styles.tile, { width: s(width), height: s(height) }]}>
        <Text style={styles.tileText}>{'View all  ›'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { paddingHorizontal: px(16), paddingVertical: px(6), borderRadius: px(10), borderWidth: focus.borderWidth, borderColor: 'transparent' },
  linkFocused: { borderColor: colors.focusRing, backgroundColor: colors.surface },
  linkText: { color: colors.text, fontSize: type.card, fontWeight: '600' },
  tileOuter: { borderWidth: focus.borderWidth, borderColor: 'transparent', borderRadius: px(12) },
  tileFocused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  tile: { borderRadius: px(10), backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: colors.text, fontSize: type.heading, fontWeight: '700' },
});
