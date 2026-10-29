import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { px } from '../layout';
import { colors, focus, type } from '../theme';
import { Glyph, type GlyphName } from './Glyph';

interface Props {
  label: string;
  onPress: () => void;
  icon?: GlyphName;
  primary?: boolean;
  preferred?: boolean;
  disabled?: boolean;
  /** Smaller, for buttons that sit in a row (Quick Connect). */
  compact?: boolean;
  /** Text only, no fill or border until focused (Change server). */
  link?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The full-width buttons of the entry screens (docs/design/*-mockup.png): cyan with dark text for the one
 * primary action, outlined navy for the rest, an icon before the label, and the white focus outline.
 * No scale on focus, so stacked buttons never touch.
 */
export function AuthButton({ label, onPress, icon, primary, preferred, disabled, compact, link, style }: Props) {
  const [focused, setFocused] = useState(false);
  const color = primary ? colors.accentText : colors.text;
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
      style={[styles.base, compact && styles.compact, link && styles.link, primary && styles.primary, focused && styles.focused, disabled && styles.disabled, style]}>
      {icon && (
        <View style={styles.icon}>
          <Glyph name={icon} color={color} size={compact ? 28 : 32} />
        </View>
      )}
      <Text style={[styles.label, primary && styles.primaryLabel, link && styles.linkLabel]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: px(82),
    paddingHorizontal: px(32),
    borderRadius: px(12),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  compact: { minHeight: px(76), paddingHorizontal: px(28) },
  link: { minHeight: px(64), paddingHorizontal: px(20), backgroundColor: 'transparent', borderColor: 'transparent' },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  focused: { borderColor: colors.focusRing },
  disabled: { opacity: 0.4 },
  icon: { marginRight: px(20) },
  label: { color: colors.text, fontSize: type.card, fontWeight: '600' },
  primaryLabel: { color: colors.accentText, fontWeight: '700' },
  linkLabel: { color: colors.accent },
});
