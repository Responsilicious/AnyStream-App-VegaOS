import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, ServerIdentity, StatusLine } from '../components/AuthFrame';
import { connectProblem, connectStatus, displayAddress, spokenCode, type ConnectStatus } from '../connect';
import { px } from '../layout';
import { describeError, isJellyfinError, JellyfinHttp, QuickConnectFlow, type DeviceInfo } from '../providers/jellyfin';
import type { ServerRecord, Session } from '../providers/types';
import { colors, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  device: DeviceInfo;
  server: ServerRecord;
  onSignedIn: (session: Session) => void;
  onUsePassword: () => void;
  onCancel: () => void;
}

type State =
  | { name: 'requesting' }
  | { name: 'waiting'; code: string }
  | { name: 'approved'; code: string }
  | { name: 'expired' }
  | { name: 'error'; status: ConnectStatus };

/**
 * Jellyfin Quick Connect (docs/sign-in.md): the server's six-character code beside the server's identity, and
 * steps for approving it from a signed-in Jellyfin app. The TV signs in by itself once approved. Checking for
 * approval stops as soon as this screen goes away.
 */
export function QuickConnectScreen({ device, server, onSignedIn, onUsePassword, onCancel }: Props) {
  const [state, setState] = useState<State>({ name: 'requesting' });
  // Bumped by Get new code: each attempt is a fresh request with its own cancellation.
  const [attempt, setAttempt] = useState(0);
  // Read through a ref so a new callback from the parent does not restart the request.
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    const controller = new AbortController();
    const flow = new QuickConnectFlow(new JellyfinHttp(server.baseUrl, device), server);
    setState({ name: 'requesting' });
    (async () => {
      try {
        const { code } = await flow.start(controller.signal);
        setState({ name: 'waiting', code });
        const session = await flow.waitForApproval(controller.signal, () => setState({ name: 'approved', code }));
        if (!controller.signal.aborted) {
          signedIn.current(session);
        }
      } catch (e) {
        if (controller.signal.aborted || (isJellyfinError(e) && e.kind === 'cancelled')) {
          return;
        }
        if (isJellyfinError(e) && e.kind === 'quick-connect-expired') {
          setState({ name: 'expired' });
        } else if (isJellyfinError(e) && e.kind === 'quick-connect-disabled') {
          setState({ name: 'error', status: { tone: 'error', title: describeError(e), detail: 'Sign in with your username and password instead.' } });
        } else {
          setState({ name: 'error', status: connectStatus(connectProblem(e)) });
        }
      }
    })();
    return () => controller.abort();
  }, [attempt, device, server]);

  useBack(() => {
    onCancel();
    return true;
  });

  const code = state.name === 'waiting' || state.name === 'approved' ? state.code : null;
  const status: ConnectStatus =
    state.name === 'requesting'
      ? { tone: 'busy', title: 'Getting a code…' }
      : state.name === 'waiting'
        ? { tone: 'busy', title: 'Waiting for approval…', detail: 'Keep this screen open.' }
        : state.name === 'approved'
          ? { tone: 'success', title: 'Approved', detail: 'Signing in…' }
          : state.name === 'expired'
            ? { tone: 'error', title: 'This code has expired', detail: 'Get a new code to try again.' }
            : state.status;
  const canRetry = state.name === 'expired' || state.name === 'error';
  const steps = [
    'Open Jellyfin on your phone or computer.',
    `Sign in to ${server.name}.`,
    'Go to Settings → Quick Connect.',
    'Enter the code shown on this TV and approve.',
  ];

  const right = (
    <View style={styles.right}>
      {steps.map((text, i) => (
        <View key={i} style={styles.step}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>{i + 1}</Text>
          </View>
          <Text style={styles.stepText}>{text}</Text>
        </View>
      ))}
      <View style={styles.actions}>
        {canRetry && <AuthButton label="Get new code" primary preferred compact onPress={() => setAttempt(n => n + 1)} style={styles.action} />}
        <AuthButton label="Use username & password" icon="link" compact preferred={!canRetry} onPress={onUsePassword} style={styles.action} />
        <AuthButton label="Cancel" icon="close" compact onPress={onCancel} />
      </View>
      <Text style={styles.footnote}>You'll be signed in automatically after approval.</Text>
    </View>
  );

  return (
    <AuthFrame onBack={onCancel} right={right}>
      <HeroTitle>Quick Connect</HeroTitle>
      <Text style={authStyles.lead}>Sign in using a device already connected to Jellyfin.</Text>
      <View style={styles.card}>
        <ServerIdentity name={server.name} address={displayAddress(server.baseUrl)} large />
        <View style={styles.rule} />
        <Text style={styles.codeLabel}>Your sign-in code</Text>
        <View style={styles.code} accessible accessibilityLabel={code ? `Quick Connect code ${spokenCode(code)}` : 'No code yet'}>
          {Array.from(code ?? '      ').map((ch, i) => (
            <View key={i} style={styles.codeCell}>
              <Text style={styles.codeChar}>{ch}</Text>
            </View>
          ))}
        </View>
        <StatusLine status={status} />
      </View>
    </AuthFrame>
  );
}

/** Code cells fit the left column: six cells and their gaps inside the card's padding. */
const CELL = 104;

const styles = StyleSheet.create({
  right: { width: px(860) },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: px(118),
    paddingHorizontal: px(28),
    marginBottom: px(18),
    borderRadius: px(16),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  stepNumber: {
    width: px(74),
    height: px(74),
    borderRadius: px(37),
    borderWidth: px(2),
    borderColor: colors.accent,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(30),
  },
  stepNumberText: { color: colors.text, fontSize: type.heading, fontWeight: '800' },
  stepText: { flex: 1, color: colors.text, fontSize: type.card, lineHeight: px(38) },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(16) },
  action: { marginRight: px(18), marginBottom: px(18) },
  footnote: { alignSelf: 'flex-end', color: colors.textMuted, fontSize: type.body, marginTop: px(28) },
  card: { padding: px(36), borderRadius: px(20), borderWidth: px(2), borderColor: colors.surfaceFocused, backgroundColor: colors.surface },
  rule: { height: px(2), backgroundColor: colors.surfaceFocused, marginVertical: px(24) },
  codeLabel: { color: colors.text, fontSize: type.card, fontWeight: '700', marginBottom: px(16) },
  code: { flexDirection: 'row', marginBottom: px(32) },
  codeCell: {
    width: px(CELL),
    height: px(CELL * 1.04),
    marginRight: px(12),
    borderRadius: px(12),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: { color: colors.text, fontSize: px(64), fontWeight: '800' },
});
