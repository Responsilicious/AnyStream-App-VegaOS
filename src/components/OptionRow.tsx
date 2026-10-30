import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import { colors, focus, type } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  /** 'radio' and 'check' show their state with a mark; 'field' shows its current value and opens a list. */
  kind: 'radio' | 'check' | 'field';
  /** Radio or check state. Shown in cyan, whatever has focus. */
  selected?: boolean;
  /** For a field: the value it holds now. */
  value?: string;
  help?: string;
  preferred?: boolean;
  disabled?: boolean;
  /** Extra words for a screen reader, such as "2 selected". */
  accessibilityHint?: string;
}

/**
 * One row of the filter drawer. Focus is the white ring and nothing else; selection is the cyan mark and the
 * word in its spoken state, so the two never look alike.
 */
export function OptionRow({ label, onPress, kind, selected, value, help, preferred, disabled, accessibilityHint }: Props) {
  const [focused, setFocused] = useState(false);
  const role = kind === 'radio' ? 'radio' : kind === 'check' ? 'checkbox' : 'button';
  const spoken = kind === 'field' && value ? `${label}, ${value}` : label;
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      accessibilityRole={role}
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      accessibilityState={kind === 'field' ? { disabled: !!disabled } : { checked: !!selected, disabled: !!disabled }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      style={[styles.row, focused && styles.focused, disabled && styles.disabled]}>
      {kind === 'radio' ? (
        <View style={[styles.radio, selected && styles.markOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      ) : null}
      {kind === 'check' ? (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={2}>
          {label}
        </Text>
        {help ? (
          <Text style={styles.help} numberOfLines={2}>
            {help}
          </Text>
        ) : null}
      </View>
      {kind === 'field' ? (
        <>
          <Text style={[styles.value, value && value !== 'Any' && value !== 'Any genre' ? styles.valueSet : null]} numberOfLines={1}>
            {value}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: px(72),
    paddingHorizontal: px(24),
    paddingVertical: px(10),
    marginBottom: px(8),
    borderRadius: px(12),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  focused: { borderColor: colors.focusRing, backgroundColor: colors.surfaceFocused },
  disabled: { opacity: 0.45 },
  text: { flex: 1 },
  label: { color: colors.text, fontSize: px(28), fontWeight: '600' },
  labelSelected: { color: colors.accent },
  help: { color: colors.textMuted, fontSize: type.body, marginTop: px(4) },
  value: { color: colors.textMuted, fontSize: px(26), maxWidth: px(320), marginLeft: px(16) },
  valueSet: { color: colors.accent, fontWeight: '700' },
  chevron: { color: colors.textMuted, fontSize: px(40), marginLeft: px(12), lineHeight: px(44) },
  radio: {
    width: px(32),
    height: px(32),
    borderRadius: px(16),
    borderWidth: px(3),
    borderColor: colors.textMuted,
    marginRight: px(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOn: { borderColor: colors.accent },
  radioDot: { width: px(16), height: px(16), borderRadius: px(8), backgroundColor: colors.accent },
  check: {
    width: px(32),
    height: px(32),
    borderRadius: px(6),
    borderWidth: px(3),
    borderColor: colors.textMuted,
    marginRight: px(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkMark: { color: colors.accentText, fontSize: px(22), fontWeight: '900', lineHeight: px(26) },
});
