import { StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, ServerIdentity, StatusLine } from '../components/AuthFrame';
import { displayAddress, unavailableMessage } from '../connect';
import { px } from '../layout';
import type { ServerRecord } from '../providers/types';
import { colors, type } from '../theme';

interface Props {
  server: ServerRecord;
  /** A retry is running. */
  checking: boolean;
  onRetry: () => void;
  onChangeServer: () => void;
  /** With other servers saved: open the server list instead of a new connection. */
  onManageServers?: () => void;
}

/**
 * Returning user whose saved server did not answer at start-up. The sign-in is kept, so Retry goes straight to
 * Home once the server is back. Back leaves the app, as from Home.
 */
export function ServerUnavailableScreen({ server, checking, onRetry, onChangeServer, onManageServers }: Props) {
  return (
    <AuthFrame right={<View style={styles.right} />}>
      <HeroTitle>Server unavailable</HeroTitle>
      <Text style={styles.body}>{unavailableMessage(server.name)}</Text>
      <View style={styles.server}>
        <ServerIdentity name={server.name} address={displayAddress(server.baseUrl)} />
      </View>
      <AuthButton label={checking ? 'Checking…' : 'Retry'} icon="play" primary preferred onPress={checking ? () => undefined : onRetry} style={authStyles.stackGap} />
      <AuthButton label={onManageServers ? 'Switch server' : 'Change server'} icon="server" disabled={checking} onPress={onChangeServer} style={onManageServers ? authStyles.stackGap : undefined} />
      {onManageServers ? <AuthButton label="Manage servers" icon="link" disabled={checking} onPress={onManageServers} /> : null}
      <View style={styles.status}>
        <StatusLine status={checking ? { tone: 'busy', title: 'Checking server…' } : null} />
      </View>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  right: { width: px(860) },
  body: { color: colors.text, fontSize: type.card, lineHeight: px(40), marginBottom: px(28) },
  server: { marginBottom: px(36) },
  status: { marginTop: px(24) },
});
