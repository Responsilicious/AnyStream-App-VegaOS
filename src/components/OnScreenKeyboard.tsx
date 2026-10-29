import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import {
  applyKey,
  KEY_COLUMNS,
  keyboardRows,
  MAX_LENGTH,
  type KeyAction,
  type KeyboardMode,
  type KeyCell,
  type KeyPage,
  type TextEdit,
} from '../keyboard';
import { colors, focus, type } from '../theme';

interface Props {
  /** The panel heading: "Server address", "Enter username", "Enter password". */
  title: string;
  mode: KeyboardMode;
  value: TextEdit;
  onChange: (next: TextEdit) => void;
  /** Done: closes the keyboard. It never submits the form. */
  onDone: () => void;
}

/** One character cell in 1080p design pixels: six to a row (docs/design/connect-mockup.png). */
const KEY_WIDTH = 134;
const KEY_HEIGHT = 70;
const KEY_GAP = 12;
const PANEL_PADDING = 44;
/** Width of the whole panel, for laying a screen out beside it. */
export const KEYBOARD_PANEL_WIDTH = KEY_COLUMNS * KEY_WIDTH + (KEY_COLUMNS - 1) * KEY_GAP + 2 * PANEL_PADDING;

/**
 * The keyboard panel for the address, username and password fields (layouts in src/keyboard.ts). It opens
 * with focus on "a". Shift stays on until pressed again, which suits passwords with several capitals.
 */
export function OnScreenKeyboard({ title, mode, value, onChange, onDone }: Props) {
  const [page, setPage] = useState<KeyPage>('letters');
  const [shift, setShift] = useState(false);
  const rows = keyboardRows(mode, page, shift);

  const press = (action: KeyAction) => {
    switch (action.type) {
      case 'shift':
        setShift(on => !on);
        return;
      case 'page':
        setPage(action.page);
        return;
      case 'done':
        onDone();
        return;
      default:
        onChange(applyKey(value, action, MAX_LENGTH[mode]));
    }
  };

  return (
    <View style={styles.panel} accessibilityLabel={`${title} keyboard`}>
      <Text style={styles.title}>{title}</Text>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.row, rowIndex === rows.length - 2 && styles.controlsGap]}>
          {row.map((cell, index) => (
            <Key
              key={cell.id}
              cell={cell}
              last={index === row.length - 1}
              preferred={rowIndex === 0 && index === 0}
              onPress={() => press(cell.action)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function Key({ cell, last, preferred, onPress }: { cell: KeyCell; last: boolean; preferred: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const width = px(cell.span * KEY_WIDTH + (cell.span - 1) * KEY_GAP);
  const isChar = cell.action.type === 'char';
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={cell.spoken}
      accessibilityState={cell.active === undefined ? undefined : { selected: cell.active }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.key, { width }, !last && styles.keyGap, focused && styles.focusedFill, cell.active && styles.active, focused && styles.focused]}>
      <Text style={[isChar ? styles.charLabel : styles.controlLabel, cell.active && styles.activeLabel]} numberOfLines={1}>
        {cell.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: px(KEYBOARD_PANEL_WIDTH),
    paddingHorizontal: px(PANEL_PADDING),
    paddingTop: px(32),
    paddingBottom: px(32 - KEY_GAP),
    borderRadius: px(24),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  title: { color: colors.textMuted, fontSize: type.heading, fontWeight: '700', marginBottom: px(20) },
  row: { flexDirection: 'row', marginBottom: px(KEY_GAP) },
  controlsGap: { marginTop: px(12) },
  key: {
    height: px(KEY_HEIGHT),
    borderRadius: px(10),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyGap: { marginRight: px(KEY_GAP) },
  active: { backgroundColor: colors.accent, borderColor: colors.accent },
  focusedFill: { backgroundColor: colors.surfaceFocused },
  focused: { borderColor: colors.focusRing },
  charLabel: { color: colors.text, fontSize: type.heading, fontWeight: '700' },
  controlLabel: { color: colors.text, fontSize: type.body, fontWeight: '600' },
  activeLabel: { color: colors.accentText },
});
