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

function isSet(value: string | undefined): boolean {
  return !!value && !value.startsWith('Any');
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
      {kind === 'field' ? (
        <>
          <View style={styles.text}>
            <Text style={styles.fieldLabel} numberOfLines={1}>
              {label}
            </Text>
            <Text style={[styles.value, isSet(value) && styles.valueSet]} numberOfLines={1}>
              {value}
            </Text>
            {help ? (
              <Text style={styles.help} numberOfLines={2}>
                {help}
              </Text>
            ) : null}
          </View>
          {/* A down-pointing chevron: the field opens a list. */}
          <View style={styles.chevron} />
        </>
      ) : (
        <>
          <View style={styles.text}>
            <Text style={styles.label} numberOfLines={2}>
              {label}
            </Text>
            {help ? (
              <Text style={styles.help} numberOfLines={2}>
                {help}
              </Text>
            ) : null}
          </View>
          {selected ? <Text style={styles.selectedWord}>Selected</Text> : null}
        </>
      )}
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
  fieldLabel: { color: colors.textMuted, fontSize: type.body },
  help: { color: colors.textMuted, fontSize: type.body, marginTop: px(4) },
  value: { color: colors.text, fontSize: px(30), fontWeight: '600', marginTop: px(2) },
  valueSet: { color: colors.accent },
  selectedWord: { color: colors.accent, fontSize: type.body, fontWeight: '700', marginLeft: px(16) },
  chevron: {
    width: px(16),
    height: px(16),
    marginLeft: px(16),
    marginRight: px(8),
    marginTop: -px(8),
    borderRightWidth: px(3),
    borderBottomWidth: px(3),
    borderColor: colors.textMuted,
    transform: [{ rotate: '45deg' }],
  },
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
