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

/** The last tile of a reel, the same size as a card: a way to the full list for the genre. */
export function ViewAllTile({ onPress, onFocus }: { onPress: () => void; onFocus?: () => void }) {
  const s = useScale();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel="View all"
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.tileOuter, { width: s(320) + 2 * focus.borderWidth }, focused && styles.tileFocused]}>
      <View style={[styles.tile, { width: s(320), height: s(180) }]}>
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
