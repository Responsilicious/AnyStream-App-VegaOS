import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, KeyHint, StatusLine } from '../components/AuthFrame';
import { KEYBOARD_PANEL_WIDTH, OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { TextField } from '../components/TextField';
import {
  addressProblem,
  CHECKING,
  connectProblem,
  connectStatus,
  displayAddress,
  familyName,
  serverFound,
  type ConnectProblem,
  type ConnectStatus,
  type ServerFamily,
} from '../connect';
import { discoverServers, subnetHosts, type FoundServer } from '../discovery';
import { platform } from '../platform';
import { startEdit, type TextEdit } from '../keyboard';
import { px } from '../layout';
import {
  httpForServer,
  identifyServer,
  isJellyfinError,
  probeServer,
  QuickConnectFlow,
  type DeviceInfo,
} from '../providers/jellyfin';
import type { ServerRecord } from '../providers/types';
import { colors, type } from '../theme';
import { useBack } from '../useBack';
import { ConnectionRecovery } from './ConnectionRecovery';

interface Props {
  device: DeviceInfo;
  initialAddress: string;
  /** Which kind of server this screen connects. Jellyfin when left out. */
  family?: ServerFamily;
  /** The server answered and is the right kind; `quickConnect` says whether it offers Quick Connect (Jellyfin only). */
  onConnected: (server: ServerRecord, quickConnect: boolean) => void;
  /** The address is the other kind of server: offered as "Connect as …", never done silently. */
  onUseOtherProvider?: (family: ServerFamily, address: string) => void;
  /** Back to the provider chooser. */
  onChangeProvider?: () => void;
  onBack: () => void;
}

type Phase = 'idle' | 'checking' | 'found' | 'searching' | 'failed';

/**
 * Server connection (docs/sign-in.md): a labelled address field with the on-screen keyboard, Connect, and a
 * separate network search. Every state says what is happening, the address survives errors, and the verified
 * server name is shown before any credentials are asked for.
 */
export function ConnectServerScreen({ device, initialAddress, family = 'jellyfin', onConnected, onUseOtherProvider, onChangeProvider, onBack }: Props) {
  const [address, setAddress] = useState<TextEdit>(() => startEdit(initialAddress));
  const [editing, setEditing] = useState(false);
  // Bumped when the keyboard closes, so the field remounts with preferred focus (focus goes back to it).
  const [fieldEpoch, setFieldEpoch] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [found, setFound] = useState<{ server: ServerRecord; quick: boolean } | null>(null);
  const [nearby, setNearby] = useState<FoundServer[]>([]);
  // The last failure, and for 'wrong-product' which product answered, for the recovery actions.
  const [problem, setProblem] = useState<{ kind: ConnectProblem; detected?: ServerFamily } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const closeKeyboard = useCallback(() => {
    setEditing(false);
    setFieldEpoch(n => n + 1);
  }, []);

  const connect = useCallback(
    async (text: string) => {
      const invalid = addressProblem(text);
      if (invalid) {
        setProblem({ kind: 'invalid' });
        setStatus(connectStatus('invalid', invalid, family));
        return;
      }
      cancel();
      const controller = new AbortController();
      abortRef.current = controller;
      setFound(null);
      setProblem(null);
      setPhase('checking');
      setStatus(CHECKING);
      try {
        const { baseUrl, info } = await probeServer(text, device, { signal: controller.signal, product: family });
        const server: ServerRecord = { id: info.Id, kind: family, name: info.ServerName, baseUrl };
        // Quick Connect is Jellyfin's; Emby has nothing like it, so it is never offered there.
        const quick = family === 'jellyfin' && (await new QuickConnectFlow(httpForServer(server, device), server).isAvailable(controller.signal));
        if (controller.signal.aborted) {
          return;
        }
        setFound({ server, quick });
        setPhase('found');
        setStatus(serverFound(server.name));
      } catch (e) {
        if (isJellyfinError(e) && e.kind === 'cancelled') {
          setPhase('idle');
          setStatus(null);
          return;
        }
        const kind = connectProblem(e);
        const detected = isJellyfinError(e) ? e.detected : undefined;
        setProblem({ kind, detected });
        // Emby's spec gives an unreachable server its own recovery screen; everything else stays on the form.
        setPhase(family === 'emby' && (kind === 'unavailable' || kind === 'timeout') ? 'failed' : 'idle');
        setStatus(connectStatus(kind, undefined, family, detected));
      }
    },
    [cancel, device, family],
  );

  const search = useCallback(async () => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    setNearby([]);
    setFound(null);
    setPhase('searching');
    setStatus({ tone: 'busy', title: 'Searching this network…', detail: 'This takes up to half a minute.' });
    const network = await platform().readLocalNetwork();
    const hosts = network ? subnetHosts(network) : [];
    if (controller.signal.aborted) {
      return;
    }
    if (hosts.length === 0) {
      setPhase('idle');
      setStatus({ tone: 'error', title: 'Could not search this network', detail: 'Enter the server address instead.' });
      return;
    }
    const servers = await discoverServers(
      hosts,
      (url, signal, timeoutMs) => identifyServer(url, device, { signal, timeoutMs }),
      {
        signal: controller.signal,
        // Only this screen's kind of server is listed; the other kind is added through its own card.
        onFound: server => (server.product === family ? setNearby(list => [...list, server]) : undefined),
      },
    );
    const matching = servers.filter(s => s.product === family);
    if (controller.signal.aborted) {
      setPhase('idle');
      setStatus(null);
      return;
    }
    setPhase('idle');
    setStatus(
      matching.length > 0
        ? { tone: 'success', title: matching.length === 1 ? 'Found 1 server' : `Found ${matching.length} servers`, detail: 'Choose one to connect. Servers are checked before sign-in.' }
        : { tone: 'error', title: 'No servers found on this network', detail: 'A server elsewhere needs its address.' },
    );
  }, [cancel, device, family]);

  const stop = useCallback(() => {
    cancel();
    setPhase('idle');
    setStatus(null);
  }, [cancel]);

  const changeAddress = useCallback((next: TextEdit) => {
    setAddress(next);
    // A new address undoes "Server found": it has not been checked.
    setFound(null);
    setProblem(null);
    setPhase(p => (p === 'found' || p === 'failed' ? 'idle' : p));
    setStatus(s => (s?.tone === 'success' ? null : s));
  }, []);

  useBack(() => {
    if (editing) {
      closeKeyboard();
      return true;
    }
    if (phase === 'checking' || phase === 'searching') {
      stop();
      return true;
    }
    if (phase === 'failed') {
      setPhase('idle');
      return true;
    }
    onBack();
    return true;
  });

  const right = (
    <View style={styles.right}>
      {editing ? (
        <>
          <OnScreenKeyboard title="Server address" mode="server" value={address} onChange={changeAddress} onDone={closeKeyboard} />
          <KeyHint text="Back · Close keyboard" />
        </>
      ) : nearby.length > 0 && phase !== 'found' ? (
        <View style={styles.nearby}>
          <Text style={styles.nearbyHeading}>On this network</Text>
          <ScrollView contentContainerStyle={styles.nearbyContent}>
            {nearby.map(server => (
              <AuthButton
                key={server.id}
                icon="server"
                label={`${server.name}  ·  ${displayAddress(server.address)}`}
                disabled={phase === 'checking'}
                onPress={() => {
                  cancel();
                  const next = startEdit(server.address);
                  setAddress(next);
                  connect(next.text);
                }}
                style={styles.nearbyItem}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  if (phase === 'failed') {
    return (
      <ConnectionRecovery
        address={address.text}
        family={family}
        onRetry={() => connect(address.text)}
        onEdit={() => {
          setPhase('idle');
          setStatus(null);
          setEditing(true);
        }}
        onChangeProvider={onChangeProvider}
        onBack={() => setPhase('idle')}
      />
    );
  }

  const otherProduct = problem?.kind === 'wrong-product' && problem.detected && onUseOtherProvider ? problem.detected : undefined;

  return (
    <AuthFrame onBack={onBack} right={right}>
      <HeroTitle>{family === 'emby' ? 'Connect to Emby' : 'Connect to\nJellyfin server'}</HeroTitle>
      <TextField
        key={`address-${fieldEpoch}`}
        label="Server address"
        value={address.text}
        caret={address.caret}
        placeholder="https://"
        editing={editing}
        preferred={!editing && phase !== 'found'}
        onPress={() => setEditing(true)}
      />
      <Text style={styles.fieldHint}>Enter the full address, including any port or path.</Text>

      {phase === 'found' && found ? (
        <>
          <AuthButton label="Continue to sign in" icon="play" primary preferred onPress={() => onConnected(found.server, found.quick)} style={authStyles.stackGap} />
          <AuthButton
            label="Use a different address"
            onPress={() => {
              changeAddress(address);
              setEditing(true);
            }}
          />
        </>
      ) : (
        <>
          <AuthButton
            label={phase === 'checking' ? 'Cancel' : 'Connect'}
            icon={phase === 'checking' ? 'close' : 'play'}
            primary={phase !== 'checking'}
            disabled={phase === 'searching'}
            onPress={phase === 'checking' ? stop : () => connect(address.text)}
            style={authStyles.stackGap}
          />
          <AuthButton
            label={phase === 'searching' ? 'Stop searching' : 'Find servers on this network'}
            icon={phase === 'searching' ? 'close' : 'search'}
            disabled={phase === 'checking'}
            onPress={phase === 'searching' ? stop : search}
          />
          {otherProduct ? (
            <AuthButton
              label={`Connect as ${familyName(otherProduct)} instead`}
              icon="server"
              onPress={() => onUseOtherProvider?.(otherProduct, address.text)}
              style={authStyles.stackGap}
            />
          ) : null}
        </>
      )}
      {onChangeProvider && phase !== 'checking' ? <AuthButton label="Change provider" link onPress={onChangeProvider} /> : null}
      <Text style={styles.remote}>
        {family === 'emby' ? 'Use your Emby server address to connect directly. ' : ''}For remote access, use your server's HTTPS address.
      </Text>
      <StatusLine status={status ?? NOT_CHECKED} />
    </AuthFrame>
  );
}

const NOT_CHECKED: ConnectStatus = { tone: 'info', title: 'Address not yet checked' };

const styles = StyleSheet.create({
  fieldHint: { color: colors.textMuted, fontSize: type.body, marginTop: -px(10), marginBottom: px(28) },
  remote: { color: colors.textMuted, fontSize: type.body, marginTop: px(20), marginBottom: px(24) },
  right: { width: px(KEYBOARD_PANEL_WIDTH) },
  nearby: { maxHeight: px(820), padding: px(32), borderRadius: px(24), backgroundColor: colors.surface },
  nearbyHeading: { color: colors.textMuted, fontSize: type.heading, fontWeight: '700', marginBottom: px(20) },
  nearbyContent: { padding: px(8) },
  nearbyItem: { justifyContent: 'flex-start', marginBottom: px(16) },
});
