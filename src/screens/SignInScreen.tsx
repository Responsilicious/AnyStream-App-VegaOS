import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle, KeyHint, ServerIdentity, StatusLine } from '../components/AuthFrame';
import { Glyph } from '../components/Glyph';
import { KEYBOARD_PANEL_WIDTH, OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { TextField } from '../components/TextField';
import { displayAddress, signInError, type ConnectStatus } from '../connect';
import { startEdit, type TextEdit } from '../keyboard';
import { px } from '../layout';
import { isJellyfinError, JellyfinHttp, signInWithPassword, type DeviceInfo } from '../providers/jellyfin';
import type { ServerRecord, Session } from '../providers/types';
import { colors, focus, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  device: DeviceInfo;
  server: ServerRecord;
  /** The server has Quick Connect turned on. */
  quickConnect: boolean;
  initialUserName?: string;
  /** Shown above the form, e.g. when a saved sign-in has expired. */
  notice?: string;
  onSignedIn: (session: Session) => void;
  onQuickConnect: () => void;
  onChangeServer: () => void;
  onBack: () => void;
}

type Field = 'username' | 'password';

/**
 * Username and password (docs/sign-in.md). The server's name and address stay on screen with Change server.
 * Each field opens its own keyboard. The password is masked unless Show is chosen, starts masked every time
 * the screen opens, and is held only in memory until it has been sent.
 */
export function SignInScreen({
  device,
  server,
  quickConnect,
  initialUserName,
  notice,
  onSignedIn,
  onQuickConnect,
  onChangeServer,
  onBack,
}: Props) {
  const [username, setUsername] = useState<TextEdit>(() => startEdit(initialUserName ?? ''));
  const [password, setPassword] = useState<TextEdit>(() => startEdit(''));
  const [editing, setEditing] = useState<Field | null>(null);
  // The field focus returns to when the keyboard closes; the epoch remounts it so preferred focus applies.
  const [returnTo, setReturnTo] = useState<Field>(initialUserName ? 'password' : 'username');
  const [epoch, setEpoch] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ConnectStatus | null>(notice ? { tone: 'info', title: notice } : null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const open = (field: Field) => {
    setEditing(field);
    setReturnTo(field);
  };

  const closeKeyboard = useCallback(() => {
    setEditing(null);
    setEpoch(n => n + 1);
  }, []);

  const submit = useCallback(async () => {
    if (!username.text || busy) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStatus({ tone: 'busy', title: 'Signing in…' });
    try {
      // Exactly as typed: credentials keep their case, punctuation and spaces.
      const session = await signInWithPassword(new JellyfinHttp(server.baseUrl, device), server, username.text, password.text, controller.signal);
      setPassword(startEdit(''));
      onSignedIn(session);
    } catch (e) {
      setBusy(false);
      if (isJellyfinError(e) && e.kind === 'cancelled') {
        setStatus(null);
        return;
      }
      if (isJellyfinError(e) && e.kind === 'unauthorized') {
        setPassword(startEdit(''));
      }
      setStatus({ tone: 'error', title: signInError(e, server.name) });
    }
  }, [busy, device, onSignedIn, password.text, server, username.text]);

  useBack(() => {
    if (editing) {
      closeKeyboard();
      return true;
    }
    if (busy) {
      abortRef.current?.abort();
      return true;
    }
    onBack();
    return true;
  });

  const address = displayAddress(server.baseUrl);
  const right = (
    <View style={styles.right}>
      {editing && (
        <>
          <OnScreenKeyboard
            key={editing}
            title={editing === 'username' ? 'Enter username' : 'Enter password'}
            mode={editing}
            value={editing === 'username' ? username : password}
            onChange={editing === 'username' ? setUsername : setPassword}
            onDone={closeKeyboard}
          />
          <KeyHint text="Back · Close keyboard" />
        </>
      )}
    </View>
  );

  return (
    <AuthFrame onBack={onBack} right={right}>
      <HeroTitle>Sign in to Jellyfin</HeroTitle>
      <View style={styles.server}>
        <ServerIdentity name={server.name} address={address} />
        <View style={styles.divider} />
        <AuthButton label="Change server" link disabled={busy} onPress={onChangeServer} />
      </View>

      <TextField
        key={`username-${epoch}`}
        label="Username"
        value={username.text}
        caret={username.caret}
        placeholder="Your Jellyfin username"
        editing={editing === 'username'}
        preferred={!editing && returnTo === 'username'}
        onPress={() => open('username')}
      />
      <TextField
        key={`password-${epoch}`}
        label="Password"
        value={password.text}
        caret={password.caret}
        placeholder="Password"
        masked={!showPassword}
        editing={editing === 'password'}
        preferred={!editing && returnTo === 'password'}
        onPress={() => open('password')}
        accessory={<ShowToggle shown={showPassword} onPress={() => setShowPassword(on => !on)} />}
      />

      <AuthButton
        label={busy ? 'Cancel' : 'Sign in'}
        icon={busy ? 'close' : 'play'}
        primary={!busy}
        disabled={!busy && !username.text}
        onPress={busy ? () => abortRef.current?.abort() : submit}
        style={authStyles.stackGap}
      />
      {quickConnect && <AuthButton label="Use Quick Connect" icon="link" disabled={busy} onPress={onQuickConnect} />}
      <View style={styles.footer}>
        {status ? <StatusLine status={status} /> : <Text style={authStyles.note}>Use your account on this Jellyfin server.</Text>}
      </View>
    </AuthFrame>
  );
}

/** Show or Hide, drawn inside the password field's right end; it has its own focus. */
function ShowToggle({ shown, onPress }: { shown: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={shown ? 'Hide password' : 'Show password'}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.toggle, focused && styles.toggleFocused]}>
      <Glyph name="eye" color={colors.text} size={36} />
      <Text style={styles.toggleLabel}>{shown ? 'Hide' : 'Show'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  right: { width: px(KEYBOARD_PANEL_WIDTH) },
  server: { flexDirection: 'row', alignItems: 'center', marginBottom: px(20) },
  divider: { width: px(2), height: px(56), backgroundColor: colors.surfaceFocused, marginHorizontal: px(20) },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: px(16),
    paddingVertical: px(6),
    borderRadius: px(10),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  toggleFocused: { borderColor: colors.focusRing },
  toggleLabel: { color: colors.text, fontSize: type.card, marginLeft: px(14) },
  footer: { marginTop: px(20) },
});
