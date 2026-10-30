import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { PosterCard } from '../components/PosterCard';
import { px } from '../layout';
import { describeError } from '../providers/jellyfin';
import type { Library, MediaItem, MediaProvider } from '../providers/types';
import { colors, spacing, type } from '../theme';

interface Props {
  provider: MediaProvider;
  /** A poster was chosen: the app decides whether that opens a title page or a series. */
  onOpen: (item: MediaItem) => void;
  /** Only show libraries of this kind (the Movies and Series sections). All when omitted (Home for now). */
  kind?: Library['kind'];
  /** Only titles in this genre. */
  genre?: string;
  /** Newest added first rather than A to Z. */
  sort?: 'name' | 'recent';
}

const COLUMNS = 6;

/**
 * Browse screen: libraries across the top, a poster grid below. Deliberately plain; the Netflix-style
 * home (hero, rows, genre menu) is M3. Choosing a poster opens its title or series page.
 */
export function LibraryScreen({ provider, onOpen, kind, genre, sort }: Props) {
  const { width } = useWindowDimensions();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selected, setSelected] = useState<Library | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLibraries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const found = (await provider.getLibraries()).filter(l => !kind || l.kind === kind);
      setLibraries(found);
      setSelected(found[0] ?? null);
      if (found.length === 0) {
        setLoading(false);
      }
    } catch (e) {
      setError(describeError(e));
      setLoading(false);
    }
  }, [provider, kind]);

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    provider
      .getItems({ parentId: selected.id, limit: 60, genres: genre ? [genre] : undefined, sort })
      .then(page => {
        if (!cancelled) {
          setItems(page.items);
          setLoading(false);
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(describeError(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, selected, genre, sort]);

  const gridWidth = width - spacing.safeMargin * 2;
  const tileWidth = Math.floor((gridWidth - COLUMNS * px(16)) / COLUMNS) - px(8);

  return (
    <View style={styles.screen}>
      {libraries.length > 1 && (
        <View style={styles.tabs}>
          {libraries.map(library => (
            <FocusButton
              key={library.id}
              label={library.name}
              primary={selected?.id === library.id}
              onPress={() => setSelected(library)}
              style={styles.tab}
            />
          ))}
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <FocusButton label="Try again" primary preferred onPress={loadLibraries} style={styles.retry} />
        </View>
      )}

      {!error && loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}

      {!error && !loading && items.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.empty}>
            {libraries.length === 0 ? 'No movie or TV libraries found on this server.' : 'This library is empty.'}
          </Text>
        </View>
      )}

      {!error && !loading && items.length > 0 && (
        <FlatList
          data={items}
          key={`grid-${COLUMNS}`}
          numColumns={COLUMNS}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => (
            <PosterCard item={item} width={tileWidth} onPress={onOpen} preferred={index === 0} />
          )}
          contentContainerStyle={styles.grid}
          initialNumToRender={COLUMNS * 3}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.safeMargin, paddingTop: spacing.gap },
  tabs: { flexDirection: 'row', marginBottom: spacing.gapLarge },
  tab: { marginRight: spacing.gap },
  grid: { paddingTop: px(8), paddingBottom: spacing.safeMargin },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: type.body, textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center' },
  retry: { marginTop: spacing.gapLarge },
});
