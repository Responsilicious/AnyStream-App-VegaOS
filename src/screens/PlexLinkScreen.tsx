import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, StatusLine } from '../components/AuthFrame';
import { PLEX_LINK_ADDRESS } from '../config';
import type { ConnectStatus } from '../connect';
import { spokenCode } from '../connect';
import { px } from '../layout';
import {
  describePlexError,
  getPlexUser,
  isPlexError,
  PlexLinker,
  type Ed25519Signer,
  type PlexHttp,
  type PlexLinkResult,
  type PlexUser,
} from '../providers/plex';
import { colors, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  /** A plex.tv client with no token. Must be stable across renders, or a new code would start each time. */
  plex: PlexHttp;
  /** The TV's key; undefined without a secure random source, in which case Plex issues a legacy token. */
  signer: Ed25519Signer | undefined;
  onLinked: (user: PlexUser, result: PlexLinkResult) => void;
  /** Cancel: leave adding a server. */
  onCancel: () => void;
  /** Back to provider selection (Jellyfin or Plex). */
  onChangeProvider: () => void;
}

type State =
  | { name: 'requesting' }
  | { name: 'waiting'; code: string }
  | { name: 'approved'; code: string }
  | { name: 'expired' }
  | { name: 'error'; message: string };

/**
 * Sign in with Plex (docs/design plex-login mockup): the code Plex returned on the left, where to enter it
 * on the right. AnyStream never asks for the Plex password. One code per attempt; expiry offers Get new code
 * instead of looping. Leaving the screen stops polling and forgets the pending code.
 */
export function PlexLinkScreen({ plex, signer, onLinked, onCancel, onChangeProvider }: Props) {
  const [state, setState] = useState<State>({ name: 'requesting' });
  const [attempt, setAttempt] = useState(0);
  const linked = useRef(onLinked);
  linked.current = onLinked;

  useEffect(() => {
    const controller = new AbortController();
    const linker = new PlexLinker(plex, signer);
    setState({ name: 'requesting' });
    (async () => {
      try {
        const pin = await linker.start(controller.signal);
        setState({ name: 'waiting', code: pin.code });
        const result = await linker.waitForApproval(pin, controller.signal);
        setState({ name: 'approved', code: pin.code });
        const user = await getPlexUser(plex.withToken(result.token), controller.signal);
        if (!controller.signal.aborted) {
          linked.current(user, result);
        }
      } catch (e) {
        if (controller.signal.aborted || (isPlexError(e) && e.kind === 'cancelled')) {
          return;
        }
        if (isPlexError(e) && e.kind === 'link-expired') {
          setState({ name: 'expired' });
        } else {
          setState({ name: 'error', message: describePlexError(e) });
        }
      }
    })();
    return () => controller.abort();
  }, [attempt, plex, signer]);

  useBack(() => {
    onCancel();
    return true;
  });

  const code = state.name === 'waiting' || state.name === 'approved' ? state.code : null;
  const status: ConnectStatus =
    state.name === 'requesting'
      ? { tone: 'busy', title: 'Getting a code…' }
      : state.name === 'waiting'
        ? { tone: 'busy', title: 'Waiting for Plex approval…', detail: 'Keep this screen open.' }
        : state.name === 'approved'
          ? { tone: 'success', title: 'Approved', detail: 'Finding your servers…' }
          : state.name === 'expired'
            ? { tone: 'error', title: 'This code has expired', detail: 'Get a new code to try again.' }
            : { tone: 'error', title: state.message };
  const canRetry = state.name === 'expired' || state.name === 'error';
  // Plex's long "strong" codes wrap in smaller cells rather than shrinking text below the readable size.
  const long = (code?.length ?? 0) > 8;

  return (
    <AuthFrame onBack={onCancel}>
      <HeroTitle>Sign in with Plex</HeroTitle>
      <Text style={authStyles.lead}>Link your Plex account, then choose your servers.</Text>
      <View style={styles.columns}>
        <View style={[styles.card, styles.gap]}>
          <Text style={styles.codeLabel}>Your link code</Text>
          <View style={styles.code} accessible accessibilityLabel={code ? `Plex link code ${spokenCode(code)}` : 'No code yet'}>
            {code ? (
              Array.from(code).map((ch, i) => (
                <View key={i} style={[styles.cell, long && styles.cellSmall]}>
                  <Text style={[styles.char, long && styles.charSmall]}>{ch}</Text>
                </View>
              ))
            ) : (
              <View style={styles.placeholder} />
            )}
          </View>
          <StatusLine status={status} />
        </View>
        <View style={styles.card}>
          <Step n={1}>
            <Text style={styles.stepText}>On your phone or computer, open</Text>
            <Text style={styles.address}>{PLEX_LINK_ADDRESS}</Text>
          </Step>
          <Step n={2}>
            <Text style={styles.stepText}>Sign in to your Plex account.</Text>
          </Step>
          <Step n={3}>
            <Text style={styles.stepText}>Enter the code shown on this TV.</Text>
          </Step>
          <Step n={4}>
            <Text style={styles.stepText}>Return here to choose your servers.</Text>
          </Step>
        </View>
      </View>
      <View style={styles.columns}>
        <View style={[styles.flex, styles.gap]}>
          {canRetry ? (
            <AuthButton label="Get new code" primary preferred onPress={() => setAttempt(n => n + 1)} />
          ) : (
            <AuthButton label="Cancel" preferred onPress={onCancel} />
          )}
        </View>
        <View style={styles.flex}>
          <AuthButton label="Back to provider selection" onPress={onChangeProvider} />
        </View>
      </View>
      <Text style={authStyles.note}>Plex handles sign-in in your browser. AnyStream never sees your Plex password.</Text>
    </AuthFrame>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

const CELL = 140;

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', marginBottom: px(24) },
  flex: { flex: 1 },
  gap: { marginRight: px(28) },
  card: {
    flex: 1,
    padding: px(40),
    borderRadius: px(20),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  codeLabel: { color: colors.text, fontSize: type.heading, fontWeight: '700', marginBottom: px(20) },
  code: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: px(28), minHeight: px(CELL) },
  placeholder: { height: px(CELL) },
  cell: {
    width: px(CELL),
    height: px(CELL),
    marginRight: px(18),
    marginBottom: px(12),
    borderRadius: px(16),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSmall: { width: px(64), height: px(76), marginRight: px(8) },
  char: { color: colors.text, fontSize: px(88), fontWeight: '800' },
  charSmall: { fontSize: px(40) },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: px(26) },
  stepNumber: {
    width: px(64),
    height: px(64),
    borderRadius: px(32),
    borderWidth: px(2),
    borderColor: colors.accent,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(36),
  },
  stepNumberText: { color: colors.text, fontSize: type.heading, fontWeight: '800' },
  stepText: { color: colors.text, fontSize: type.card, lineHeight: px(64) },
  address: { color: colors.text, fontSize: px(80), fontWeight: '800', lineHeight: px(92) },
});
