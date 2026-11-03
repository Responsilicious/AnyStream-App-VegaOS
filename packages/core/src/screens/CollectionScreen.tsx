import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CollectionCard } from '../components/CollectionCard';
import { FocusButton } from '../components/FocusButton';
import { SortPanel } from '../components/SortPanel';
import { BackLink } from '../components/TitleParts';
import { TopBar } from '../components/TopBar';
import { px, useScale } from '../layout';
import { BrowseController, type BrowseState } from '../library/browseController';
import {
  COLLECTION_MEMBER_SORTS,
  collectionSortHelp,
  collectionSortLabel,
  memberCaption,
  memberTarget,
  titleCount,
  type CollectionPrefsStore,
  type CollectionScope,
  type MemberTarget,
} from '../library/collections';
import type { Section } from '../navigation';
import { describeError, isJellyfinError } from '../providers/jellyfin';
import type { CollectionSort, CollectionsSource, MediaItem, MediaProvider } from '../providers/types';
import { colors, spacing, type } from '../theme';
import { useBack } from '../useBack';

/** What one collection page keeps while a member's page is open, so Back lands on the same card, order and page. */
export interface CollectionPageMemory {
  scope: string;
  collection: MediaItem;
  state: BrowseState<MediaItem, CollectionSort>;
  focusedId?: string;
}

interface Props {
  provider: MediaProvider;
  source: CollectionsSource;
  prefs: CollectionPrefsStore;
  /** The collection; may be a stub from a card, the full record is fetched. */
  collection: MediaItem;
  /** This collection is already open further back on the same path: show the loop notice, load nothing. */
  loop?: boolean;
  /** Collections open before this one, outermost first: the breadcrumb. */
  trail: MediaItem[];
  nav: { active: Section; profileName: string; backLabel: string; onSection: (section: Section) => void; showCollections?: boolean };
  /** A member was chosen and it has a page: the app opens it. Never plays. */
  onOpenMember: (target: Exclude<MemberTarget, { to: 'resolve' } | { to: 'unsupported' }>) => void;
  onBack: () => void;
  /** This page's record, kept by the app while deeper pages are open. */
  memory: { get: () => CollectionPageMemory | undefined; set: (m: CollectionPageMemory) => void };
}

const COLUMNS = 6;
const PAGE_SIZE = 60;
/** An overview longer than this gets More / Less instead of running down the page. */
const LONG_OVERVIEW = 240;

type Phase =
  | { name: 'loading' }
  | { name: 'ready' }
  | { name: 'error'; message: string }
  /** The collection is gone or no longer visible to this viewer. */
  | { name: 'removed' };

/**
 * One collection (docs/collections.md): its title, overview and artwork, then its members as cards that say what
 * each one is. Nothing here plays: Browse titles moves to the first card, and every card opens its own page. The
 * order defaults to the server's own collection order; another order applies to every member, server-side.
 */
export function CollectionScreen({ provider, source, prefs, collection, loop, trail, nav, onOpenMember, onBack, memory }: Props) {
  const s = useScale();
  const { width } = useWindowDimensions();
  const scope: CollectionScope = { provider: provider.kind, serverId: provider.session.server.id, userId: provider.session.userId };
  const scopeKey = `${scope.provider}/${scope.serverId}/${scope.userId}/${collection.id}`;
  const [full, setFull] = useState<MediaItem>(() => memory.get()?.collection ?? collection);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [results, setResults] = useState<BrowseState<MediaItem, CollectionSort> | null>(null);
  const [sortPanel, setSortPanel] = useState<{ pending: boolean; error: string | null } | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [gridFocusId, setGridFocusId] = useState<string | undefined>(undefined);
  const [headerFocus, setHeaderFocus] = useState<'browse' | 'sort' | undefined>('browse');
  const [attempt, setAttempt] = useState(0);
  const focusedId = useRef<string | undefined>(undefined);
  const controllerRef = useRef<BrowseController<MediaItem, CollectionSort> | null>(null);

  useBack(() => {
    // The sort panel claims Back itself while it is open.
    onBack();
    return true;
  });

  useEffect(() => {
    if (loop) {
      return undefined;
    }
    const abort = new AbortController();
    const controller = new BrowseController<MediaItem, CollectionSort>(
      { query: (sort, start, limit, signal) => source.members(collection.id, sort, start, limit, signal) },
      { pageSize: PAGE_SIZE, keyOf: sort => sort, onCommit: sort => prefs.saveMemberSort(scope, collection.id, sort) },
      prefs.memberSort(scope, collection.id),
    );
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setResults);
    const kept = memory.get();
    if (kept && kept.scope === scopeKey && kept.state.loaded) {
      controller.restore(kept.state);
      setFull(kept.collection);
      setGridFocusId(kept.focusedId);
      focusedId.current = kept.focusedId;
      setHeaderFocus(kept.focusedId ? undefined : 'browse');
      setPhase({ name: 'ready' });
    } else {
      setPhase({ name: 'loading' });
      (async () => {
        // Metadata and the first page together; the stub from the card already names the collection.
        const [meta, first] = await Promise.all([
          source.get(collection.id, abort.signal).then(
            item => ({ ok: true as const, item }),
            error => ({ ok: false as const, error }),
          ),
          controller.apply(prefs.memberSort(scope, collection.id)),
        ]);
        if (abort.signal.aborted) {
          return;
        }
        if (!meta.ok && isJellyfinError(meta.error) && meta.error.kind === 'not-found') {
          setPhase({ name: 'removed' });
          return;
        }
        if (meta.ok) {
          setFull(meta.item);
        }
        if (first.outcome === 'applied') {
          setPhase({ name: 'ready' });
        } else if (first.outcome === 'failed') {
          setPhase(
            isJellyfinError(first.error) && first.error.kind === 'not-found'
              ? { name: 'removed' }
              : { name: 'error', message: describeError(first.error) },
          );
        }
      })();
    }
    return () => {
      abort.abort();
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
    };
    // One load per collection and viewer, or Try again; sort changes go through the same controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, scopeKey, loop, attempt]);

  // Keep the record current, so Back from a member restores this page as it was.
  useEffect(() => {
    if (results?.loaded) {
      memory.set({ scope: scopeKey, collection: full, state: results, focusedId: focusedId.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, full, scopeKey]);

  const rememberFocus = (id: string) => {
    focusedId.current = id;
    if (results?.loaded) {
      memory.set({ scope: scopeKey, collection: full, state: results, focusedId: id });
    }
  };

  const choose = async (item: MediaItem) => {
    if (resolving) {
      return;
    }
    setNotice(null);
    let target = memberTarget(item);
    if (target.to === 'resolve') {
      // An episode or season that does not name its series: ask the server for it before going anywhere.
      setResolving(true);
      try {
        target = memberTarget(await provider.getItem(item.id));
      } catch (e) {
        setNotice(describeError(e));
        return;
      } finally {
        setResolving(false);
      }
      if (target.to === 'resolve') {
        setNotice(`Couldn't find the series “${item.title}” belongs to.`);
        return;
      }
    }
    if (target.to === 'unsupported') {
      setNotice(target.reason);
      return;
    }
    onOpenMember(target);
  };

  const chooseSort = async (sort: CollectionSort) => {
    const controller = controllerRef.current;
    if (!controller || !results) {
      return;
    }
    if (sort === results.applied) {
      setSortPanel(null);
      setHeaderFocus('sort');
      return;
    }
    setSortPanel({ pending: true, error: null });
    const result = await controller.apply(sort);
    if (result.outcome === 'applied') {
      setSortPanel(null);
      setGridFocusId(undefined);
      focusedId.current = undefined;
      setHeaderFocus('sort');
    } else if (result.outcome === 'failed') {
      setSortPanel({ pending: false, error: `Couldn't load that order. ${describeError(result.error)}` });
    }
  };

  const items = results?.items ?? [];
  const overlay = sortPanel !== null;
  const gridWidth = width - s(96) * 2;
  const tileWidth = Math.floor((gridWidth - COLUMNS * px(16)) / COLUMNS) - px(16);
  const previewWidth = s(560);
  const previewHeight = s(315);
  const overview = full.overview?.trim();
  const longOverview = !!overview && overview.length > LONG_OVERVIEW;
  const count = titleCount(results?.total ?? null);
  const crumbs = trail.length > 0 ? ['Collections', ...trail.map(c => c.title)].join('  ›  ') : undefined;

  const header = (
    <View style={{ paddingHorizontal: s(96) }}>
      <BackLink label={nav.backLabel} onPress={onBack} />
      {crumbs ? (
        <Text style={styles.crumbs} numberOfLines={1} accessibilityLabel={`In ${trail.map(c => c.title).join(', then ')}`}>
          {crumbs}
        </Text>
      ) : null}
      <View style={styles.main}>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
            {full.title}
          </Text>
          <Text style={styles.meta}>{['Collection', phase.name === 'ready' ? count : undefined].filter(Boolean).join('  ·  ')}</Text>
          {overview ? (
            <Text style={styles.overview} numberOfLines={overviewOpen || !longOverview ? undefined : 3}>
              {overview}
            </Text>
          ) : null}
          {phase.name === 'ready' ? (
            <View style={styles.actions}>
              <FocusButton
                label="Browse titles"
                primary
                disabled={overlay || items.length === 0}
                preferred={!gridFocusId && headerFocus === 'browse' && !overlay && items.length > 0}
                onPress={() => {
                  setHeaderFocus(undefined);
                  setGridFocusId(items[0]?.id);
                }}
              />
              <FocusButton
                label={`Sort: ${collectionSortLabel(results?.applied ?? 'collection')}`}
                disabled={overlay}
                preferred={!gridFocusId && (headerFocus === 'sort' || items.length === 0) && !overlay}
                onPress={() => {
                  setHeaderFocus(undefined);
                  setSortPanel({ pending: false, error: null });
                }}
                style={styles.actionGap}
              />
              {longOverview ? (
                <FocusButton
                  label={overviewOpen ? 'Less' : 'More'}
                  disabled={overlay}
                  onPress={() => setOverviewOpen(open => !open)}
                  style={styles.actionGap}
                />
              ) : null}
            </View>
          ) : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {resolving ? <ActivityIndicator color={colors.accent} style={styles.resolving} /> : null}
        </View>
        {/* Decoration only: a contained still, never focusable, never a banner over the members. */}
        <View style={[styles.preview, { width: previewWidth, height: previewHeight }]} importantForAccessibility="no-hide-descendants">
          {full.backdropUrl ? (
            <Image source={{ uri: full.backdropUrl }} style={{ width: previewWidth, height: previewHeight }} resizeMode="cover" />
          ) : full.posterUrl ? (
            <Image source={{ uri: full.posterUrl }} style={{ width: previewWidth, height: previewHeight }} resizeMode="contain" />
          ) : null}
        </View>
      </View>
    </View>
  );

  const shell = (body: ReactElement) => (
    <View style={styles.screen}>
      <TopBar active={nav.active} profileName={nav.profileName} onSelect={nav.onSection} showCollections={nav.showCollections} inert={overlay} />
      {body}
    </View>
  );

  if (loop) {
    return shell(
      <View>
        {header}
        <View style={[styles.state, { paddingHorizontal: s(96) }]}>
          <Text style={styles.stateTitle}>This collection contains itself</Text>
          <Text style={styles.stateText}>
            “{collection.title}” is already open further back. Its server lists it inside its own members, so AnyStream
            stops here instead of opening it again.
          </Text>
          <FocusButton label={nav.backLabel} primary preferred onPress={onBack} style={styles.stateButton} />
        </View>
      </View>,
    );
  }

  if (phase.name !== 'ready' || !results) {
    return shell(
      <View>
        {header}
        <View style={[styles.state, { paddingHorizontal: s(96) }]}>
          {phase.name === 'removed' ? (
            <>
              <Text style={styles.stateTitle}>This collection isn't available</Text>
              <Text style={styles.stateText}>It may have been removed from the server, or it is no longer shared with this account.</Text>
              <FocusButton label={nav.backLabel} primary preferred onPress={onBack} style={styles.stateButton} />
            </>
          ) : phase.name === 'error' ? (
            <>
              <Text style={styles.stateText}>{phase.message}</Text>
              <FocusButton label="Try again" primary preferred onPress={() => setAttempt(n => n + 1)} style={styles.stateButton} />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} size="large" />
          )}
        </View>
      </View>,
    );
  }

  const focusIndex = gridFocusId ? items.findIndex(i => i.id === gridFocusId) : -1;

  return shell(
    <>
      <FlatList
        data={items}
        key={`grid-${COLUMNS}`}
        numColumns={COLUMNS}
        keyExtractor={item => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={[styles.state, { paddingHorizontal: s(96) }]}>
            <Text style={styles.stateTitle}>No titles available</Text>
            <Text style={styles.stateText}>None of this collection's titles are available to this account right now.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const target = memberTarget(item);
          return (
            <View style={styles.cell}>
              <CollectionCard
                title={item.title}
                caption={memberCaption(item)}
                imageUrl={item.posterUrl}
                width={tileWidth}
                unavailable={target.to === 'unsupported' ? 'Not available in AnyStream' : undefined}
                focusable={!overlay}
                preferred={item.id === gridFocusId}
                onFocus={() => {
                  rememberFocus(item.id);
                  if (item.id === gridFocusId) {
                    setGridFocusId(undefined);
                  }
                }}
                onPress={() => void choose(item)}
              />
            </View>
          );
        }}
        columnWrapperStyle={{ paddingHorizontal: s(96) }}
        contentContainerStyle={styles.grid}
        initialNumToRender={Math.max(COLUMNS * 3, focusIndex + COLUMNS * 2)}
        windowSize={5}
        onEndReached={() => void controllerRef.current?.loadMore()}
        onEndReachedThreshold={0.6}
        ListFooterComponent={results.loadingMore ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
      />
      {sortPanel ? (
        <SortPanel
          title="Sort this collection"
          subtitle={`Choose how the titles in “${full.title}” are ordered.`}
          options={COLLECTION_MEMBER_SORTS}
          applied={results.applied}
          label={collectionSortLabel}
          help={collectionSortHelp}
          pending={sortPanel.pending}
          error={sortPanel.error}
          onChoose={sort => void chooseSort(sort)}
          onClose={() => {
            controllerRef.current?.cancelApply();
            setSortPanel(null);
            setHeaderFocus('sort');
          }}
        />
      ) : null}
    </>,
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  crumbs: { color: colors.textMuted, fontSize: type.caption, marginTop: px(4) },
  main: { flexDirection: 'row', alignItems: 'flex-start', marginTop: px(12), marginBottom: px(28) },
  info: { flex: 1, marginRight: px(48) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: type.body, marginTop: px(8) },
  overview: { color: colors.text, fontSize: type.body, lineHeight: px(36), marginTop: px(16), maxWidth: px(1000) },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: px(24) },
  actionGap: { marginLeft: spacing.gap },
  notice: { color: colors.danger, fontSize: type.body, marginTop: px(16) },
  resolving: { marginTop: px(16), alignSelf: 'flex-start' },
  preview: { borderRadius: px(12), overflow: 'hidden', backgroundColor: colors.surface },
  grid: { paddingBottom: spacing.safeMargin },
  cell: { marginRight: px(8), marginBottom: px(24) },
  state: { alignItems: 'center', paddingTop: px(48) },
  stateTitle: { color: colors.text, fontSize: type.heading, fontWeight: '800', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: type.body, textAlign: 'center', marginTop: px(12), maxWidth: px(1100) },
  stateButton: { marginTop: spacing.gapLarge },
  more: { marginVertical: px(24) },
});
