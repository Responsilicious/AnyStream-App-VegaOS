import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import { colors, focus, type } from '../theme';
import { Glyph } from './Glyph';

export type RowTone = 'ok' | 'busy' | 'warn' | 'off';

interface Props {
  title: string;
  subtitle: string;
  status: string;
  tone: RowTone;
  /** Persistent selection (Active, Current): a cyan left edge, separate from the white focus outline. */
  selected?: boolean;
  /** Short words shown before the status: "Active", "Current", "Startup". */
  flags?: string[];
  /** Picker rows draw a tick box. */
  checkbox?: boolean;
  checked?: boolean;
  disabled?: boolean;
  preferred?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  onFocus?: () => void;
  /** Tighter rows for side panels (quick switcher). */
  compact?: boolean;
}

const TONE: Record<RowTone, string> = {
  ok: colors.accent,
  busy: colors.surfaceFocused,
  warn: colors.danger,
  off: colors.textMuted,
};

/**
 * One saved or discovered server (docs/design mockups): icon, name, provider and account, flags, then a
 * status dot with words. Active/Current are always written out, never shown by colour alone. Focus (white
 * outline) and selection (cyan left edge) are separate states.
 */
export function ServerRow({
  title,
  subtitle,
  status,
  tone,
  selected,
  flags,
  checkbox,
  checked,
  disabled,
  preferred,
  accessibilityLabel,
  onPress,
  onFocus,
  compact,
}: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      accessibilityRole={checkbox ? 'checkbox' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, checked: checkbox ? !!checked : undefined, selected: !!selected }}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      style={[styles.row, compact && styles.compact, selected && styles.selected, focused && styles.focused, disabled && styles.disabled]}>
      {checkbox ? (
        <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <View style={styles.tick} /> : null}</View>
      ) : null}
      <View style={[styles.tile, compact && styles.tileCompact]}>
        <Glyph name="server" color={colors.text} size={compact ? 40 : 48} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {flags?.map(flag => (
        <View key={flag} style={styles.flag}>
          <Text style={styles.flagText}>{flag}</Text>
        </View>
      ))}
      <View style={styles.status}>
        <View style={[styles.dot, { backgroundColor: TONE[tone] }]} />
        <Text style={styles.statusText} numberOfLines={1}>
          {status}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: px(116),
    paddingHorizontal: px(28),
    marginBottom: px(16),
    borderRadius: px(16),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  compact: { minHeight: px(100), paddingHorizontal: px(22), marginBottom: px(12) },
  selected: { borderLeftColor: colors.accent, borderLeftWidth: px(10) },
  focused: { borderColor: colors.focusRing },
  disabled: { opacity: 0.6 },
  tile: {
    width: px(88),
    height: px(88),
    borderRadius: px(14),
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(28),
  },
  tileCompact: { width: px(72), height: px(72), marginRight: px(22) },
  box: {
    width: px(44),
    height: px(44),
    borderRadius: px(8),
    borderWidth: px(3),
    borderColor: colors.textMuted,
    marginRight: px(36),
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  tick: { width: px(20), height: px(20), borderRadius: px(4), backgroundColor: colors.accentText },
  text: { flex: 1, marginRight: px(24) },
  title: { color: colors.text, fontSize: type.card, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: type.body, marginTop: px(4) },
  flag: {
    marginRight: px(28),
    paddingHorizontal: px(18),
    paddingVertical: px(6),
    borderRadius: px(22),
    borderWidth: px(2),
    borderColor: colors.accent,
  },
  flagText: { color: colors.accent, fontSize: type.body, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', maxWidth: px(380) },
  dot: { width: px(20), height: px(20), borderRadius: px(10), marginRight: px(14) },
  statusText: { color: colors.text, fontSize: type.body },
});
