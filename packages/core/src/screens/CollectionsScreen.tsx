import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CollectionCard } from '../components/CollectionCard';
import { FocusButton } from '../components/FocusButton';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { SortPanel } from '../components/SortPanel';
import { TextField } from '../components/TextField';
import type { TextEdit } from '../keyboard';
import { px } from '../layout';
import { BrowseController, type BrowseState } from '../library/browseController';
import {
  COLLECTION_LIST_SORTS,
  collectionSortLabel,
  listQueryKey,
  type CollectionPrefsStore,
  type CollectionScope,
} from '../library/collections';
import { describeError } from '../providers/jellyfin';
import type { CollectionListQuery, CollectionListSort, CollectionsSource, MediaItem, MediaProvider } from '../providers/types';
import { colors, spacing, type } from '../theme';
import { useBack } from '../useBack';

/** What the page keeps while a collection is open, so Back restores the list, search, sort and focused card. */
export interface CollectionsMemory {
  scope: string;
  state: BrowseState<MediaItem, CollectionListQuery>;
  focusedId?: string;
}

interface Props {
  provider: MediaProvider;
  source: CollectionsSource;
  prefs: CollectionPrefsStore;
  onOpen: (item: MediaItem) => void;
  /** Kept by the app across collection and title pages; cleared when the server or profile changes. */
  memory: { current: CollectionsMemory | undefined };
  /** A panel opened or closed: the header must not take focus while it is open. */
  onOverlay: (open: boolean) => void;
}

const COLUMNS = 6;
const PAGE_SIZE = 60;
/** Typing waits this long before asking the server, so each key press is not a request. */
const SEARCH_DEBOUNCE_MS = 400;

type Phase = { name: 'loading' } | { name: 'error'; message: string } | { name: 'ready' };

function scopeOf(provider: MediaProvider): CollectionScope {
  return { provider: provider.kind, serverId: provider.session.server.id, userId: provider.session.userId };
}

function scopeString(scope: CollectionScope): string {
  return `${scope.provider}/${scope.serverId}/${scope.userId}`;
}

/**
 * The Collections page (docs/collections.md): the collections this viewer can see on the active server, as a poster
 * grid with its own search and sort. Collections are made and edited on the server; this page only browses them.
 */
export function CollectionsScreen({ provider, source, prefs, onOpen, memory, onOverlay }: Props) {
  const { width } = useWindowDimensions();
  const scope = scopeOf(provider);
  const scopeKey = scopeString(scope);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [results, setResults] = useState<BrowseState<MediaItem, CollectionListQuery> | null>(null);
  const [search, setSearch] = useState<TextEdit>(() => {
    const kept = memory.current?.scope === scopeKey ? memory.current.state.applied.search ?? '' : '';
    return { text: kept, caret: kept.length };
  });
  const [keyboard, setKeyboard] = useState(false);
  const [sortPanel, setSortPanel] = useState<{ pending: boolean; error: string | null } | null>(null);
  const [toolbarFocus, setToolbarFocus] = useState<'search' | 'sort' | 'clear' | undefined>(undefined);
  const [gridFocusId, setGridFocusId] = useState<string | undefined>(undefined);
  const [searchError, setSearchError] = useState<string | null>(null);
  const focusedId = useRef<string | undefined>(undefined);
  const controllerRef = useRef<BrowseController<MediaItem, CollectionListQuery> | null>(null);
  const [attempt, setAttempt] = useState(0);

  // One controller per server and viewer. Late answers for an older search or sort are dropped by the controller.
  useEffect(() => {
    const controller = new BrowseController<MediaItem, CollectionListQuery>(
      { query: (q, start, limit, signal) => source.list(q, start, limit, signal) },
      { pageSize: PAGE_SIZE, keyOf: listQueryKey, onCommit: q => prefs.saveListSort(scope, q.sort) },
      { sort: prefs.listSort(scope) },
    );
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setResults);
    const kept = memory.current;
    if (kept && kept.scope === scopeKey && kept.state.loaded) {
      // Back from a collection: the same list, scrolled to and focused on the card that was chosen.
      controller.restore(kept.state);
      setGridFocusId(kept.focusedId);
      focusedId.current = kept.focusedId;
      setPhase({ name: 'ready' });
    } else {
      setPhase({ name: 'loading' });
      setGridFocusId(undefined);
      focusedId.current = undefined;
      // The saved sort is in the very first request, so the list never loads twice.
      const first: CollectionListQuery = { sort: prefs.listSort(scope), search: search.text.trim() || undefined };
      void controller.apply(first).then(result => {
        if (result.outcome === 'applied') {
          setPhase({ name: 'ready' });
          setToolbarFocus('search');
        } else if (result.outcome === 'failed') {
          setPhase({ name: 'error', message: describeError(result.error) });
        }
      });
    }
    return () => {
      if (memory.current?.scope === scopeKey) {
        memory.current = { ...memory.current, focusedId: focusedId.current };
      }
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
    };
    // Rebuilt only for another server or viewer, or Try again. Search and sort go through the same controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, scopeKey, attempt]);

  // Keep the record current, so leaving for a collection can restore it.
  useEffect(() => {
    if (results?.loaded) {
      memory.current = { scope: scopeKey, state: results, focusedId: focusedId.current };
    }
  }, [results, scopeKey, memory]);

  const overlay = keyboard || sortPanel !== null;
  useEffect(() => {
    onOverlay(overlay);
  }, [overlay, onOverlay]);
  useEffect(() => () => onOverlay(false), [onOverlay]);

  // Typing searches after a pause. Sort is kept: clearing or changing the search never resets it.
  const typed = search.text.trim();
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !results?.loaded) {
      return undefined;
    }
    if ((results.applied.search ?? '') === typed) {
      return undefined;
    }
    const timer = setTimeout(() => {
      void controller.apply({ sort: results.applied.sort, search: typed || undefined }).then(result => {
        if (result.outcome === 'failed') {
          setSearchError(`Couldn't search collections. ${describeError(result.error)}`);
        } else if (result.outcome === 'applied') {
          setSearchError(null);
          setGridFocusId(undefined);
          focusedId.current = undefined;
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // results.applied changes identity with every page; the search text is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, results?.loaded]);

  const chooseSort = async (sort: CollectionListSort) => {
    const controller = controllerRef.current;
    if (!controller || !results) {
      return;
    }
    if (sort === results.applied.sort) {
      setSortPanel(null);
      setToolbarFocus('sort');
      return;
    }
    setSortPanel({ pending: true, error: null });
    const result = await controller.apply({ ...results.applied, sort });
    if (result.outcome === 'applied') {
      setSortPanel(null);
      setGridFocusId(undefined);
      focusedId.current = undefined;
      setToolbarFocus('sort');
    } else if (result.outcome === 'failed') {
      setSortPanel({ pending: false, error: `Couldn't load that order. ${describeError(result.error)}` });
    }
  };

  const closeSort = () => {
    controllerRef.current?.cancelApply();
    setSortPanel(null);
    setToolbarFocus('sort');
  };

  const clearSearch = () => {
    setSearch({ text: '', caret: 0 });
    setToolbarFocus('search');
  };

  const gridWidth = width - spacing.safeMargin * 2;
  const tileWidth = Math.floor((gridWidth - COLUMNS * px(16)) / COLUMNS) - px(16);
  const items = results?.items ?? [];
  const applied = results?.applied ?? { sort: prefs.listSort(scope) };
  const focusIndex = gridFocusId ? items.findIndex(i => i.id === gridFocusId) : -1;
  const searching = !!applied.search;

  const header = (
    <View style={styles.titleRow}>
      <Text style={styles.title} accessibilityRole="header">
        Collections
      </Text>
      {results?.total != null && phase.name === 'ready' ? (
        <Text style={styles.count}>{results.total === 1 ? '1 collection' : `${results.total} collections`}</Text>
      ) : null}
    </View>
  );

  if (phase.name !== 'ready' || !results) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.center}>
          {phase.name === 'error' ? (
            <>
              <Text style={styles.error}>{phase.message}</Text>
              <FocusButton label="Try again" primary preferred onPress={() => setAttempt(n => n + 1)} style={styles.retry} />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} size="large" />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <View style={styles.toolbar}>
        <View style={styles.searchField}>
          <TextField
            label="Search collections"
            value={search.text}
            caret={search.caret}
            placeholder="Type a name"
            editing={keyboard}
            preferred={focusIndex < 0 && toolbarFocus === 'search' && !overlay}
            onPress={() => {
              setToolbarFocus(undefined);
              setKeyboard(true);
            }}
          />
        </View>
        <FocusButton
          label={`Sort: ${collectionSortLabel(applied.sort)}`}
          preferred={focusIndex < 0 && toolbarFocus === 'sort' && !overlay}
          disabled={overlay}
          onPress={() => {
            setToolbarFocus(undefined);
            setSortPanel({ pending: false, error: null });
          }}
          style={styles.toolButton}
        />
        {search.text.length > 0 ? (
          <FocusButton label="Clear search" disabled={overlay} onPress={clearSearch} style={styles.toolButton} />
        ) : null}
      </View>
      {searchError ? <Text style={styles.error}>{searchError}</Text> : null}

      {items.length === 0 ? (
        <View style={styles.center}>
          {searching ? (
            <>
              <Text style={styles.emptyTitle}>No collections match “{applied.search}”</Text>
              <FocusButton label="Clear search" primary disabled={overlay} onPress={clearSearch} style={styles.retry} />
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>No collections yet</Text>
              <Text style={styles.empty}>
                Collections are made and managed on your Jellyfin server. Any you can see there will appear here.
              </Text>
              <FocusButton label="Refresh" primary disabled={overlay} onPress={() => setAttempt(n => n + 1)} style={styles.retry} />
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          key={`grid-${COLUMNS}`}
          numColumns={COLUMNS}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <CollectionCard
                title={item.title}
                imageUrl={item.posterUrl}
                width={tileWidth}
                spokenLabel={`${item.title}, collection`}
                focusable={!overlay}
                preferred={item.id === gridFocusId}
                onFocus={() => {
                  focusedId.current = item.id;
                  if (item.id === gridFocusId) {
                    setGridFocusId(undefined);
                  }
                }}
                onPress={() => onOpen(item)}
              />
            </View>
          )}
          contentContainerStyle={styles.grid}
          initialNumToRender={Math.max(COLUMNS * 3, focusIndex + COLUMNS * 2)}
          windowSize={5}
          onEndReached={() => void controllerRef.current?.loadMore()}
          onEndReachedThreshold={0.6}
          ListFooterComponent={results.loadingMore ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
        />
      )}

      {keyboard ? (
        <View style={styles.keyboardWrap}>
          <OnBack
            handler={() => {
              setKeyboard(false);
              setToolbarFocus('search');
            }}
          />
          <OnScreenKeyboard
            title="Search collections"
            mode="username"
            value={search}
            onChange={setSearch}
            onDone={() => {
              setKeyboard(false);
              setToolbarFocus('search');
            }}
          />
        </View>
      ) : null}

      {sortPanel ? (
        <SortPanel
          title="Sort collections"
          subtitle="Choose how collections are ordered."
          options={COLLECTION_LIST_SORTS}
          applied={applied.sort}
          label={collectionSortLabel}
          pending={sortPanel.pending}
          error={sortPanel.error}
          onChoose={sort => void chooseSort(sort)}
          onClose={closeSort}
        />
      ) : null}
    </View>
  );
}

/**
 * Claims Back while it is mounted. Mounted with the keyboard, so its listener is newer than the main screen's
 * (which would go Home) and runs first; the sort panel does the same itself.
 */
function OnBack({ handler }: { handler: () => void }) {
  useBack(() => {
    handler();
    return true;
  });
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.safeMargin, paddingTop: px(8) },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: px(12), minHeight: px(80) },
  title: { color: colors.text, fontSize: px(64), fontWeight: '800', marginRight: px(32) },
  count: { color: colors.textMuted, fontSize: type.body, marginLeft: 'auto' },
  toolbar: { flexDirection: 'row', alignItems: 'flex-end' },
  searchField: { width: px(640) },
  // Lines the buttons up with the field below its label.
  toolButton: { marginLeft: spacing.gap, marginBottom: px(22), minHeight: px(82) },
  grid: { paddingTop: px(12), paddingBottom: spacing.safeMargin },
  cell: { marginRight: px(8), marginBottom: px(24) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: px(160) },
  error: { color: colors.danger, fontSize: type.body, textAlign: 'center', marginTop: px(8) },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: '800', textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center', marginTop: px(12) },
  retry: { marginTop: spacing.gapLarge },
  more: { marginVertical: px(24) },
  keyboardWrap: { position: 'absolute', top: px(8), right: 0, bottom: 0, justifyContent: 'flex-start' },
});
