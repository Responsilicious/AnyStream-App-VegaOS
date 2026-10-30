import { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { px, useScale } from '../layout';
import type { MediaItem, MediaProvider } from '../providers/types';
import { colors, type } from '../theme';
import { LibraryScreen } from './LibraryScreen';

interface Props {
  provider: MediaProvider;
  genre: string;
  onOpen: (item: MediaItem) => void;
  onBack: () => void;
}

/** The titles in one genre, as a poster grid under a heading. */
export function GenreScreen({ provider, genre, onOpen, onBack }: Props) {
  const s = useScale();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingHorizontal: s(96) }]}>
        <Text style={styles.title} numberOfLines={1}>
          {genre}
        </Text>
        <FocusButton label="Back" onPress={onBack} />
      </View>
      <LibraryScreen provider={provider} onOpen={onOpen} genre={genre} sort="recent" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: px(32) },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: type.title, fontWeight: '800', flex: 1, marginRight: px(24) },
});
