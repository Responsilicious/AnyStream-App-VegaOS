import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { ViewAllTile } from '../components/ViewAll';
import { WideCard } from '../components/WideCard';
import { px, useScale } from '../layout';
import { describeError } from '../providers/jellyfin';
import type { KindFilter, MediaItem, MediaProvider } from '../providers/types';
import { GENRE_FILTERS } from '../search';
import { colors, type } from '../theme';
import { useRowScroll } from '../useRowScroll';
import { cardTitle, typeYearSubtitle } from '../util/format';

interface Props {
  provider: MediaProvider;
  /** Open a title page or series. */
  onOpen: (item: MediaItem) => void;
  /** Open the full list for a genre. */
  onGenre: (name: string) => void;
}

interface Reel {
  genre: string;
  items: MediaItem[];
}

/** Titles shown per reel before the View all tile: twice the first version, so a reel runs well past the screen. */
const REEL_SIZE = 24;

/** Every genre as a horizontal reel, with chips for which kinds of title to show (docs/design/genres-mockup.png). */
export function GenresScreen({ provider, onOpen, onGenre }: Props) {
  const s = useScale();
  const [filter, setFilter] = useState<KindFilter>('all');
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const topId = reels?.[0] ? `reel:${reels[0].genre}` : undefined;
  const lastReel = reels?.[reels.length - 1];
  const lastId = lastReel ? `reel:${lastReel.genre}` : undefined;
  const { scrollRef, onLayout, onScroll, measure, reset, ensureVisible } = useRowScroll(topId, lastId);

  useEffect(() => {
    let cancelled = false;
    setReels(null);
    setError(null);
    (async () => {
      try {
        const genres = await provider.getGenres();
        const loaded = await Promise.all(
          genres.map(async (genre): Promise<Reel> => {
            try {
              return { genre: genre.name, items: await provider.getByGenre(genre.name, filter, REEL_SIZE) };
            } catch {
              // One genre failing to load leaves the others on screen.
              return { genre: genre.name, items: [] };
            }
          }),
        );
        if (!cancelled) {
          reset();
          setReels(loaded.filter(reel => reel.items.length > 0));
        }
      } catch (e) {
        if (!cancelled) {
          setError(describeError(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, filter, attempt, reset]);

  const firstKey = useMemo(
    () => (reels?.[0]?.items[0] ? `${reels[0].genre}:${reels[0].items[0].id}` : undefined),
    [reels],
  );

  const margin = s(96);
  const gap = s(24);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingHorizontal: margin }]}>
        <Text style={styles.title}>Genres</Text>
        {/* Chips on their own row, left-aligned with the first card: the focus engine looks straight up from a
            card, and chips beside the title were not above it, so Up skipped them. */}
        <View style={styles.chips}>
          {GENRE_FILTERS.map(entry => (
            <FocusButton
              key={entry.filter}
              label={entry.label}
              primary={filter === entry.filter}
              onPress={() => setFilter(entry.filter)}
              style={styles.chip}
            />
          ))}
        </View>
      </View>

      {error && (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <FocusButton label="Try again" primary preferred onPress={() => setAttempt(n => n + 1)} style={styles.retry} />
        </View>
      )}

      {!error && reels === null && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}

      {!error && reels !== null && reels.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.empty}>No titles in any genre for this choice.</Text>
        </View>
      )}

      {!error && reels !== null && reels.length > 0 && (
        <ScrollView
          ref={scrollRef}
          onLayout={onLayout}
          onScroll={onScroll}
          scrollEventThrottle={16}
          // Room under the last reel, so it never sits flush with the bottom edge.
          contentContainerStyle={{ paddingBottom: s(120) }}>
          {reels.map(reel => {
            const id = `reel:${reel.genre}`;
            return (
              <View key={id} style={styles.reel} onLayout={measure(id)}>
                {/* No View all link up here: it sat between the cards and the chips, so Up landed on it and skipped the
                    chips. The View all tile at the end of the row does the same job. */}
                <View style={[styles.reelHeader, { paddingHorizontal: margin }]}>
                  <Text style={styles.heading} numberOfLines={1}>
                    {reel.genre}
                  </Text>
                </View>
                <FlatList
                  horizontal
                  data={reel.items}
                  keyExtractor={item => `${reel.genre}:${item.id}`}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: margin, paddingVertical: px(8) }}
                  ItemSeparatorComponent={() => <View style={{ width: gap }} />}
                  ListFooterComponent={
                    <View style={{ marginLeft: gap }}>
                      <ViewAllTile onFocus={() => ensureVisible(id)} onPress={() => onGenre(reel.genre)} />
                    </View>
                  }
                  renderItem={({ item }) => (
                    <WideCard
                      title={cardTitle(item)}
                      subtitle={typeYearSubtitle(item)}
                      imageUrl={item.landscapeUrl}
                      preferred={`${reel.genre}:${item.id}` === firstKey}
                      onFocus={() => ensureVisible(id)}
                      onPress={() => onOpen(item)}
                    />
                  )}
                />
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: px(4), paddingBottom: px(4) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  chips: { flexDirection: 'row', alignItems: 'center', marginTop: px(8) },
  chip: { marginRight: px(16), minHeight: px(52), paddingHorizontal: px(24) },
  reel: { marginTop: px(24) },
  reelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: px(10) },
  heading: { color: colors.text, fontSize: type.heading, fontWeight: '700', flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: px(96) },
  error: { color: colors.danger, fontSize: type.body, textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center' },
  retry: { marginTop: px(32) },
});
