import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, ServerIdentity, StatusLine } from '../components/AuthFrame';
import { displayAddress } from '../connect';
import { px } from '../layout';
import { fetchPublicUsers, initials, type PublicUser } from '../providers/emby';
import type { DeviceInfo } from '../providers/jellyfin/http';
import type { ServerRecord } from '../providers/types';
import { colors, focus, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  device: DeviceInfo;
  server: ServerRecord;
  /** The user picked last time on this server, focused first if still listed. */
  rememberedUserId?: string;
  /** A listed user, or undefined for Other user. Either way the next step is sign-in; nothing is signed in here. */
  onChoose: (user?: PublicUser) => void;
  /** The server lists nobody: go straight to the sign-in form. */
  onNoUsers: () => void;
  onChangeServer: () => void;
  onBack: () => void;
}

/**
 * Who's watching? before sign-in (Emby connection spec EC04). Lists only the users the server itself shows
 * on its sign-in screen; hidden users type their name under Other user. Choosing a tile never signs in by
 * itself: a passwordless user still goes through a real sign-in request.
 */
export function EmbyUserPickerScreen({ device, server, rememberedUserId, onChoose, onNoUsers, onChangeServer, onBack }: Props) {
  const [users, setUsers] = useState<PublicUser[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicUsers(server, device, { signal: controller.signal }).then(
      list => {
        if (controller.signal.aborted) {
          return;
        }
        if (list.length === 0) {
          onNoUsers();
        } else {
          setUsers(list);
        }
      },
      () => undefined, // cancelled: the screen closed
    );
    return () => controller.abort();
    // One load per server; the callbacks are stable for the life of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.baseUrl]);

  useBack(() => {
    onBack();
    return true;
  });

  const focusId = users?.some(u => u.id === rememberedUserId) ? rememberedUserId : users?.[0]?.id;

  return (
    <AuthFrame onBack={onBack}>
      <HeroTitle>Who's watching?</HeroTitle>
      <Text style={authStyles.lead}>{`Choose a user on ${server.name}.`}</Text>
      <View style={styles.server}>
        <ServerIdentity name={server.name} address={displayAddress(server.baseUrl)} />
        <View style={styles.divider} />
        <AuthButton label="Change server" link onPress={onChangeServer} />
      </View>
      {users === null ? (
        <StatusLine status={{ tone: 'busy', title: 'Finding users…' }} />
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.users}>
          {users.map(user => (
            <UserTile key={user.id} user={user} preferred={user.id === focusId} onPress={() => onChoose(user)} />
          ))}
        </ScrollView>
      )}
      <AuthButton label="Other user" compact disabled={users === null} onPress={() => onChoose(undefined)} style={styles.other} />
      <Text style={authStyles.note}>Enter a username if it is not listed. Users shown here are made visible by your server.</Text>
    </AuthFrame>
  );
}

function UserTile({ user, preferred, onPress }: { user: PublicUser; preferred: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const note = user.hasPassword ? 'Sign in required' : 'Continue to sign-in';
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={`${user.name}, ${note}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.tile, focused && styles.tileFocused]}>
      {user.imageUrl && !imageFailed ? (
        <Image source={{ uri: user.imageUrl }} style={styles.avatar} onError={() => setImageFailed(true)} />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty]}>
          <Text style={styles.avatarText}>{initials(user.name) || '?'}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {user.name}
      </Text>
      <Text style={styles.note} numberOfLines={1}>
        {note}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  server: { flexDirection: 'row', alignItems: 'center', marginBottom: px(24) },
  divider: { width: px(2), height: px(56), backgroundColor: colors.surfaceFocused, marginHorizontal: px(20) },
  users: { paddingVertical: px(8), paddingRight: px(40) },
  tile: {
    width: px(260),
    alignItems: 'center',
    paddingVertical: px(28),
    marginRight: px(28),
    borderRadius: px(20),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  tileFocused: { borderColor: colors.focusRing },
  avatar: { width: px(150), height: px(150), borderRadius: px(20) },
  avatarEmpty: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: type.featured, fontWeight: '800' },
  name: { color: colors.text, fontSize: type.card, fontWeight: '700', marginTop: px(18), maxWidth: px(220) },
  note: { color: colors.textMuted, fontSize: type.caption, marginTop: px(4) },
  other: { alignSelf: 'flex-start', marginTop: px(28), marginBottom: px(8) },
});
