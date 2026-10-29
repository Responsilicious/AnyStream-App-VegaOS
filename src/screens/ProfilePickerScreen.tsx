import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, StatusLine } from '../components/AuthFrame';
import type { ConnectionStore } from '../connections/connectionStore';
import type { ConnectionView } from '../connections/model';
import { px } from '../layout';
import type { DeviceInfo } from '../providers/jellyfin/http';
import {
  describePlexError,
  isPlexError,
  listHomeUsers,
  listPlexServers,
  PLEX_CLIENTS_URL,
  PlexHttp,
  switchHomeUser,
  type PlexHomeUser,
} from '../providers/plex';
import { colors, focus, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  store: ConnectionStore;
  device: DeviceInfo;
  /** The Plex connection whose profile is being chosen. */
  view: ConnectionView;
  /** The profile changed; the caller reopens the server through its usual check. */
  onSwitched: () => void;
  onCancel: () => void;
}

type State =
  | { name: 'loading' }
  | { name: 'list'; users: PlexHomeUser[] }
  | { name: 'pin'; users: PlexHomeUser[]; user: PlexHomeUser; error?: string }
  | { name: 'switching'; users: PlexHomeUser[]; user: PlexHomeUser }
  | { name: 'error'; message: string; users?: PlexHomeUser[] };

const PIN_LENGTH = 4;

/**
 * Who's watching? (spec §8): the members of the account's Plex Home. A protected profile asks for its own PIN,
 * which is not the link code. The switch fetches that profile's own server token, so Plex keeps enforcing its
 * restrictions; nothing here relaxes them.
 */
export function ProfilePickerScreen({ store, device, view, onSwitched, onCancel }: Props) {
  const [state, setState] = useState<State>({ name: 'loading' });
  const [pin, setPin] = useState('');
  const account = new PlexHttp(PLEX_CLIENTS_URL, device, store.getSecret(view.account.credentialRef));

  useEffect(() => {
    const controller = new AbortController();
    listHomeUsers(account, controller.signal).then(
      users => !controller.signal.aborted && setState({ name: 'list', users }),
      e => !controller.signal.aborted && setState({ name: 'error', message: describePlexError(e) }),
    );
    return () => controller.abort();
    // The account is fixed for the life of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBack(() => {
    if (state.name === 'pin') {
      setPin('');
      setState({ name: 'list', users: state.users });
    } else {
      onCancel();
    }
    return true;
  });

  const choose = async (users: PlexHomeUser[], user: PlexHomeUser, code?: string) => {
    setState({ name: 'switching', users, user });
    try {
      const profileToken = await switchHomeUser(account, user.uuid, code);
      const servers = await listPlexServers(account.withToken(profileToken));
      const here = servers.find(s => s.machineId === view.server.nativeId);
      if (!here) {
        setState({ name: 'error', message: `${user.name} does not have access to ${view.displayName}.`, users });
        return;
      }
      store.setPlexProfile(view.connection.id, { profileId: user.uuid, profileName: user.name, serverToken: here.accessToken });
      onSwitched();
    } catch (e) {
      if (isPlexError(e) && e.kind === 'wrong-pin') {
        setPin('');
        setState({ name: 'pin', users, user, error: describePlexError(e) });
      } else {
        setState({ name: 'error', message: describePlexError(e), users });
      }
    }
  };

  const select = (users: PlexHomeUser[], user: PlexHomeUser) => {
    if (user.uuid === view.connection.profileId) {
      onCancel();
    } else if (user.protected) {
      setPin('');
      setState({ name: 'pin', users, user });
    } else {
      choose(users, user);
    }
  };

  if (state.name === 'pin' || (state.name === 'switching' && state.user.protected)) {
    const user = state.user;
    const press = (digit: string) => {
      if (state.name !== 'pin') {
        return;
      }
      const next = (pin + digit).slice(0, PIN_LENGTH);
      setPin(next);
      if (next.length === PIN_LENGTH) {
        choose(state.users, user, next);
      }
    };
    return (
      <AuthFrame onBack={() => (state.name === 'pin' ? setState({ name: 'list', users: state.users }) : undefined)}>
        <HeroTitle>{`Enter PIN for ${user.name}`}</HeroTitle>
        <Text style={authStyles.lead}>This is the profile's Plex PIN, not the link code.</Text>
        <View style={styles.dots} accessible accessibilityLabel={`${pin.length} of ${PIN_LENGTH} digits entered`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
          ))}
        </View>
        <View style={styles.pad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0'].map((key, i) => (
            <PadKey
              key={key}
              label={key === 'del' ? 'Delete' : key}
              preferred={i === 0}
              disabled={state.name !== 'pin'}
              onPress={() => (key === 'del' ? setPin(p => p.slice(0, -1)) : press(key))}
            />
          ))}
        </View>
        <StatusLine
          status={
            state.name === 'switching'
              ? { tone: 'busy', title: `Switching to ${user.name}…` }
              : state.error
                ? { tone: 'error', title: state.error }
                : null
          }
        />
      </AuthFrame>
    );
  }

  const users = state.name === 'list' || state.name === 'switching' ? state.users : state.name === 'error' ? state.users ?? [] : [];
  return (
    <AuthFrame onBack={onCancel}>
      <HeroTitle>Who's watching?</HeroTitle>
      <Text style={authStyles.lead}>{`Profiles in this Plex Home, on ${view.displayName}.`}</Text>
      {state.name === 'loading' ? <StatusLine status={{ tone: 'busy', title: 'Finding profiles…' }} /> : null}
      {state.name === 'list' && users.length <= 1 ? (
        <StatusLine status={{ tone: 'info', title: 'This Plex account has no other Home profiles.', detail: 'Add people to your Plex Home on plex.tv to switch here.' }} />
      ) : null}
      <View style={styles.profiles}>
        {users.map((user, i) => (
          <ProfileTile
            key={user.uuid}
            user={user}
            current={user.uuid === view.connection.profileId}
            preferred={view.connection.profileId ? user.uuid === view.connection.profileId : i === 0}
            disabled={state.name === 'switching'}
            onPress={() => select(users, user)}
          />
        ))}
      </View>
      {state.name === 'switching' ? <StatusLine status={{ tone: 'busy', title: `Switching to ${state.user.name}…` }} /> : null}
      {state.name === 'error' ? <StatusLine status={{ tone: 'error', title: state.message }} /> : null}
      <AuthButton label="Cancel" icon="close" compact preferred={users.length === 0} onPress={onCancel} style={styles.cancel} />
    </AuthFrame>
  );
}

function ProfileTile({
  user,
  current,
  preferred,
  disabled,
  onPress,
}: {
  user: PlexHomeUser;
  current: boolean;
  preferred: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const notes = [current ? 'Current' : '', user.admin ? 'Owner' : '', user.restricted ? 'Restricted' : '', user.protected ? 'PIN' : ''].filter(Boolean);
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={[user.name, ...notes].join(', ')}
      accessibilityState={{ selected: current, disabled }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      style={[styles.tile, current && styles.tileCurrent, focused && styles.tileFocused]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(user.name.trim()[0] ?? '?').toUpperCase()}</Text>
      </View>
      <Text style={styles.tileName} numberOfLines={1}>
        {user.name}
      </Text>
      <Text style={styles.tileNotes} numberOfLines={1}>
        {notes.join(' · ') || ' '}
      </Text>
    </Pressable>
  );
}

function PadKey({ label, preferred, disabled, onPress }: { label: string; preferred: boolean; disabled: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      style={[styles.key, focused && styles.tileFocused]}>
      <Text style={styles.keyText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profiles: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(12) },
  tile: {
    width: px(260),
    alignItems: 'center',
    paddingVertical: px(28),
    marginRight: px(28),
    marginBottom: px(28),
    borderRadius: px(20),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  tileCurrent: { borderBottomColor: colors.accent, borderBottomWidth: px(10) },
  tileFocused: { borderColor: colors.focusRing },
  avatar: { width: px(120), height: px(120), borderRadius: px(60), backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: type.featured, fontWeight: '800' },
  tileName: { color: colors.text, fontSize: type.card, fontWeight: '700', marginTop: px(18) },
  tileNotes: { color: colors.textMuted, fontSize: type.caption, marginTop: px(4) },
  cancel: { alignSelf: 'flex-start', marginTop: px(12) },
  dots: { flexDirection: 'row', marginVertical: px(24) },
  dot: { width: px(36), height: px(36), borderRadius: px(18), borderWidth: px(3), borderColor: colors.textMuted, marginRight: px(24) },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: px(3 * 150 + 3 * 16) },
  key: {
    width: px(150),
    height: px(90),
    marginRight: px(16),
    marginBottom: px(16),
    borderRadius: px(14),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { color: colors.text, fontSize: type.title, fontWeight: '700' },
});
