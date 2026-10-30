import { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle } from '../components/AuthFrame';
import { FocusButton } from '../components/FocusButton';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { ServerRow, type RowTone } from '../components/ServerRow';
import { TextField } from '../components/TextField';
import type { ConnectionStore } from '../connections/connectionStore';
import type { ConnectionStatus, ConnectionView } from '../connections/model';
import { checkConnection } from '../connections/status';
import { startEdit, type TextEdit } from '../keyboard';
import { px } from '../layout';
import type { DeviceInfo } from '../providers/jellyfin/http';
import {
  connectionSubtitle,
  MANAGER_ACTION_LABELS,
  managerActions,
  removeMessage,
  routeOf,
  routeText,
  rowLabel,
  signOutMessage,
  startupText,
  statusText,
  type ManagerAction,
  type Route,
} from '../servers';
import { colors, spacing, type } from '../theme';
import { useBack } from '../useBack';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('../assets/logo.png');

interface Props {
  store: ConnectionStore;
  device: DeviceInfo;
  /** Starts a validated switch; the manager stays open until it succeeds. */
  onSwitch: (connectionId: string) => void;
  onAddServer: () => void;
  onSignInAgain: (view: ConnectionView) => void;
  /** The active connection was removed or signed out. */
  onActiveRemoved: () => void;
  onBack: () => void;
}

type Mode =
  | { name: 'list' }
  | { name: 'confirm-remove'; id: string }
  | { name: 'confirm-sign-out'; id: string }
  | { name: 'rename'; id: string };

interface RowState {
  status: ConnectionStatus;
  route?: Route;
}

export function toneFor(status: ConnectionStatus): RowTone {
  switch (status) {
    case 'online':
      return 'ok';
    case 'checking':
      return 'busy';
    case 'unavailable':
      return 'off';
    default:
      return 'warn';
  }
}

/**
 * Settings → Servers (docs/design manage-servers mockup): saved connections on the left, the focused one's
 * details and actions on the right. Focus can rest on any row without switching to it; Select moves focus
 * into the panel. Exactly one row is Active.
 */
export function ServerManagerScreen({ store, device, onSwitch, onAddServer, onSignInAgain, onActiveRemoved, onBack }: Props) {
  const [views, setViews] = useState<ConnectionView[]>(() => store.list());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  // The row whose details the panel shows (follows focus), and whether focus has moved into the panel.
  const [shown, setShown] = useState<string | undefined>(() => store.list()[0]?.connection.id);
  const [inPanel, setInPanel] = useState(false);
  const [alias, setAlias] = useState<TextEdit>(() => startEdit(''));
  const [keyboard, setKeyboard] = useState(false);

  const reload = useCallback(() => {
    const next = store.list();
    setViews(next);
    setShown(id => (next.some(v => v.connection.id === id) ? id : next[0]?.connection.id));
  }, [store]);

  useEffect(() => {
    const controller = new AbortController();
    const ids = store.list().map(v => v.connection.id);
    setRows(Object.fromEntries(ids.map(id => [id, { status: 'checking' as ConnectionStatus }])));
    for (const id of ids) {
      checkConnection(store, id, device, controller.signal).then(
        result => {
          if (controller.signal.aborted) {
            return;
          }
          if (result.workingEndpoint) {
            const v = store.get(id);
            if (v) {
              store.updateEndpoints(v.server.id, [result.workingEndpoint, ...v.server.endpoints]);
            }
          }
          setRows(s => ({ ...s, [id]: { status: result.status, route: result.endpoint ? routeOf(result.endpoint) : undefined } }));
        },
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [store, device]);

  const close = () => setMode({ name: 'list' });

  useBack(() => {
    if (keyboard) {
      setKeyboard(false);
    } else if (mode.name !== 'list') {
      close();
    } else if (inPanel) {
      setInPanel(false);
    } else {
      onBack();
    }
    return true;
  });

  const row = (id: string): RowState => rows[id] ?? { status: 'checking' };
  const target = mode.name === 'list' ? undefined : views.find(v => v.connection.id === mode.id);

  const act = (view: ConnectionView, action: ManagerAction) => {
    const id = view.connection.id;
    switch (action) {
      case 'switch':
        onSwitch(id);
        return;
      case 'sign-in':
        onSignInAgain(view);
        return;
      case 'rename':
        setAlias(startEdit(view.server.alias ?? ''));
        setKeyboard(true);
        setMode({ name: 'rename', id });
        return;
      case 'startup':
        store.setStartup('pinned', id);
        break;
      case 'clear-startup':
        store.setStartup('last-used');
        break;
      case 'remove':
        setMode({ name: 'confirm-remove', id });
        return;
      case 'sign-out-account':
        setMode({ name: 'confirm-sign-out', id });
        return;
    }
    reload();
  };

  if (target && (mode.name === 'confirm-remove' || mode.name === 'confirm-sign-out')) {
    const impact = mode.name === 'confirm-sign-out' ? store.accountImpact(target.account.id) : undefined;
    const message =
      mode.name === 'confirm-remove'
        ? removeMessage(target)
        : signOutMessage(target.account.displayName, (impact?.connections ?? []).map(v => v.displayName));
    const confirm = () => {
      const wasActive = mode.name === 'confirm-remove' ? target.active : !!impact?.connections.some(v => v.active);
      if (mode.name === 'confirm-remove') {
        store.remove(target.connection.id);
      } else {
        store.signOutAccount(target.account.id);
      }
      reload();
      close();
      setInPanel(false);
      if (wasActive) {
        onActiveRemoved();
      }
    };
    return (
      <View style={styles.dialog}>
        <Text style={styles.dialogTitle}>{mode.name === 'confirm-remove' ? `Remove ${target.displayName}?` : 'Sign out of Plex?'}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.dialogActions}>
          <FocusButton label="Cancel" preferred onPress={close} style={styles.dialogAction} />
          <FocusButton label={mode.name === 'confirm-remove' ? 'Remove' : 'Sign out'} onPress={confirm} style={styles.dialogAction} />
        </View>
      </View>
    );
  }

  if (target && mode.name === 'rename') {
    const save = () => {
      store.rename(target.connection.id, alias.text);
      reload();
      close();
    };
    return (
      <AuthFrame
        onBack={close}
        right={keyboard ? <OnScreenKeyboard title="Name in AnyStream" mode="username" value={alias} onChange={setAlias} onDone={() => setKeyboard(false)} /> : undefined}>
        <HeroTitle>Rename</HeroTitle>
        <Text style={authStyles.lead}>{`Only this TV sees the new name. ${target.server.name} keeps its own name on the server.`}</Text>
        <TextField label="Name" value={alias.text} caret={alias.caret} placeholder={target.server.name} editing={keyboard} onPress={() => setKeyboard(true)} />
        <View style={styles.renameActions}>
          <AuthButton label="Save" primary preferred={!keyboard} disabled={keyboard} onPress={save} style={styles.renameAction} />
          <AuthButton label="Cancel" compact disabled={keyboard} onPress={close} />
        </View>
      </AuthFrame>
    );
  }

  const detail = views.find(v => v.connection.id === shown);

  return (
    <View style={styles.screen}>
      <View style={styles.main}>
        <Image source={LOGO} accessibilityLabel="AnyStream" style={styles.logo} resizeMode="contain" />
        <Text style={styles.crumb}>Settings  /  Servers</Text>
        <View style={styles.heading}>
          <View style={styles.flex}>
            <Text style={styles.title} accessibilityRole="header">
              Connected servers
            </Text>
            <Text style={styles.subtitle}>Manage the libraries available on this TV.</Text>
          </View>
          <AuthButton label="Add server" icon="link" primary preferred={views.length === 0} onPress={onAddServer} />
        </View>
        <ScrollView style={styles.list}>
          {views.map((v, i) => {
            const r = row(v.connection.id);
            return (
              <ServerRow
                key={v.connection.id}
                title={v.displayName}
                subtitle={connectionSubtitle(v)}
                status={statusText(r.status, r.route)}
                tone={toneFor(r.status)}
                selected={v.active}
                flags={[v.active ? 'Active' : '', v.startup ? 'Startup' : ''].filter(Boolean)}
                preferred={!inPanel && (shown ? v.connection.id === shown : i === 0)}
                accessibilityLabel={rowLabel(v, r.status)}
                onFocus={() => {
                  setShown(v.connection.id);
                  setInPanel(false);
                }}
                onPress={() => setInPanel(true)}
              />
            );
          })}
        </ScrollView>
      </View>
      {detail ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle} numberOfLines={1}>
            {detail.displayName}
          </Text>
          <Text style={styles.panelSubtitle} numberOfLines={1}>
            {connectionSubtitle(detail)}
          </Text>
          <View style={styles.rule} />
          <Fact label="Connection" value={row(detail.connection.id).route ? routeText(row(detail.connection.id).route as Route) : statusText(row(detail.connection.id).status)} />
          <Fact label="Startup preference" value={startupText(detail)} />
          <View style={styles.rule} />
          {managerActions(detail, row(detail.connection.id).status).map((action, i) => (
            <AuthButton
              key={action}
              label={MANAGER_ACTION_LABELS[action]}
              primary={i === 0 && (action === 'switch' || action === 'sign-in')}
              preferred={inPanel && i === 0}
              compact
              onPress={() => act(detail, action)}
              style={styles.panelAction}
            />
          ))}
          <Text style={styles.note}>
            {detail.server.provider === 'plex'
              ? 'Removing this entry does not delete media or your Plex account.'
              : 'Removing this entry does not delete media from the server.'}
          </Text>
          {detail.server.provider === 'plex' ? (
            <AuthButton label={MANAGER_ACTION_LABELS['sign-out-account']} link compact onPress={() => act(detail, 'sign-out-account')} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
    paddingHorizontal: px(64),
    paddingVertical: px(48),
  },
  flex: { flex: 1 },
  main: { flex: 1, marginRight: px(36) },
  logo: { height: px(72), width: px(216), marginLeft: -px(10) },
  crumb: { color: colors.textMuted, fontSize: type.body, marginTop: px(16) },
  heading: { flexDirection: 'row', alignItems: 'center', marginTop: px(8), marginBottom: px(28) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: type.body, marginTop: px(4) },
  list: { flexGrow: 0 },
  panel: {
    width: px(560),
    padding: px(36),
    borderRadius: px(20),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  panelTitle: { color: colors.text, fontSize: type.title, fontWeight: '800' },
  panelSubtitle: { color: colors.textMuted, fontSize: type.card, marginTop: px(4) },
  rule: { height: px(2), backgroundColor: colors.surfaceFocused, marginVertical: px(24) },
  fact: { flexDirection: 'row', marginBottom: px(14) },
  factLabel: { width: px(250), color: colors.textMuted, fontSize: type.body },
  factValue: { flex: 1, color: colors.text, fontSize: type.body },
  panelAction: { marginBottom: px(14) },
  note: { color: colors.textMuted, fontSize: type.caption, marginTop: px(8), marginBottom: px(12) },
  dialog: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: px(192) },
  dialogTitle: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  message: { color: colors.text, fontSize: type.card, marginTop: px(16), maxWidth: px(1200), lineHeight: px(40) },
  dialogActions: { marginTop: spacing.gapLarge },
  dialogAction: { marginBottom: spacing.gap, alignSelf: 'flex-start', minWidth: px(520) },
  renameActions: { flexDirection: 'row', alignItems: 'center', marginTop: px(28) },
  renameAction: { marginRight: px(18) },
});
