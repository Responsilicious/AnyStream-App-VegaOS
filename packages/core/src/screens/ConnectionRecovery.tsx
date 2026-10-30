import { StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, ServerIdentity } from '../components/AuthFrame';
import { familyName, type ServerFamily } from '../connect';
import { px } from '../layout';
import { colors, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  /** What the person typed, kept so Try again and Edit address start from it. */
  address: string;
  family: ServerFamily;
  onRetry: () => void;
  onEdit: () => void;
  onChangeProvider?: () => void;
  onBack: () => void;
}

/**
 * Could not reach this server (Emby connection spec EC09). Only for an unreachable address: it does not guess
 * whether the network, the server or the address is at fault, and saved servers are never touched here.
 */
export function ConnectionRecovery({ address, family, onRetry, onEdit, onChangeProvider, onBack }: Props) {
  useBack(() => {
    onBack();
    return true;
  });
  return (
    <AuthFrame onBack={onBack}>
      <HeroTitle>Could not reach this server</HeroTitle>
      <Text style={authStyles.lead}>Check the address and make sure your {familyName(family)} server is available.</Text>
      <View style={styles.address}>
        <Text style={authStyles.label}>Server address</Text>
        <ServerIdentity name={address} address="" large />
      </View>
      <Text style={authStyles.note}>Your address has been kept so you can try again.</Text>
      <View style={styles.actions}>
        <AuthButton label="Try again" icon="play" primary preferred onPress={onRetry} style={styles.action} />
        <AuthButton label="Edit address" onPress={onEdit} style={styles.action} />
        {onChangeProvider ? <AuthButton label="Choose another provider" icon="server" onPress={onChangeProvider} /> : null}
      </View>
      <Text style={styles.quiet}>Your saved servers have not changed.</Text>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  address: {
    maxWidth: px(1100),
    padding: px(28),
    borderRadius: px(20),
    backgroundColor: colors.surface,
    marginBottom: px(16),
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(28) },
  action: { marginRight: px(24), marginBottom: px(18) },
  quiet: { color: colors.textMuted, fontSize: type.body, marginTop: px(12) },
});
