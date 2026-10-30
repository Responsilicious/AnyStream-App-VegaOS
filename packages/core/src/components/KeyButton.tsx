import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { px } from '../layout';
import { colors, focus, type } from '../theme';

interface Props {
  label: string;
  preferred?: boolean;
  onPress: () => void;
}

const SIZE = 68;
const GAP = 10;

/** One key of the on-screen keyboard. Squares in a grid, with the standard focus outline. */
export function KeyButton({ label, preferred, onPress }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.key, focused && styles.focused]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  key: {
    width: px(SIZE),
    height: px(SIZE),
    marginRight: px(GAP),
    borderRadius: px(10),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focused: { borderColor: colors.focusRing, backgroundColor: colors.surfaceFocused },
  label: { color: colors.text, fontSize: type.card, fontWeight: '700' },
});
