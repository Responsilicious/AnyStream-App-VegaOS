import { useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { announce } from '../a11y';
import type { ConnectStatus } from '../connect';
import { px } from '../layout';
import { colors, focus, type } from '../theme';
import { Glyph } from './Glyph';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('../assets/logo.png');
/** The logo file is 3:1 with some clear margin around the mark and wordmark. */
const LOGO_ASPECT = 3;

/** Safe area for the entry screens: 96 px at the sides, 54 px top and bottom (docs/design.md section 2). */
const SAFE_X = 96;
const SAFE_Y = 54;

interface FrameProps {
  children: ReactNode;
  /** The right-hand column: the keyboard panel, Quick Connect steps, or the Welcome artwork. */
  right?: ReactNode;
  /** Shows the Back link; the remote's Back key does the same. */
  onBack?: () => void;
  /** Welcome has Back at the bottom; the other screens have it under the logo (docs/design/*-mockup.png). */
  backAtBottom?: boolean;
  /** Back link gets initial focus (nothing else on the screen should). */
  backPreferred?: boolean;
}

/**
 * The frame every entry screen shares: the AnyStream logo top left inside the TV safe area, a Back link, the
 * screen's own column, and an optional right-hand column. No library navigation until signed in.
 */
export function AuthFrame({ children, right, onBack, backAtBottom, backPreferred }: FrameProps) {
  const back = onBack ? <BackLink onPress={onBack} preferred={backPreferred} /> : null;
  return (
    <View style={styles.screen}>
      <View style={styles.left}>
        <Image source={LOGO} accessibilityLabel="AnyStream" style={styles.logo} resizeMode="contain" />
        {!backAtBottom && <View style={styles.backTop}>{back}</View>}
        <View style={styles.body}>{children}</View>
        {backAtBottom && back}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

/** The large screen heading from the mockups. */
export function HeroTitle({ children }: { children: string }) {
  return (
    <Text style={styles.hero} accessibilityRole="header">
      {children}
    </Text>
  );
}

function BackLink({ onPress, preferred }: { onPress: () => void; preferred?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel="Back"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.back, focused && styles.backFocused]}>
      <Glyph name="back" color={colors.text} size={44} />
      <Text style={styles.backLabel}>Back</Text>
    </Pressable>
  );
}

/** The server's icon, name and address, so the person always knows where they are signing in. */
export function ServerIdentity({ name, address, large }: { name: string; address: string; large?: boolean }) {
  return (
    <View style={styles.identity} accessible accessibilityLabel={`Server ${name}, ${address}`}>
      <Glyph name="server" color={colors.text} size={large ? 64 : 54} />
      <View style={styles.identityText}>
        <Text style={[styles.identityName, large && styles.identityNameLarge]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.identityAddress} numberOfLines={1}>
          {address}
        </Text>
      </View>
    </View>
  );
}

/** "Back · Close keyboard" and similar hints at the bottom right of a column. */
export function KeyHint({ text }: { text: string }) {
  return (
    <View style={styles.hint}>
      <Glyph name="back" color={colors.textMuted} size={40} />
      <Text style={styles.hintText}>{text}</Text>
    </View>
  );
}

const DOT_COLOR: Record<ConnectStatus['tone'], string> = {
  busy: colors.accent,
  success: colors.accent,
  info: colors.surfaceFocused,
  error: colors.danger,
};

/**
 * A connection or sign-in state with a status dot (docs/design/connect-mockup.png), read out by screen
 * readers when it changes. A dot rather than a spinner, so nothing moves for reduced-motion users.
 */
export function StatusLine({ status }: { status: ConnectStatus | null }) {
  const spoken = status ? [status.title, status.detail].filter(Boolean).join('. ') : '';
  useEffect(() => {
    if (spoken) {
      announce(spoken);
    }
  }, [spoken]);
  if (!status) {
    return <View style={styles.statusEmpty} />;
  }
  const color = status.tone === 'error' ? colors.danger : status.tone === 'info' ? colors.textMuted : colors.text;
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: DOT_COLOR[status.tone] }]} />
      <View style={styles.statusText}>
        <Text style={[styles.statusTitle, { color }]}>{status.title}</Text>
        {status.detail ? <Text style={styles.statusDetail}>{status.detail}</Text> : null}
      </View>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  lead: { color: colors.textMuted, fontSize: type.card, marginBottom: px(28) },
  label: { color: colors.textMuted, fontSize: type.card, fontWeight: '700', marginBottom: px(10) },
  note: { color: colors.textMuted, fontSize: type.body, marginTop: px(8) },
  stack: { alignSelf: 'stretch' },
  stackGap: { marginBottom: px(18) },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
    paddingHorizontal: px(SAFE_X),
    paddingTop: px(SAFE_Y),
    paddingBottom: px(SAFE_Y),
  },
  left: { flex: 1, paddingRight: px(40) },
  right: { justifyContent: 'center' },
  logo: { height: px(80), width: px(80 * LOGO_ASPECT), marginLeft: -px(12) },
  backTop: { minHeight: px(64), marginTop: px(12), alignItems: 'flex-start' },
  body: { flex: 1, justifyContent: 'center' },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: px(6),
    paddingLeft: px(6),
    paddingRight: px(20),
    borderRadius: px(40),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  backFocused: { borderColor: colors.focusRing },
  backLabel: { color: colors.text, fontSize: type.card, marginLeft: px(16) },
  hero: { color: colors.text, fontSize: px(84), lineHeight: px(94), fontWeight: '800', marginBottom: px(16) },
  identity: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  identityText: { marginLeft: px(24), flexShrink: 1 },
  identityName: { color: colors.text, fontSize: type.card, fontWeight: '700' },
  identityNameLarge: { fontSize: type.heading },
  identityAddress: { color: colors.textMuted, fontSize: type.body, marginTop: px(2) },
  hint: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: px(20) },
  hintText: { color: colors.textMuted, fontSize: type.body, marginLeft: px(16) },
  statusEmpty: { minHeight: px(56) },
  status: { flexDirection: 'row', alignItems: 'flex-start', minHeight: px(56) },
  dot: { width: px(22), height: px(22), borderRadius: px(11), marginTop: px(6), marginRight: px(24) },
  statusText: { flex: 1 },
  statusTitle: { fontSize: type.card, fontWeight: '600' },
  statusDetail: { color: colors.textMuted, fontSize: type.body, marginTop: px(4) },
});
