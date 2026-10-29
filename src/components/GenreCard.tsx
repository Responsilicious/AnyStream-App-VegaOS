import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, focus, type } from '../theme';
import { px } from '../layout';

interface Props {
  name: string;
  imageUrl?: string;
  width: number;
  height: number;
  preferred?: boolean;
  onPress: () => void;
  onFocus?: () => void;
}

/** A genre as a wide picture tile with its name over a dark wash, so the name stays readable on any art. */
export function GenreCard({ name, imageUrl, width, height, preferred, onPress, onFocus }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={name}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.card, { width: width + 2 * focus.borderWidth }, focused && styles.focused]}>
      <View style={[styles.art, { width, height }]}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={{ width, height }} resizeMode="cover" /> : null}
        <View style={styles.wash} />
        {/* The label fills the tile and centres itself, so a two-line name can never run past the tile edge. */}
        <View style={styles.label}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: focus.borderWidth, borderColor: 'transparent', borderRadius: px(12) },
  focused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  art: { borderRadius: px(10), overflow: 'hidden', backgroundColor: colors.surface },
  wash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,16,27,0.55)' },
  label: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', paddingHorizontal: px(20), paddingVertical: px(8) },
  // An explicit line height: without one the platform can pick a taller default and clip the second line.
  name: { color: colors.text, fontSize: type.card, lineHeight: Math.round(type.card * 1.25), fontWeight: '700' },
});
