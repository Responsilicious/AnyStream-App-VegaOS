import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import type { Section } from '../navigation';
import { colors, focus, type } from '../theme';
import { Glyph } from './Glyph';

interface Props {
  active: Section;
  /** The signed-in user; its first letter is the avatar. */
  profileName: string;
  onSelect: (section: Section) => void;
  /** Takes initial focus when the screen below has nothing focusable yet. */
  preferred?: boolean;
  /** The active server, shown as a pill that opens the server switcher. */
  serverName?: string;
  onServer?: () => void;
  /** Gives the server pill focus, e.g. when the switcher closes. */
  serverPreferred?: boolean;
  /** A panel is open below (the library filter drawer): nothing here may take focus. */
  inert?: boolean;
}

const ITEMS: Array<{ section: 'home' | 'movies' | 'series' | 'genres'; label: string }> = [
  { section: 'home', label: 'Home' },
  { section: 'movies', label: 'Movies' },
  { section: 'series', label: 'Series' },
  { section: 'genres', label: 'Genres' },
];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('../assets/logo.png');
/** The logo file is 3:1 with some clear margin around the mark and wordmark. */
const LOGO_ASPECT = 3;

/** Logo, then Home, Movies, Series and Genres; Search and the profile avatar sit at the right (docs/design/home-mockup.png). */
export function TopBar({ active, profileName, onSelect, preferred, serverName, onServer, serverPreferred, inert }: Props) {
  const s = useScale();
  const initial = (profileName.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={[styles.bar, { paddingHorizontal: s(96), paddingVertical: s(12) }]}>
      <View style={styles.left}>
        <Image
          source={LOGO}
          accessibilityLabel="AnyStream"
          style={{ height: s(64), width: s(64) * LOGO_ASPECT, marginRight: s(16) }}
          resizeMode="contain"
        />
        {ITEMS.map(entry => (
          <TopBarItem
            key={entry.section}
            label={entry.label}
            selected={active === entry.section}
            preferred={preferred && active === entry.section}
            inert={inert}
            onPress={() => onSelect(entry.section)}
          />
        ))}
      </View>
      <View style={styles.right}>
        {serverName && onServer ? <ServerPill name={serverName} preferred={serverPreferred} inert={inert} onPress={onServer} /> : null}
        <IconItem label="Search" selected={active === 'search'} preferred={preferred && active === 'search'} inert={inert} onPress={() => onSelect('search')}>
          <SearchGlyph />
        </IconItem>
        <IconItem label={profileName} selected={active === 'profile'} preferred={preferred && active === 'profile'} inert={inert} onPress={() => onSelect('profile')}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </IconItem>
      </View>
    </View>
  );
}

function TopBarItem({
  label,
  selected,
  preferred,
  inert,
  onPress,
}: {
  label: string;
  selected: boolean;
  preferred?: boolean;
  inert?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!inert}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.item, focused && styles.itemFocused]}>
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.underline, selected && styles.underlineSelected]} />
    </Pressable>
  );
}

function IconItem({
  label,
  selected,
  preferred,
  inert,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  preferred?: boolean;
  inert?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!inert}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.iconItem, focused && styles.itemFocused, selected && !focused && styles.iconSelected]}>
      {children}
    </Pressable>
  );
}

/** The active server's name; Select opens the quick switcher. Always says which library is showing. */
function ServerPill({ name, preferred, inert, onPress }: { name: string; preferred?: boolean; inert?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!inert}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={`Server: ${name}. Switch server`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.pill, focused && styles.itemFocused]}>
      <Glyph name="server" color={colors.text} size={36} />
      <Text style={styles.pillText} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.pillCaret} />
    </Pressable>
  );
}

/** A magnifying glass drawn from two views, so there is no icon font or image to load. */
function SearchGlyph() {
  return (
    <View style={styles.glyph}>
      <View style={styles.glyphLens} />
      <View style={styles.glyphHandle} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.background },
  left: { flexDirection: 'row', alignItems: 'center' },
  right: { flexDirection: 'row', alignItems: 'center' },
  item: {
    paddingHorizontal: px(20),
    paddingTop: px(10),
    paddingBottom: px(6),
    marginRight: px(8),
    borderRadius: px(10),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  itemFocused: { borderColor: colors.focusRing, backgroundColor: colors.surface },
  label: { color: colors.textMuted, fontSize: type.card, fontWeight: '600' },
  labelSelected: { color: colors.text },
  underline: { height: px(4), marginTop: px(6), borderRadius: px(2), backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.accent },
  iconItem: {
    width: px(64),
    height: px(64),
    marginLeft: px(12),
    borderRadius: px(32),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSelected: { backgroundColor: colors.surface },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: px(420),
    height: px(64),
    paddingHorizontal: px(24),
    marginRight: px(8),
    borderRadius: px(32),
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
  },
  pillText: { color: colors.text, fontSize: type.body, fontWeight: '600', flexShrink: 1, marginLeft: px(14) },
  // A small down-pointing triangle: the pill opens a list.
  pillCaret: {
    marginLeft: px(14),
    width: 0,
    height: 0,
    borderLeftWidth: px(9),
    borderRightWidth: px(9),
    borderTopWidth: px(10),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.text,
  },
  glyph: { width: px(28), height: px(28) },
  glyphLens: { width: px(20), height: px(20), borderRadius: px(10), borderWidth: 3, borderColor: colors.text },
  glyphHandle: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: px(10),
    height: px(3),
    borderRadius: px(2),
    backgroundColor: colors.text,
    transform: [{ rotate: '45deg' }],
  },
  avatar: { width: px(44), height: px(44), borderRadius: px(22), backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: type.card, fontWeight: '800' },
});
