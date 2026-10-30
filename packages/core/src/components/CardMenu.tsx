import { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { cardActions, type CardAction } from '../home';
import type { MediaItem } from '../providers/types';
import { colors, spacing, type } from '../theme';
import { cardTitle } from '../util/format';
import { FocusButton } from './FocusButton';
import { px } from '../layout';

interface Props {
  item: MediaItem;
  /** True for a Continue Playing card, which adds Remove from row. */
  inContinueRow?: boolean;
  /** Set while an action is running, so a second press cannot repeat it. */
  busy?: boolean;
  /** A failure from the last action, in plain words. */
  error?: string | null;
  onAction: (action: CardAction) => void;
  onClose: () => void;
}

const LABELS: Record<CardAction, string> = {
  resume: 'Resume',
  'play-from-start': 'Start again',
  details: 'Details',
  'mark-watched': 'Mark watched',
  'remove-from-row': 'Remove from row',
};

/** The secondary menu for a card. It replaces the screen while open, so focus cannot wander behind it. */
export function CardMenu({ item, inContinueRow, busy, error, onAction, onClose }: Props) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const actions = cardActions(item, inContinueRow);

  return (
    <View style={styles.screen}>
      <Text style={styles.title} numberOfLines={2}>
        {cardTitle(item)}
      </Text>
      {item.kind === 'episode' ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {item.title}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {actions.map((action, index) => (
          <FocusButton
            key={action}
            label={LABELS[action]}
            primary={index === 0}
            preferred={index === 0}
            disabled={busy}
            onPress={() => onAction(action)}
            style={styles.action}
          />
        ))}
        <FocusButton label="Close" onPress={onClose} style={styles.action} />
      </View>
      {actions.includes('remove-from-row') ? (
        <Text style={styles.hint}>Remove from row hides it here and keeps your place. Mark watched finishes it.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: px(192) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: type.body, marginTop: px(8) },
  actions: { marginTop: spacing.gapLarge },
  action: { marginBottom: spacing.gap, alignSelf: 'flex-start', minWidth: px(420) },
  hint: { color: colors.textMuted, fontSize: type.caption, marginTop: px(4) },
  error: { color: colors.danger, fontSize: type.body, marginTop: spacing.gap },
});
