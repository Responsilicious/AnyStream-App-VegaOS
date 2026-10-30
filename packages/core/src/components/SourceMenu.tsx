import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { announce } from '../a11y';
import { px } from '../layout';
import type { SourceHit } from '../search/model';
import { colors, spacing, type } from '../theme';
import { FocusButton } from './FocusButton';

export interface SourceChoice {
  hit: SourceHit;
  label: string;
  detail: string;
}

interface Props {
  /** The title the copies are of. */
  title: string;
  choices: SourceChoice[];
  /** 'open': copies on the active server, opened straight away. 'switch': copies elsewhere, behind a confirmation. */
  mode: 'open' | 'switch';
  onOpen: (hit: SourceHit) => void;
  /** Switches to the copy's server and opens it there. Resolves to an error to show, or undefined when it worked. */
  onSwitch: (hit: SourceHit) => Promise<string | undefined>;
  onClose: () => void;
}

/**
 * Picks one copy of a title (docs/cross-server-search.md): a chooser when there is more than one, then, for a
 * copy on another server, "Switch to <server>?" with Switch and Cancel. It replaces the screen while open so
 * focus cannot wander behind it, and nothing switches until Switch is pressed. A failed switch leaves the
 * user where they were, with the reason.
 */
export function SourceMenu({ title, choices, mode, onOpen, onSwitch, onClose }: Props) {
  const [confirm, setConfirm] = useState<SourceChoice | undefined>(() => (mode === 'switch' && choices.length === 1 ? choices[0] : undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) {
        return true;
      }
      if (confirm && choices.length > 1) {
        setConfirm(undefined);
        setError(undefined);
      } else {
        onClose();
      }
      return true;
    });
    return () => subscription.remove();
  }, [busy, confirm, choices.length, onClose]);

  const choose = (choice: SourceChoice) => {
    if (mode === 'open') {
      onOpen(choice.hit);
    } else {
      setError(undefined);
      setConfirm(choice);
    }
  };

  const doSwitch = async (choice: SourceChoice) => {
    setBusy(true);
    setError(undefined);
    const failure = await onSwitch(choice.hit);
    // On success this menu is gone; only a failure comes back here.
    if (failure) {
      setBusy(false);
      setError(failure);
      announce(failure);
    }
  };

  if (confirm) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title} numberOfLines={2}>{`Switch to ${confirm.label}?`}</Text>
        <Text style={styles.subtitle} numberOfLines={3}>
          {`${title} is on ${confirm.label}. Home and your libraries will show that server until you switch back.`}
        </Text>
        <View style={styles.actions}>
          <FocusButton
            key={`switch-${confirm.hit.key}`}
            label={busy ? 'Switching…' : 'Switch'}
            primary
            preferred
            disabled={busy}
            onPress={() => void doSwitch(confirm)}
            style={styles.action}
          />
          <FocusButton
            label="Cancel"
            disabled={busy}
            onPress={() => {
              if (choices.length > 1) {
                setConfirm(undefined);
                setError(undefined);
              } else {
                onClose();
              }
            }}
            style={styles.action}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.subtitle}>{mode === 'open' ? 'This server has more than one copy. Which one?' : 'Which server?'}</Text>
      <View style={styles.actions}>
        {choices.map((choice, index) => (
          <View key={choice.hit.key} style={styles.choice}>
            <FocusButton label={choice.label} preferred={index === 0} primary={index === 0} onPress={() => choose(choice)} style={styles.action} />
            {choice.detail ? <Text style={styles.detail}>{choice.detail}</Text> : null}
          </View>
        ))}
        <FocusButton label="Cancel" onPress={onClose} style={styles.action} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: px(192) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: type.body, marginTop: px(8), maxWidth: px(1200) },
  actions: { marginTop: spacing.gapLarge },
  choice: { flexDirection: 'row', alignItems: 'center' },
  action: { marginBottom: spacing.gap, alignSelf: 'flex-start', minWidth: px(520) },
  detail: { color: colors.textMuted, fontSize: type.caption, marginLeft: px(24), marginBottom: spacing.gap },
  error: { color: colors.danger, fontSize: type.body, marginTop: spacing.gap },
});
