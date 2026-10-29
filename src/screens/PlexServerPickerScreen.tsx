import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, StatusLine } from '../components/AuthFrame';
import { ServerRow, type RowTone } from '../components/ServerRow';
import type { PlexServerChoice } from '../connections/connectionStore';
import { px } from '../layout';
import { describePlexError, findReachable, listPlexServers, type PlexHttp } from '../providers/plex';
import {
  endpointsFor,
  pickerRows,
  pickerRowStatus,
  pickerRowSubtitle,
  refreshRows,
  toggleRow,
  withReach,
  type PickerRow,
} from '../servers';
import { colors, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  /** plex.tv client carrying the account token. Must be stable across renders. */
  account: PlexHttp;
  accountName: string;
  /** Machine ids already saved for this account, and ones the user removed before. */
  saved: string[];
  removed: string[];
  /** In-app the current library stays open; on first launch there is none yet. */
  firstRun: boolean;
  /** Every server discovery found, so ones already saved can take their fresh tokens. */
  onDiscovered: (servers: PlexServerChoice[]) => void;
  /** Saves the ticked servers. The screen does not switch to any of them. */
  onSave: (choices: PlexServerChoice[]) => void;
  /** Link a different Plex account instead. */
  onOtherAccount: () => void;
  onCancel: () => void;
}

type Load = { name: 'loading' } | { name: 'ready' } | { name: 'error'; message: string };

function tone(row: PickerRow): RowTone {
  if (row.alreadyAdded) {
    return 'off';
  }
  return row.reach.state === 'online' ? 'ok' : row.reach.state === 'checking' ? 'busy' : 'off';
}

/**
 * Choose your Plex servers (docs/design plex-choose-servers mockup): owned and shared servers with whether
 * they answer now and how. Nothing is ticked until the user ticks it; servers already on this TV are shown
 * but cannot be added twice. Refresh keeps the ticks. Unreachable servers can still be saved, since they may
 * just be switched off, but they are never shown as connected.
 */
export function PlexServerPickerScreen({ account, accountName, saved, removed, firstRun, onDiscovered, onSave, onOtherAccount, onCancel }: Props) {
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [load, setLoad] = useState<Load>({ name: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ name: 'loading' });
    (async () => {
      try {
        const servers = await listPlexServers(account, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        onDiscovered(
          servers.map(server => ({
            machineId: server.machineId,
            name: server.name,
            ownerName: server.ownerName,
            accessToken: server.accessToken,
            endpoints: server.candidates.map(c => c.uri),
          })),
        );
        setRows(prev => (prev.length ? refreshRows(prev, servers, saved, removed) : pickerRows(servers, saved, removed)));
        setLoad({ name: 'ready' });
        await Promise.all(
          servers.map(async server => {
            const reach = await findReachable(account, server, controller.signal);
            if (!controller.signal.aborted) {
              setRows(prev => withReach(prev, server.machineId, reach));
            }
          }),
        );
      } catch (e) {
        if (!controller.signal.aborted) {
          setLoad({ name: 'error', message: describePlexError(e) });
        }
      }
    })();
    return () => controller.abort();
    // `saved` and `removed` are read at load time only; a refresh re-reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, round]);

  useBack(() => {
    onCancel();
    return true;
  });

  const toggle = useCallback((id: string) => setRows(prev => toggleRow(prev, id)), []);
  const ticked = rows.filter(r => r.selected);
  const save = () =>
    onSave(
      ticked.map(r => ({
        machineId: r.server.machineId,
        name: r.server.name,
        ownerName: r.server.ownerName,
        accessToken: r.server.accessToken,
        endpoints: endpointsFor(r),
      })),
    );

  const empty = load.name === 'ready' && rows.length === 0;
  const firstSelectable = rows.findIndex(r => !r.alreadyAdded);

  return (
    <AuthFrame onBack={onCancel}>
      <HeroTitle>Choose your Plex servers</HeroTitle>
      <View style={styles.subtitleRow}>
        <Text style={[authStyles.lead, styles.flex]}>{`Signed in as ${accountName} · Plex`}</Text>
        <AuthButton label="Use another Plex account" link compact onPress={onOtherAccount} />
      </View>
      {load.name === 'loading' && rows.length === 0 ? <StatusLine status={{ tone: 'busy', title: 'Finding servers…' }} /> : null}
      {load.name === 'error' ? <StatusLine status={{ tone: 'error', title: load.message }} /> : null}
      {empty ? (
        <StatusLine
          status={{ tone: 'info', title: 'No servers on this account', detail: 'Ask the server owner to share their library with you, then refresh.' }}
        />
      ) : null}
      <ScrollView style={styles.list}>
        {rows.map((row, i) => (
          <ServerRow
            key={row.server.machineId}
            title={row.server.name}
            subtitle={pickerRowSubtitle(row)}
            status={pickerRowStatus(row)}
            tone={tone(row)}
            checkbox
            checked={row.selected || row.alreadyAdded}
            disabled={row.alreadyAdded}
            preferred={i === firstSelectable}
            accessibilityLabel={`${row.server.name}, ${pickerRowSubtitle(row)}, ${pickerRowStatus(row)}`}
            onPress={() => toggle(row.server.machineId)}
          />
        ))}
      </ScrollView>
      <Text style={styles.count}>{`${ticked.length} ${ticked.length === 1 ? 'server' : 'servers'} selected`}</Text>
      <View style={styles.actions}>
        <AuthButton
          label={ticked.length > 1 ? 'Add selected servers' : 'Add selected server'}
          primary
          disabled={ticked.length === 0}
          onPress={save}
          style={styles.add}
          preferred={empty || load.name === 'error' || (load.name === 'ready' && firstSelectable < 0)}
        />
        <AuthButton label="Refresh" onPress={() => setRound(n => n + 1)} style={styles.refresh} />
        <Text style={styles.later}>You can add more servers later in Settings → Servers.</Text>
      </View>
      {!firstRun ? <Text style={authStyles.note}>Adding servers keeps your current library open.</Text> : null}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center' },
  list: { flexGrow: 0, maxHeight: px(420) },
  count: { color: colors.textMuted, fontSize: type.body, marginTop: px(4), marginBottom: px(16) },
  actions: { flexDirection: 'row', alignItems: 'center' },
  add: { width: px(580), marginRight: px(24) },
  refresh: { width: px(370), marginRight: px(24) },
  later: { flex: 1, textAlign: 'right', color: colors.textMuted, fontSize: type.body },
});
