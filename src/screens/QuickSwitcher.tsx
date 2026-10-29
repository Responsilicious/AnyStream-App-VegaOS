import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { KeyHint, StatusLine } from '../components/AuthFrame';
import { ServerRow } from '../components/ServerRow';
import type { ConnectionStore } from '../connections/connectionStore';
import type { SwitchPhase } from '../connections/contextCoordinator';
import type { ConnectionStatus } from '../connections/model';
import { checkConnection } from '../connections/status';
import { px } from '../layout';
import type { DeviceInfo } from '../providers/jellyfin/http';
import { connectionSubtitle, routeOf, rowLabel, statusText, type Route } from '../servers';
import { colors, type } from '../theme';
import { useBack } from '../useBack';
import { toneFor } from './ServerManagerScreen';

interface Props {
  store: ConnectionStore;
  device: DeviceInfo;
  /** The switch in progress, from the coordinator, so the panel can say "Checking…" and show failures. */
  phase: SwitchPhase;
  target?: string;
  /** A failure to show under the list, in plain words. */
  error?: string;
  onSwitch: (connectionId: string) => void;
  /** Back or Close: also cancels a switch still being checked. */
  onClose: () => void;
  onAddServer: () => void;
  onManage: () => void;
}

/**
 * Switch server (docs/design switch-server mockup): a panel on the right over a dimmed backdrop. Render it in
 * place of the screen behind it, as CardMenu is: on Vega an absolutely positioned layer does not stop D-pad
 * focus reaching controls underneath. The caller puts focus back on the header pill when it closes. Moving
 * focus never switches; only Select on a row does, and the current server stays until the new one is checked.
 */
export function QuickSwitcher({ store, device, phase, target, error, onSwitch, onClose, onAddServer, onManage }: Props) {
  const views = store.list();
  const [rows, setRows] = useState<Record<string, { status: ConnectionStatus; route?: Route }>>({});

  useEffect(() => {
    const controller = new AbortController();
    for (const v of store.list()) {
      if (v.active) {
        continue;
      }
      checkConnection(store, v.connection.id, device, controller.signal).then(
        r => !controller.signal.aborted && setRows(s => ({ ...s, [v.connection.id]: { status: r.status, route: r.endpoint ? routeOf(r.endpoint) : undefined } })),
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [store, device]);

  useBack(() => {
    onClose();
    return true;
  });

  const busy = phase === 'checking' || phase === 'preparing';
  const targetName = target ? store.get(target)?.displayName : undefined;

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel} accessibilityViewIsModal>
        <Text style={styles.title} accessibilityRole="header">
          Switch server
        </Text>
        <Text style={styles.subtitle}>Choose a library to browse.</Text>
        <ScrollView style={styles.list}>
          {views.map(v => {
            const r = rows[v.connection.id];
            const status: ConnectionStatus = v.active ? 'online' : r?.status ?? 'checking';
            return (
              <ServerRow
                key={v.connection.id}
                compact
                title={v.displayName}
                subtitle={connectionSubtitle(v)}
                status={v.active ? 'Current' : statusText(status, r?.route)}
                tone={toneFor(status)}
                selected={v.active}
                preferred={v.active}
                disabled={busy}
                accessibilityLabel={v.active ? `${v.displayName}, ${connectionSubtitle(v)}, current server` : rowLabel(v, status)}
                onPress={() => (v.active ? onClose() : onSwitch(v.connection.id))}
              />
            );
          })}
        </ScrollView>
        {busy ? <StatusLine status={{ tone: 'busy', title: `Checking ${targetName ?? 'server'}…`, detail: 'Your current server stays open until this works.' }} /> : null}
        {!busy && error ? <StatusLine status={{ tone: 'error', title: error }} /> : null}
        <View style={styles.rule} />
        <AuthButton label="Add server" icon="link" compact onPress={onAddServer} style={styles.action} disabled={busy} />
        <AuthButton label="Manage servers" icon="server" compact onPress={onManage} style={styles.action} disabled={busy} />
        {busy ? <AuthButton label="Cancel" icon="close" compact onPress={onClose} style={styles.action} /> : null}
        <View style={styles.flex} />
        <KeyHint text="Back · Close" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.background, alignItems: 'flex-end', paddingTop: px(96), paddingRight: px(48), paddingBottom: px(32) },
  panel: {
    width: px(1000),
    flex: 1,
    paddingHorizontal: px(40),
    paddingVertical: px(36),
    borderRadius: px(24),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: type.card, marginTop: px(4), marginBottom: px(24) },
  list: { flexGrow: 0, maxHeight: px(470) },
  rule: { height: px(2), backgroundColor: colors.surfaceFocused, marginVertical: px(18) },
  action: { marginBottom: px(14) },
});
