import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import type { FilterChip } from '../library/viewState';
import { colors, focus, type } from '../theme';

interface Props {
  /** Filter groups applied: several genres count once. */
  filterCount: number;
  sortText: string;
  chips: FilterChip[];
  onFilters: () => void;
  onSort: () => void;
  onRemoveChip: (chip: FilterChip) => void;
  onClear: () => void;
  /** Which button takes focus: on arrival, or back from the drawer. */
  preferred?: 'filters' | 'sort';
  /** The drawer is open: nothing here may take focus. */
  inert?: boolean;
  /** A chip change is loading; further presses wait. */
  busy?: boolean;
}

/** Filters and Sort under the page title, then one chip per applied filter, then Clear filters. */
export function LibraryToolbar({ filterCount, sortText, chips, onFilters, onSort, onRemoveChip, onClear, preferred, inert, busy }: Props) {
  return (
    <View style={styles.bar}>
      <ToolButton
        label={filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
        spoken={filterCount > 0 ? `Filters, ${filterCount} applied` : 'Filters, none applied'}
        active={filterCount > 0}
        preferred={preferred === 'filters'}
        inert={inert}
        onPress={onFilters}
      />
      <ToolButton label={`Sort: ${sortText}`} spoken={`Sort, ${sortText}`} preferred={preferred === 'sort'} inert={inert} onPress={onSort} />
      {chips.map(chip => (
        <ToolButton key={chip.id} label={`${chip.label}  ×`} spoken={chip.removeLabel} chip inert={inert} onPress={() => (busy ? undefined : onRemoveChip(chip))} />
      ))}
      {chips.length > 0 ? <ToolButton label="Clear filters" spoken="Clear filters. Keeps the sort order" link inert={inert} onPress={() => (busy ? undefined : onClear())} /> : null}
    </View>
  );
}

function ToolButton({
  label,
  spoken,
  onPress,
  preferred,
  inert,
  active,
  chip,
  link,
}: {
  label: string;
  spoken: string;
  onPress: () => void;
  preferred?: boolean;
  inert?: boolean;
  active?: boolean;
  chip?: boolean;
  link?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!inert}
      hasTVPreferredFocus={preferred && !inert}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.button, chip && styles.chip, link && styles.link, focused && styles.focused]}>
      <Text style={[styles.label, (active || chip) && styles.labelActive, link && styles.linkLabel]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  button: {
    height: px(64),
    paddingHorizontal: px(28),
    marginRight: px(14),
    marginBottom: px(10),
    borderRadius: px(32),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    justifyContent: 'center',
    maxWidth: px(520),
  },
  chip: { height: px(56), paddingHorizontal: px(22), backgroundColor: 'rgba(103,216,239,0.14)', borderColor: 'rgba(103,216,239,0.5)' },
  link: { backgroundColor: 'transparent' },
  focused: { borderColor: colors.focusRing, backgroundColor: colors.surfaceFocused },
  label: { color: colors.text, fontSize: type.body, fontWeight: '700' },
  labelActive: { color: colors.accent },
  linkLabel: { color: colors.textMuted, textDecorationLine: 'underline' },
});
