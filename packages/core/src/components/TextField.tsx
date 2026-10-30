import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import { maskText } from '../keyboard';
import { colors, focus, type } from '../theme';

interface Props {
  label: string;
  value: string;
  /** Where the caret sits while the keyboard is open for this field. */
  caret?: number;
  placeholder?: string;
  /** Password: dots instead of characters. */
  masked?: boolean;
  /** The keyboard is open for this field: a cyan border, and the caret shows. */
  editing?: boolean;
  preferred?: boolean;
  onPress: () => void;
  /** A control drawn inside the right end of the field (the password's Show/Hide). Focusable on its own. */
  accessory?: ReactNode;
}

/**
 * A labelled field that opens the on-screen keyboard when selected. The focused control has the bright white
 * outline; the field being edited keeps a quieter cyan border while focus is on the keyboard.
 */
export function TextField({ label, value, caret, placeholder, masked, editing, preferred, onPress, accessory }: Props) {
  const [focused, setFocused] = useState(false);
  const shown = masked ? maskText(value) : value;
  const at = Math.max(0, Math.min(caret ?? value.length, value.length));
  // The mask is one dot per character, so the caret index carries over (accented letters are one unit each).
  const before = shown.slice(0, at);
  const after = shown.slice(at);
  const spoken = masked
    ? `${label}, ${value.length ? `${value.length} characters, hidden` : 'empty'}`
    : `${label}, ${value || 'empty'}`;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <Pressable
          focusable
          hasTVPreferredFocus={preferred}
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint="Opens the keyboard"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPress={onPress}
          style={[styles.field, accessory ? styles.withAccessory : null, editing && styles.editing, focused && styles.focused]}>
          {value.length === 0 && !editing ? (
            <Text style={[styles.text, styles.placeholder]} numberOfLines={1}>
              {placeholder ?? ''}
            </Text>
          ) : (
            <View style={styles.line}>
              <Text style={[styles.text, masked && styles.dots]} numberOfLines={1} ellipsizeMode="head">
                {before}
              </Text>
              {editing && <View style={styles.caret} />}
              {after.length > 0 && (
                <Text style={[styles.text, styles.after, masked && styles.dots]} numberOfLines={1}>
                  {after}
                </Text>
              )}
            </View>
          )}
        </Pressable>
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: px(22) },
  label: { color: colors.textMuted, fontSize: type.card, fontWeight: '700', marginBottom: px(10) },
  field: {
    height: px(82),
    paddingHorizontal: px(30),
    borderRadius: px(12),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  withAccessory: { paddingRight: px(200) },
  editing: { borderColor: colors.accent },
  focused: { borderColor: colors.focusRing },
  line: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  text: { color: colors.text, fontSize: type.heading, flexShrink: 1 },
  dots: { letterSpacing: px(6) },
  after: { flexShrink: 0 },
  placeholder: { color: colors.textMuted },
  caret: { width: px(3), height: px(44), backgroundColor: colors.text, marginHorizontal: px(3) },
  accessory: { position: 'absolute', right: px(12), top: 0, bottom: 0, justifyContent: 'center' },
});
