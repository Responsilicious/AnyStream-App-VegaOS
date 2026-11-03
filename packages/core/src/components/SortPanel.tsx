import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import { colors, type } from '../theme';
import { useBack } from '../useBack';
import { FocusButton } from './FocusButton';
import { OptionRow } from './OptionRow';

interface Props<S extends string> {
  title: string;
  subtitle: string;
  options: S[];
  applied: S;
  label: (sort: S) => string;
  help?: (sort: S) => string | undefined;
  /** A choice is loading; further presses wait. */
  pending: boolean;
  error: string | null;
  onChoose: (sort: S) => void;
  onClose: () => void;
}

/**
 * The sort panel for the Collections and collection pages: the filter drawer's look (docs/library-filters.md) with
 * only a list of orders, because a mixed collection has nothing meaningful to filter by. Choosing an order applies
 * it; the panel closes once the new order has loaded, and stays with an error if it fails. Back closes it.
 */
export function SortPanel<S extends string>({ title, subtitle, options, applied, label, help, pending, error, onChoose, onClose }: Props<S>) {
  const s = useScale();
  useBack(() => {
    onClose();
    return true;
  });
  return (
    <View style={styles.wrap} accessibilityViewIsModal>
      <Pressable style={styles.scrim} focusable={false} onPress={onClose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={[styles.panel, { width: s(720), paddingHorizontal: s(48), paddingTop: s(28), paddingBottom: s(54) }]}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {options.map(option => (
            <OptionRow
              key={option}
              kind="radio"
              label={label(option)}
              help={help?.(option)}
              selected={option === applied}
              preferred={option === applied}
              disabled={pending}
              onPress={() => onChoose(option)}
            />
          ))}
        </ScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.footer}>
          <FocusButton label={pending ? 'Loading…' : 'Close'} disabled={pending} onPress={onClose} />
          <Text style={styles.backHint}>Back · Close</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  scrim: { flex: 1 },
  panel: { backgroundColor: '#0E1626', borderLeftWidth: px(2), borderLeftColor: colors.surface },
  title: { color: colors.text, fontSize: px(46), fontWeight: '800' },
  subtitle: { color: colors.accent, fontSize: px(26), marginTop: px(4), marginBottom: px(20) },
  content: { flex: 1 },
  contentInner: { paddingVertical: px(6) },
  error: { color: colors.danger, fontSize: type.body, marginTop: px(12) },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: px(16) },
  backHint: { color: colors.accent, fontSize: type.body, marginLeft: px(16), flex: 1, textAlign: 'right' },
});
