import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTVEventHandler } from '../platform';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CardMenu } from '../components/CardMenu';
import { FeaturedPreview } from '../components/FeaturedPreview';
import { FocusButton } from '../components/FocusButton';
import { GenreCard } from '../components/GenreCard';
import { ViewAllTile } from '../components/ViewAll';
import { WideCard } from '../components/WideCard';
import {
  buildHome,
  continueKey,
  initialFeatured,
  isEmpty,
  type CardAction,
  type HomeData,
  type LibraryRow,
} from '../home';
import { px, useScale } from '../layout';
import { describeError } from '../providers/jellyfin';
import type { MediaItem, MediaProvider } from '../providers/types';
import type { HiddenContinueStore } from '../storage/hiddenStore';
import { colors, type } from '../theme';
import { useRowScroll } from '../useRowScroll';
import { cardTitle, continueCaption, continueSubtitle, recentSubtitle, upNextSubtitle } from '../util/format';

interface Props {
  provider: MediaProvider;
  /** Which card to focus on arrival, as "row:id". Lets Back from a title land where the user left. */
  initialFocusKey?: string;
  onFocusKey: (key: string) => void;
  onPlay: (item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
  onGenre: (name: string) => void;
  /** Titles the user removed from Continue Playing, kept on this device. */
  hidden: HiddenContinueStore;
  /** View all on Continue Playing. */
  onViewAllContinue: () => void;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error }),
  );
}

/** One Recently Added row per movie or TV library. A library whose lookup fails just has no row. */
async function loadRecentlyAdded(provider: MediaProvider): Promise<LibraryRow[]> {
  const libraries = await provider.getLibraries();
  const rows = await Promise.all(
    libraries.map(async (library): Promise<LibraryRow> => {
      const found = await settle(provider.getRecentlyAdded(library.id));
      return { library, items: found.ok ? found.value : [] };
    }),
  );
  return rows;
}

/** The first row that has anything in it, which sits right under the preview. */
function firstSectionId(home: HomeData): string | undefined {
  if (home.continuePlaying.length > 0 || home.continueMore.length > 0) {
    return 'continue';
  }
  if (home.upNext.length > 0) {
    return 'next';
  }
  if (home.recentlyAdded[0]) {
    return `recent:${home.recentlyAdded[0].library.id}`;
  }
  return home.genres.length > 0 ? 'genres' : undefined;
}

/** Every row that exists, top to bottom. */
function sectionIds(home: HomeData): string[] {
  const ids: string[] = [];
  if (home.continuePlaying.length > 0 || home.continueMore.length > 0) {
    ids.push('continue');
  }
  if (home.upNext.length > 0) {
    ids.push('next');
  }
  home.recentlyAdded.forEach(row => ids.push(`recent:${row.library.id}`));
  if (home.genres.length > 0) {
    ids.push('genres');
  }
  return ids;
}

/** The last row that exists, which sits at the very bottom. */
function lastSectionId(home: HomeData): string | undefined {
  if (home.genres.length > 0) {
    return 'genres';
  }
  const lastLibrary = home.recentlyAdded[home.recentlyAdded.length - 1];
  if (lastLibrary) {
    return `recent:${lastLibrary.library.id}`;
  }
  if (home.upNext.length > 0) {
    return 'next';
  }
  return home.continuePlaying.length > 0 || home.continueMore.length > 0 ? 'continue' : undefined;
}

/**
 * Home: the Featured preview for the focused title, then Continue Playing, Up Next, a Recently Added row
 * for each library and Browse by genre (docs/design.md section 2). One failing row leaves the others on
 * screen; the whole screen only shows an error when every row failed.
 */
export function HomeScreen({
  provider,
  initialFocusKey,
  onFocusKey,
  onPlay,
  onOpen,
  onGenre,
  hidden,
  onViewAllContinue,
}: Props) {
  const s = useScale();
  const [home, setHome] = useState<HomeData | null>(null);
  const [featured, setFeatured] = useState<MediaItem | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [menuItem, setMenuItem] = useState<MediaItem | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  // The first row that exists is the one under the preview: focusing it scrolls back to the top.
  const topSection = home ? firstSectionId(home) : undefined;
  const lastSection = home ? lastSectionId(home) : undefined;
  const { scrollRef, onLayout, onScroll, measure, reset, ensureVisible } = useRowScroll(topSection, lastSection);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      const [resume, next, latest, genres] = await Promise.all([
        settle(provider.getContinuePlaying()),
        settle(provider.getUpNext()),
        settle(loadRecentlyAdded(provider)),
        settle(provider.getGenres()),
      ]);
      if (cancelled) {
        return;
      }
      const all = [resume, next, latest, genres];
      const failed = all.find(r => !r.ok);
      if (failed && all.every(r => !r.ok)) {
        setError(describeError((failed as { error: unknown }).error));
        return;
      }
      const data = buildHome({
        resume: resume.ok ? resume.value : [],
        now: Date.now(),
        hidden: hidden.get(),
        upNext: next.ok ? next.value : [],
        recentlyAdded: latest.ok ? latest.value : [],
        genres: genres.ok ? genres.value : [],
      });
      reset();
      setHome(data);
      setFeatured(initialFeatured(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, attempt, reset, hidden]);

  // The row that holds focus, and the rows in order, so a Down press can bring the next row on screen first.
  const focusedSection = useRef<string | undefined>(undefined);
  const sectionOrder = useMemo(() => (home ? sectionIds(home) : []), [home]);

  useTVEventHandler(event => {
    if (event.eventType !== 'down' || event.eventKeyAction === 1) {
      return;
    }
    const index = focusedSection.current ? sectionOrder.indexOf(focusedSection.current) : -1;
    const next = index >= 0 ? sectionOrder[index + 1] : undefined;
    if (next) {
      ensureVisible(next);
    }
  });

  const focusCard = useCallback(
    (sectionId: string, key: string, item?: MediaItem) => {
      focusedSection.current = sectionId;
      onFocusKey(key);
      if (item) {
        setFeatured(item);
      }
      ensureVisible(sectionId);
    },
    [onFocusKey, ensureVisible],
  );

  const closeMenu = useCallback(() => {
    setMenuItem(null);
    setMenuError(null);
  }, []);

  const runAction = useCallback(
    async (item: MediaItem, action: CardAction) => {
      if (action === 'details') {
        closeMenu();
        onOpen(item);
      } else if (action === 'resume') {
        closeMenu();
        onPlay(item);
      } else if (action === 'play-from-start') {
        closeMenu();
        onPlay({ ...item, resumeMs: 0 });
      } else if (action === 'remove-from-row') {
        // Local only: the resume point stays on the server and the title returns when it is played again.
        hidden.hide(continueKey(item), item.lastPlayed ?? Date.now());
        closeMenu();
        setHome(null);
        setAttempt(n => n + 1);
      } else {
        setMenuBusy(true);
        setMenuError(null);
        try {
          await provider.markPlayed(item.id);
          closeMenu();
          // Reload so the title leaves Continue Playing and Up Next moves on.
          setHome(null);
          setAttempt(n => n + 1);
        } catch (e) {
          setMenuError(describeError(e));
        } finally {
          setMenuBusy(false);
        }
      }
    },
    [closeMenu, hidden, onOpen, onPlay, provider],
  );

  // With nothing remembered, focus the first card of the first row that has one.
  const firstKey = useMemo(() => {
    if (!home) {
      return undefined;
    }
    if (home.continuePlaying[0]) {
      return `continue:${home.continuePlaying[0].id}`;
    }
    if (home.upNext[0]) {
      return `next:${home.upNext[0].id}`;
    }
    if (home.recentlyAdded[0]) {
      return `recent:${home.recentlyAdded[0].library.id}:${home.recentlyAdded[0].items[0].id}`;
    }
    return home.genres[0] ? `genre:${home.genres[0].name}` : undefined;
  }, [home]);
  const preferredKey = initialFocusKey ?? firstKey;

  if (menuItem) {
    return (
      <CardMenu
        item={menuItem}
        inContinueRow={!!home?.continuePlaying.some(c => c.id === menuItem.id)}
        busy={menuBusy}
        error={menuError}
        onAction={action => void runAction(menuItem, action)}
        onClose={closeMenu}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <FocusButton label="Try again" primary preferred onPress={() => setAttempt(n => n + 1)} style={styles.retry} />
      </View>
    );
  }

  if (!home) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (isEmpty(home)) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Nothing to show yet. Add something to your library, or open Movies or Series.</Text>
      </View>
    );
  }

  const margin = s(96);
  const gap = s(24);
  const genreWidth = s(414);
  // Taller than the mockup's 112 so a two-line genre name fits with room to spare.
  const genreHeight = s(150);

  const renderWideRow = (
    sectionId: string,
    heading: string,
    keyPrefix: string,
    items: MediaItem[],
    subtitle: (item: MediaItem) => string,
    onSelect: (item: MediaItem) => void,
    showProgress: boolean,
    options: { caption?: (item: MediaItem) => string; onViewAll?: () => void } = {},
  ) =>
    items.length === 0 && !options.onViewAll ? null : (
      <View key={sectionId} style={styles.section} onLayout={measure(sectionId)}>
        <View style={[styles.headingRow, { paddingHorizontal: margin }]}>
          <Text style={styles.headingText} numberOfLines={1}>
            {heading}
          </Text>
        </View>
        <FlatList
          horizontal
          data={items}
          keyExtractor={item => `${keyPrefix}:${item.id}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: margin, paddingVertical: px(8) }}
          ItemSeparatorComponent={() => <View style={{ width: gap }} />}
          ListFooterComponent={
            options.onViewAll ? (
              <View style={{ marginLeft: items.length > 0 ? gap : 0 }}>
                <ViewAllTile onFocus={() => ensureVisible(sectionId)} onPress={options.onViewAll} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const key = `${keyPrefix}:${item.id}`;
            return (
              <WideCard
                title={cardTitle(item)}
                subtitle={subtitle(item)}
                caption={options.caption?.(item)}
                imageUrl={item.landscapeUrl}
                progress={showProgress && item.runtimeMs ? item.resumeMs / item.runtimeMs : 0}
                preferred={key === preferredKey}
                onFocus={() => focusCard(sectionId, key, item)}
                onPress={() => onSelect(item)}
                onLongPress={() => setMenuItem(item)}
              />
            );
          }}
        />
      </View>
    );

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      // Room under the last row, so it is never flush with the bottom edge of the screen.
      contentContainerStyle={{ paddingBottom: s(120) }}
      onLayout={onLayout}
      onScroll={onScroll}
      scrollEventThrottle={16}>
      <FeaturedPreview
        item={featured}
        onPlay={onPlay}
        onDetails={onOpen}
        onMore={setMenuItem}
      />

      {renderWideRow('continue', 'Continue Playing', 'continue', home.continuePlaying, continueSubtitle, onOpen, true, {
        caption: continueCaption,
        onViewAll: home.continueMore.length > 0 ? onViewAllContinue : undefined,
      })}
      {renderWideRow('next', 'Up Next', 'next', home.upNext, upNextSubtitle, onOpen, false)}
      {home.recentlyAdded.map(row =>
        renderWideRow(
          `recent:${row.library.id}`,
          `Recently Added in ${row.library.name}`,
          `recent:${row.library.id}`,
          row.items,
          recentSubtitle,
          onOpen,
          false,
        ),
      )}

      {home.genres.length > 0 && (
        <View style={styles.section} onLayout={measure('genres')}>
          <Text style={[styles.heading, { paddingHorizontal: margin }]}>Browse by genre</Text>
          <FlatList
            horizontal
            data={home.genres}
            keyExtractor={genre => `genre:${genre.name}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: margin, paddingVertical: px(8) }}
            ItemSeparatorComponent={() => <View style={{ width: gap }} />}
            renderItem={({ item: genre }) => {
              const key = `genre:${genre.name}`;
              return (
                <GenreCard
                  name={genre.name}
                  imageUrl={genre.imageUrl}
                  width={genreWidth}
                  height={genreHeight}
                  preferred={key === preferredKey}
                  onFocus={() => focusCard('genres', key)}
                  onPress={() => {
                    onFocusKey(key);
                    onGenre(genre.name);
                  }}
                />
              );
            }}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  section: { marginTop: px(36) },
  heading: { color: colors.text, fontSize: type.heading, fontWeight: '700', marginBottom: px(14) },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: px(14) },
  headingText: { color: colors.text, fontSize: type.heading, fontWeight: '700', flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: px(96) },
  error: { color: colors.danger, fontSize: type.body, textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center' },
  retry: { marginTop: px(32) },
});
