import { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import type { Section } from '../navigation';
import type { MediaItem, MediaProvider } from '../providers/types';
import type { HiddenContinueStore } from '../storage/hiddenStore';
import { colors, spacing, type } from '../theme';
import { GenresScreen } from './GenresScreen';
import { HomeScreen } from './HomeScreen';
import { LibraryScreen } from './LibraryScreen';
import { SearchScreen } from './SearchScreen';

interface Props {
  provider: MediaProvider;
  section: Section;
  onSection: (section: Section) => void;
  /** A title was chosen to look at (its page, or its series). */
  onOpen: (item: MediaItem) => void;
  /** A card whose whole point is to play (Continue Playing, Up Next, the preview's Play button). */
  onPlay: (item: MediaItem) => void;
  onGenre: (name: string) => void;
  onSignOut: () => void;
  /** Titles removed from Continue Playing, and the screen that lists them all. */
  hidden: HiddenContinueStore;
  onViewAllContinue: () => void;
  /** Which Home card to focus on arrival, and how to report the one focused now. */
  homeFocusKey?: string;
  onHomeFocus: (key: string) => void;
  /** The active server's name for the header pill, and what the pill opens (the quick switcher). */
  serverName?: string;
  onServer?: () => void;
  serverPreferred?: boolean;
  /** Who's watching? for servers with profiles (Plex Home). Left out, the profile page has no switch. */
  onSwitchProfile?: () => void;
}

/** The top-level shell: the top bar, and whichever section is chosen beneath it. */
export function MainScreen({
  provider,
  section,
  onSection,
  onOpen,
  onPlay,
  onGenre,
  onSignOut,
  hidden,
  onViewAllContinue,
  homeFocusKey,
  onHomeFocus,
  serverName,
  onServer,
  serverPreferred,
  onSwitchProfile,
}: Props) {
  // Back from any section other than Home returns to Home. On Home we do not claim the key,
  // so the platform takes the user out of the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (section === 'home') {
        return false;
      }
      onSection('home');
      return true;
    });
    return () => subscription.remove();
  }, [section, onSection]);

  const { server, userName } = provider.session;
  // Every section except the profile page puts focus on something of its own (a card, a key).
  const hasContent = section !== 'profile';

  return (
    <View style={styles.screen}>
      <TopBar
        active={section}
        profileName={userName}
        onSelect={onSection}
        preferred={!hasContent && !serverPreferred}
        serverName={serverName}
        onServer={onServer}
        serverPreferred={serverPreferred}
      />
      {section === 'home' && (
        <HomeScreen
          provider={provider}
          initialFocusKey={homeFocusKey}
          onFocusKey={onHomeFocus}
          onPlay={onPlay}
          onOpen={onOpen}
          onGenre={onGenre}
          hidden={hidden}
          onViewAllContinue={onViewAllContinue}
        />
      )}
      {section === 'movies' && <LibraryScreen provider={provider} onOpen={onOpen} kind="movies" />}
      {section === 'series' && <LibraryScreen provider={provider} onOpen={onOpen} kind="tvshows" />}
      {section === 'genres' && <GenresScreen provider={provider} onOpen={onOpen} onGenre={onGenre} />}
      {section === 'search' && <SearchScreen provider={provider} onOpen={onOpen} />}
      {section === 'profile' && (
        <View style={styles.center}>
          <Text style={styles.heading}>{userName}</Text>
          <Text style={styles.empty}>{server.name}</Text>
          {onSwitchProfile ? <FocusButton label="Switch profile" primary preferred onPress={onSwitchProfile} style={styles.signOut} /> : null}
          <FocusButton label="Sign out" onPress={onSignOut} style={styles.signOut} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { color: colors.text, fontSize: type.title, fontWeight: '800' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center', marginTop: spacing.gap },
  signOut: { marginTop: spacing.gapLarge },
});
