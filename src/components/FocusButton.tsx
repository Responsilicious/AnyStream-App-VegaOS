import { useState } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, focus, type } from '../theme';
import { px } from '../layout';

interface Props {
  label: string;
  onPress: () => void;
  /** Gets focus when the screen appears, so the remote works without a first click. */
  preferred?: boolean;
  disabled?: boolean;
  primary?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The one button used everywhere: always shows a clear focus state for D-pad navigation. */
export function FocusButton({ label, onPress, preferred, disabled, primary, style }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.base,
        primary && styles.primary,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
      ]}>
      <Text style={[styles.label, primary && styles.primaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: px(64),
    paddingHorizontal: px(32),
    borderRadius: px(12),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  focused: { borderColor: colors.focusRing, transform: [{ scale: focus.scale }] },
  disabled: { opacity: 0.4 },
  label: { color: colors.text, fontSize: type.body, fontWeight: '600' },
  primaryLabel: { color: colors.accentText },
});
