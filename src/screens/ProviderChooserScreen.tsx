import { StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle } from '../components/AuthFrame';
import { ServerRow } from '../components/ServerRow';
import type { ConnectionView } from '../connections/model';
import { px } from '../layout';
import type { ServerKind } from '../providers/types';
import { connectionSubtitle } from '../servers';
import { colors, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  /** The connection in use, shown under "Already connected" when adding from inside the app. */
  active?: ConnectionView;
  onChoose: (provider: ServerKind) => void;
  onManage?: () => void;
  onBack: () => void;
}

/**
 * Add a server (docs/design add-provider mockup): Jellyfin and Plex side by side, each with its own action,
 * because they sign in differently. Adding a server here never changes the one currently in use. Provider
 * names are text: the marks in the mockup are illustrative and real logos need their owners' assets.
 */
export function ProviderChooserScreen({ active, onChoose, onManage, onBack }: Props) {
  useBack(() => {
    onBack();
    return true;
  });
  return (
    <AuthFrame onBack={onBack}>
      <HeroTitle>Add a server</HeroTitle>
      <Text style={authStyles.lead}>Choose how you want to connect your library.</Text>
      <View style={styles.cards}>
        <View style={[styles.card, styles.cardGap]}>
          <Text style={styles.cardTitle}>Jellyfin</Text>
          <Text style={styles.cardDetail}>Enter a server address, then sign in or use Quick Connect.</Text>
          <AuthButton label="Connect Jellyfin" primary preferred onPress={() => onChoose('jellyfin')} />
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Plex</Text>
          <Text style={styles.cardDetail}>Sign in with Plex to find servers you own or can access.</Text>
          <AuthButton label="Sign in with Plex" onPress={() => onChoose('plex')} />
        </View>
      </View>
      {active && onManage ? (
        <View style={styles.connected}>
          <Text style={styles.connectedLabel}>Already connected</Text>
          <View style={styles.connectedRow}>
            <View style={styles.connectedServer}>
              <ServerRow
                title={active.displayName}
                subtitle={connectionSubtitle(active)}
                status="Active"
                tone="ok"
                disabled
                accessibilityLabel={`${active.displayName}, ${connectionSubtitle(active)}, active`}
                onPress={() => undefined}
              />
            </View>
            <AuthButton label="Manage servers" icon="server" compact onPress={onManage} style={styles.manage} />
          </View>
        </View>
      ) : null}
      <Text style={authStyles.note}>Each server keeps its own account, library and viewing progress.</Text>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row' },
  card: {
    flex: 1,
    justifyContent: 'space-between',
    minHeight: px(330),
    padding: px(40),
    borderRadius: px(20),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  cardGap: { marginRight: px(32) },
  cardTitle: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  cardDetail: { color: colors.textMuted, fontSize: type.card, lineHeight: px(38), marginTop: px(8), marginBottom: px(28) },
  connected: { marginTop: px(32) },
  connectedLabel: { color: colors.text, fontSize: type.card, fontWeight: '700', marginBottom: px(12) },
  connectedRow: { flexDirection: 'row', alignItems: 'center' },
  connectedServer: { flex: 1 },
  manage: { marginLeft: px(24), marginBottom: px(16) },
});
