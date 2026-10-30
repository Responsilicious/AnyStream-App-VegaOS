import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FilterDrawer, type DrawerTab } from '../components/FilterDrawer';
import { FocusButton } from '../components/FocusButton';
import { LibraryToolbar } from '../components/LibraryToolbar';
import { PosterCard } from '../components/PosterCard';
import { px } from '../layout';
import { BrowseController, type BrowseState } from '../library/browseController';
import { LibraryPrefsStore, scopeKey, type ViewScope } from '../library/prefsStore';
import {
  DEFAULT_VIEW,
  EMPTY_FILTERS,
  activeFilterCount,
  filterChips,
  filterSummary,
  pageNoun,
  removeChip,
  sameFilters,
  sameView,
  sortLabel,
  validateView,
  type FilterChip,
  type MediaPage,
} from '../library/viewState';
import { describeError } from '../providers/jellyfin';
import type { Library, LibraryCapabilities, LibraryFacets, LibraryView, MediaItem, MediaProvider } from '../providers/types';
import { colors, spacing, type } from '../theme';

/** What a page keeps while a title page is open, so Back restores results, position and focus without a reload. */
export interface BrowseMemory {
  scope: string;
  libraryId: string;
  caps: LibraryCapabilities;
  facets: LibraryFacets;
  state: BrowseState<MediaItem>;
  focusedId?: string;
}

interface Props {
  provider: MediaProvider;
  page: MediaPage;
  prefs: LibraryPrefsStore;
  onOpen: (item: MediaItem) => void;
  /** Kept by the app across title pages; cleared when the server or profile changes. */
  memory: { current: BrowseMemory | undefined };
  /** The drawer opened or closed: the header must not take focus while it is open. */
  onOverlay: (open: boolean) => void;
}

const COLUMNS = 6;
const PAGE_SIZE = 60;

type Phase = { name: 'loading' } | { name: 'error'; message: string } | { name: 'ready' } | { name: 'empty-library' };

interface Ready {
  library: Library;
  scope: ViewScope;
  caps: LibraryCapabilities;
  facets: LibraryFacets;
  controller: BrowseController<MediaItem>;
}

/**
 * The Movies and Series pages (docs/library-filters.md): title, library tabs, Filters / Sort toolbar with chips,
 * then the poster grid. Results always come from the server's own filtering and sorting of the whole library.
 */
export function BrowseScreen({ provider, page, prefs, onOpen, memory, onOverlay }: Props) {
  const { width } = useWindowDimensions();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [ready, setReady] = useState<Ready | null>(null);
  const [results, setResults] = useState<BrowseState<MediaItem> | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [chipError, setChipError] = useState<string | null>(null);
  const [chipBusy, setChipBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ tab: DrawerTab; draft: LibraryView; count: number | null; pending: boolean; error: string | null } | null>(null);
  const [toolbarFocus, setToolbarFocus] = useState<'filters' | 'sort' | undefined>(undefined);
  const [gridFocusId, setGridFocusId] = useState<string | undefined>(undefined);
  const focusedId = useRef<string | undefined>(undefined);
  const attempt = useRef(0);

  const loadLibraries = useCallback(async () => {
    setPhase({ name: 'loading' });
    try {
      const kind = page === 'series' ? 'tvshows' : 'movies';
      const found = (await provider.getLibraries()).filter(l => l.kind === kind);
      setLibraries(found);
      const remembered = memory.current && found.find(l => l.id === memory.current?.libraryId);
      setLibrary(remembered ?? found[0] ?? null);
      if (found.length === 0) {
        setPhase({ name: 'empty-library' });
      }
    } catch (e) {
      setPhase({ name: 'error', message: describeError(e) });
    }
  }, [provider, page, memory]);

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  // Opening a library: capabilities and genres first, then the saved view checked against them, then its first page.
  useEffect(() => {
    if (!library) {
      return undefined;
    }
    const mine = ++attempt.current;
    const abort = new AbortController();
    const scope: ViewScope = { provider: provider.kind, serverId: provider.session.server.id, userId: provider.session.userId, libraryId: library.id, page };
    const key = scopeKey(scope);
    let controller: BrowseController<MediaItem> | undefined;
    let unsubscribe: (() => void) | undefined;

    const start = (caps: LibraryCapabilities, facets: LibraryFacets, initial: LibraryView) => {
      controller = new BrowseController<MediaItem>(
        {
          query: (v, s, limit, signal) => provider.queryLibrary(library, v, s, limit, signal),
          count: caps.exactCounts ? (v, signal) => provider.countLibrary(library, v, signal) : undefined,
        },
        { pageSize: PAGE_SIZE, onCommit: v => prefs.save(scope, v) },
        initial,
      );
      unsubscribe = controller.subscribe(setResults);
      setReady({ library, scope, caps, facets, controller });
      return controller;
    };

    setPhase({ name: 'loading' });
    setReady(null);
    setResults(null);
    setDrawer(null);
    setChipError(null);

    const kept = memory.current;
    if (kept && kept.scope === key && kept.state.loaded) {
      // Back from a title page: the same results, scrolled to and focused on the card that was chosen.
      const c = start(kept.caps, kept.facets, kept.state.applied);
      c.restore(kept.state);
      setGridFocusId(kept.focusedId);
      focusedId.current = kept.focusedId;
      setNotices([]);
      setPhase({ name: 'ready' });
    } else {
      setGridFocusId(undefined);
      focusedId.current = undefined;
      (async () => {
        try {
          const caps = await provider.getLibraryCapabilities(library, abort.signal);
          const facets: LibraryFacets = caps.genres ? await provider.getLibraryFacets(library, abort.signal) : { genres: [] };
          if (mine !== attempt.current) {
            return;
          }
          const saved = prefs.get(scope) ?? DEFAULT_VIEW;
          const checked = validateView(saved, page, caps, facets);
          const c = start(caps, facets, checked.view);
          setNotices(checked.notices);
          const result = await c.apply(checked.view);
          if (mine !== attempt.current) {
            return;
          }
          if (result.outcome === 'failed') {
            setPhase({ name: 'error', message: describeError(result.error) });
          } else if (result.outcome === 'applied') {
            setPhase({ name: 'ready' });
            setToolbarFocus('filters');
          }
        } catch (e) {
          if (mine === attempt.current && !abort.signal.aborted) {
            setPhase({ name: 'error', message: describeError(e) });
          }
        }
      })();
    }

    return () => {
      abort.abort();
      // Leaving for a title page: remember the card that had focus, so Back lands on it.
      if (memory.current?.scope === key) {
        memory.current = { ...memory.current, focusedId: focusedId.current };
      }
      unsubscribe?.();
      controller?.dispose();
    };
    // `prefs` and `memory` are stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, library, page]);

  // Memory needs caps and facets too; they are known once ready, so keep the record current.
  useEffect(() => {
    if (ready && results?.loaded) {
      memory.current = {
        scope: scopeKey(ready.scope),
        libraryId: ready.library.id,
        caps: ready.caps,
        facets: ready.facets,
        state: results,
        focusedId: focusedId.current,
      };
    }
  }, [ready, results, memory]);

  const drawerOpen = drawer !== null;
  useEffect(() => {
    onOverlay(drawerOpen);
  }, [drawerOpen, onOverlay]);
  useEffect(() => () => onOverlay(false), [onOverlay]);

  const applied = results?.applied ?? DEFAULT_VIEW;

  const openDrawer = (tab: DrawerTab) => {
    if (!ready) {
      return;
    }
    setChipError(null);
    setToolbarFocus(undefined);
    setDrawer({ tab, draft: applied, count: null, pending: false, error: null });
    ready.controller.previewCount(applied, count => setDrawer(d => (d ? { ...d, count } : d)));
  };

  const closeDrawer = (returnTo?: 'filters' | 'sort') => {
    ready?.controller.cancelPreview();
    ready?.controller.cancelApply();
    const tab = drawer?.tab;
    setDrawer(null);
    setToolbarFocus(returnTo ?? (tab === 'sort' ? 'sort' : 'filters'));
  };

  const editDraft = (draft: LibraryView) => {
    if (!ready || !drawer) {
      return;
    }
    const filtersChanged = !sameFilters(draft.filters, drawer.draft.filters);
    setDrawer({ ...drawer, draft, count: filtersChanged ? null : drawer.count, error: null });
    if (filtersChanged) {
      // Only real edits ask for a count; moving focus never does.
      ready.controller.previewCount(draft, count => setDrawer(d => (d && sameFilters(d.draft.filters, draft.filters) ? { ...d, count } : d)));
    }
  };

  const applyDrawer = async () => {
    if (!ready || !drawer || drawer.pending) {
      return;
    }
    const { draft, tab } = drawer;
    if (sameView(draft, applied)) {
      closeDrawer(tab);
      return;
    }
    ready.controller.cancelPreview();
    setDrawer({ ...drawer, pending: true, error: null });
    const result = await ready.controller.apply(draft);
    if (result.outcome === 'applied') {
      setNotices([]);
      setDrawer(null);
      setGridFocusId(undefined);
      focusedId.current = undefined;
      setToolbarFocus(tab);
    } else if (result.outcome === 'failed') {
      setDrawer(d => (d ? { ...d, pending: false, error: `Couldn't load those results. ${describeError(result.error)}` } : d));
    }
  };

  /** Chip removal and Clear filters: same transaction as Apply, without the drawer. */
  const applyDirect = async (next: LibraryView) => {
    if (!ready || chipBusy) {
      return;
    }
    setChipBusy(true);
    setChipError(null);
    const result = await ready.controller.apply(next);
    setChipBusy(false);
    if (result.outcome === 'failed') {
      setChipError(`Couldn't update the list. ${describeError(result.error)}`);
    } else if (result.outcome === 'applied') {
      setNotices([]);
      setGridFocusId(undefined);
      focusedId.current = undefined;
    }
    setToolbarFocus('filters');
  };

  const onRemoveChip = (chip: FilterChip) => void applyDirect({ ...applied, filters: removeChip(applied.filters, chip.target) });
  const onClear = () => void applyDirect({ ...applied, filters: EMPTY_FILTERS });

  const gridWidth = width - spacing.safeMargin * 2;
  const tileWidth = Math.floor((gridWidth - COLUMNS * px(16)) / COLUMNS) - px(8);
  const items = results?.items ?? [];
  const focusIndex = gridFocusId ? items.findIndex(i => i.id === gridFocusId) : -1;
  const chips = ready ? filterChips(applied.filters, ready.facets, page) : [];
  const filterCount = activeFilterCount(applied.filters);
  const title = page === 'series' ? 'Series' : 'Movies';
  const noun = pageNoun(page);

  const header = (
    <View style={styles.titleRow}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {libraries.length > 1 ? (
        <View style={styles.tabs}>
          {libraries.map(l => (
            <FocusButton
              key={l.id}
              label={l.name}
              primary={library?.id === l.id}
              disabled={drawerOpen}
              onPress={() => {
                memory.current = undefined;
                setLibrary(l);
              }}
              style={styles.tab}
            />
          ))}
        </View>
      ) : null}
      {results?.total != null && phase.name === 'ready' ? (
        <Text style={styles.count}>
          {results.total} {pageNoun(page, results.total)}
        </Text>
      ) : null}
    </View>
  );

  if (phase.name === 'error' || phase.name === 'empty-library' || phase.name === 'loading' || !ready || !results) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.center}>
          {phase.name === 'error' ? (
            <>
              <Text style={styles.error}>{phase.message}</Text>
              <FocusButton
                label="Try again"
                primary
                preferred
                onPress={() => (library ? setLibrary({ ...library }) : loadLibraries())}
                style={styles.retry}
              />
            </>
          ) : phase.name === 'empty-library' ? (
            <Text style={styles.empty}>{page === 'series' ? 'No TV libraries on this server.' : 'No movie libraries on this server.'}</Text>
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
      <LibraryToolbar
        filterCount={filterCount}
        sortText={sortLabel(applied.sort)}
        chips={chips}
        onFilters={() => openDrawer('filters')}
        onSort={() => openDrawer('sort')}
        onRemoveChip={onRemoveChip}
        onClear={onClear}
        preferred={focusIndex >= 0 ? undefined : toolbarFocus}
        inert={drawerOpen}
        busy={chipBusy}
      />
      {notices.map(n => (
        <Text key={n} style={styles.notice}>
          {n}
        </Text>
      ))}
      {chipError ? <Text style={styles.error}>{chipError}</Text> : null}

      {items.length === 0 ? (
        <View style={styles.center}>
          {filterCount > 0 ? (
            <>
              <Text style={styles.emptyTitle}>No {noun} match these filters</Text>
              <Text style={styles.empty}>{filterSummary(applied.filters, ready.facets, page)}</Text>
              <View style={styles.row}>
                <FocusButton label="Edit filters" primary disabled={drawerOpen} onPress={() => openDrawer('filters')} style={styles.rowButton} />
                <FocusButton label="Clear filters" disabled={drawerOpen} onPress={onClear} style={styles.rowButton} />
              </View>
            </>
          ) : (
            <Text style={styles.empty}>This library is empty.</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          key={`grid-${COLUMNS}`}
          numColumns={COLUMNS}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <PosterCard
              item={item}
              width={tileWidth}
              onPress={onOpen}
              focusable={!drawerOpen}
              preferred={item.id === gridFocusId}
              onFocused={i => {
                focusedId.current = i.id;
                // Focus is back on the remembered card; a later remount (scrolling) must not grab it again.
                if (i.id === gridFocusId) {
                  setGridFocusId(undefined);
                }
              }}
            />
          )}
          contentContainerStyle={styles.grid}
          // Enough rows rendered up front to include the card to restore focus to.
          initialNumToRender={Math.max(COLUMNS * 3, focusIndex + COLUMNS * 2)}
          windowSize={5}
          onEndReached={() => void ready.controller.loadMore()}
          onEndReachedThreshold={0.6}
          ListFooterComponent={results.loadingMore ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
        />
      )}

      {drawer ? (
        <FilterDrawer
          page={page}
          tab={drawer.tab}
          caps={ready.caps}
          facets={ready.facets}
          applied={applied}
          draft={drawer.draft}
          draftCount={drawer.count}
          pending={drawer.pending}
          error={drawer.error}
          onTab={tab => setDrawer(d => (d ? { ...d, tab } : d))}
          onDraft={editDraft}
          onApply={() => void applyDrawer()}
          onClose={() => closeDrawer()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.safeMargin, paddingTop: px(8) },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: px(12), minHeight: px(80) },
  title: { color: colors.text, fontSize: px(64), fontWeight: '800', marginRight: px(32) },
  count: { color: colors.textMuted, fontSize: type.body, marginLeft: 'auto' },
  tabs: { flexDirection: 'row' },
  tab: { marginRight: spacing.gap, minHeight: px(56) },
  grid: { paddingTop: px(12), paddingBottom: spacing.safeMargin },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: type.body, textAlign: 'center', marginTop: px(8) },
  notice: { color: colors.textMuted, fontSize: type.body, marginTop: px(4) },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: '800', textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center', marginTop: px(12) },
  row: { flexDirection: 'row', marginTop: spacing.gapLarge },
  rowButton: { marginHorizontal: px(8) },
  retry: { marginTop: spacing.gapLarge },
  more: { marginVertical: px(24) },
});
