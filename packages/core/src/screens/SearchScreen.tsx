import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { KeyButton } from '../components/KeyButton';
import { SourceMenu, type SourceChoice } from '../components/SourceMenu';
import { WideCard } from '../components/WideCard';
import { px, useScale } from '../layout';
import type { KindFilter, MediaItem } from '../providers/types';
import { editQuery, KEY_ROWS, KIND_FILTERS, typeKey, type EditKey } from '../search';
import { ALL_SOURCES, type SearchController, type SearchScope, type SearchSnapshot } from '../search/controller';
import { findGroup, hitsOn } from '../search/match';
import type { SearchGroup, SourceHit } from '../search/model';
import { copyChoices, searchStatus, sourceCaption, sourceLabels } from '../search/sources';
import { colors, focus, type } from '../theme';
import { cardTitle, typeYearSubtitle } from '../util/format';

interface Props {
  /** Lives above this screen, so query, results and the focused card survive a visit to a title page. */
  controller: SearchController;
  /** The connection the app is showing. */
  activeKey: string | undefined;
  /** Which servers a fresh search covers (search/sources.ts `defaultScope`). */
  defaultScope: SearchScope;
  /** Opens a copy on the active server. `alternatives` are the other servers' copies, for "Also on…". */
  onOpen: (item: MediaItem, alternatives: SourceHit[]) => void;
  /** Switches to the copy's server and opens it there; resolves to an error to show, or undefined. */
  onSwitchOpen: (hit: SourceHit) => Promise<string | undefined>;
}

type Menu =
  | { name: 'copies'; group: SearchGroup; mode: 'open' | 'switch'; choices: SourceChoice[] }
  | { name: 'scope' };

const COLUMNS = 3;
const KEY = 68;
const KEY_GAP = 10;
/** Width of the keyboard column: six keys and the gaps between them, plus room for the focus outline. */
const PANEL = 6 * KEY + 5 * KEY_GAP + 24;
/** Retry buttons shown at once; more failed servers than this are still named in the status line. */
const MAX_RETRY_BUTTONS = 3;

/**
 * Search with an on-screen keyboard, because a remote has no keys (docs/design/search-mockup.png), across every
 * connected server (docs/cross-server-search.md): one card per title with the servers that have it. Results
 * show as each server answers; a server that fails leaves the others' results up and gets its own Retry.
 * Choosing a card never switches or plays: a copy on another server asks "Switch to <server>?" first.
 */
export function SearchScreen({ controller, activeKey, defaultScope, onOpen, onSwitchOpen }: Props) {
  const s = useScale();
  const { width } = useWindowDimensions();
  const [snapshot, setSnapshot] = useState<SearchSnapshot>(() => controller.snapshot());
  const [menu, setMenu] = useState<Menu | undefined>(undefined);
  // The card to focus when results show again (Back from a title, a closed menu), and a nonce to re-apply it.
  const [restore, setRestore] = useState(() => findGroup(controller.snapshot().groups, controller.remembered())?.key);
  const [restoreNonce, setRestoreNonce] = useState(0);
  const listRef = useRef<FlatList<SearchGroup>>(null);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  useEffect(() => {
    const { request } = controller.snapshot();
    if (!request.query && request.scope !== defaultScope) {
      controller.setRequest({ ...request, scope: defaultScope });
    }
    // Only when the screen opens: a scope the viewer picks stays until they change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  // Late answers can merge cards: keep focus on the same title, not the same position.
  useEffect(() => {
    if (restore && !snapshot.groups.some(g => g.key === restore)) {
      const moved = findGroup(snapshot.groups, controller.remembered());
      setRestore(moved?.key);
    }
  }, [snapshot.groups, restore, controller]);

  useEffect(() => {
    if (menu?.name !== 'scope') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMenu(undefined);
      return true;
    });
    return () => subscription.remove();
  }, [menu]);

  const sources = controller.sources();
  const labels = useMemo(() => sourceLabels(sources), [sources]);
  const many = sources.length > 1;
  const { query, filter, scope } = snapshot.request;
  const term = query.trim();
  const status = searchStatus(snapshot, labels);
  const failed = snapshot.states.filter(st => st.status === 'unavailable' || st.status === 'timed-out' || st.status === 'denied');

  const setQuery = (update: (q: string) => string) => controller.setRequest({ ...snapshot.request, query: update(query) });
  const setFilter = (next: KindFilter) => controller.setRequest({ ...snapshot.request, filter: next });
  const edit = (key: EditKey) => setQuery(q => editQuery(q, key));

  const closeMenu = (group?: SearchGroup) => {
    setMenu(undefined);
    if (group) {
      setRestore(group.key);
      setRestoreNonce(n => n + 1);
    }
  };

  const choose = (group: SearchGroup) => {
    const here = hitsOn(group, activeKey);
    const others = group.hits.filter(h => h.sourceKey !== activeKey);
    if (here.length === 1) {
      onOpen(here[0].item, others);
    } else if (here.length > 1) {
      setMenu({ name: 'copies', group, mode: 'open', choices: copyChoices(here, labels) });
    } else {
      setMenu({ name: 'copies', group, mode: 'switch', choices: copyChoices(group.hits, labels) });
    }
  };

  if (menu?.name === 'copies') {
    const { group } = menu;
    return (
      <SourceMenu
        title={cardTitle(group.display.item)}
        choices={menu.choices}
        mode={menu.mode}
        onOpen={hit => {
          controller.remember({ key: group.key, hitKeys: group.hits.map(h => h.key) });
          onOpen(hit.item, group.hits.filter(h => h.sourceKey !== activeKey));
        }}
        onSwitch={hit => {
          controller.remember({ key: group.key, hitKeys: group.hits.map(h => h.key) });
          return onSwitchOpen(hit);
        }}
        onClose={() => closeMenu(group)}
      />
    );
  }

  if (menu?.name === 'scope') {
    const options: Array<{ scope: SearchScope; label: string }> = [
      { scope: ALL_SOURCES, label: 'All servers' },
      ...sources.map(src => ({ scope: src.key, label: labels.get(src.key) ?? src.label })),
    ];
    return (
      <View style={styles.menu}>
        <Text style={styles.title}>Search which servers?</Text>
        <View style={styles.menuActions}>
          {options.map(option => (
            <FocusButton
              key={option.scope}
              label={option.label}
              primary={option.scope === scope}
              preferred={option.scope === scope}
              onPress={() => {
                controller.setRequest({ ...snapshot.request, scope: option.scope });
                setMenu(undefined);
              }}
              style={styles.menuAction}
            />
          ))}
        </View>
      </View>
    );
  }

  const margin = s(96);
  const panelWidth = s(PANEL);
  const gap = s(24);
  const resultsWidth = width - 2 * margin - panelWidth - s(48);
  const cardWidth = Math.floor((resultsWidth - (COLUMNS - 1) * gap) / COLUMNS) - 2 * focus.borderWidth;
  const restoreIndex = restore ? snapshot.groups.findIndex(g => g.key === restore) : -1;
  const scopeLabel = scope === ALL_SOURCES ? 'All servers' : labels.get(scope) ?? 'One server';
  const loading = snapshot.pending > 0 && snapshot.groups.length === 0;

  return (
    <View style={[styles.screen, { paddingHorizontal: margin }]}>
      <View style={{ width: panelWidth }}>
        <Text style={styles.title}>Search</Text>
        <Text style={styles.label}>{many ? 'Search your servers' : 'Search your library'}</Text>
        <View style={styles.input}>
          <View style={styles.glyph}>
            <View style={styles.glyphLens} />
            <View style={styles.glyphHandle} />
          </View>
          <Text style={[styles.inputText, !query && styles.placeholder]} numberOfLines={1}>
            {query || 'Type a title'}
          </Text>
        </View>

        <View style={styles.keys}>
          {KEY_ROWS.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.keyRow}>
              {row.map((key, index) => (
                <KeyButton
                  key={key}
                  label={key}
                  preferred={restoreIndex < 0 && rowIndex === 0 && index === 0}
                  onPress={() => setQuery(q => typeKey(q, key))}
                />
              ))}
            </View>
          ))}
          <View style={styles.keyRow}>
            <FocusButton label="Space" onPress={() => edit('space')} style={styles.editKey} />
            <FocusButton label="Delete" onPress={() => edit('delete')} style={styles.editKey} />
            <FocusButton label="Clear" onPress={() => edit('clear')} style={styles.editKey} />
          </View>
        </View>

        <Text style={styles.hint}>{'‹  Back  ·  Leave search'}</Text>
      </View>

      <View style={[styles.results, { marginLeft: s(48) }]}>
        <Text style={styles.heading} numberOfLines={1}>
          {term ? `Results for “${term}”` : 'Start typing to find a title'}
        </Text>
        <View style={styles.chips}>
          {KIND_FILTERS.map(entry => (
            <FocusButton
              key={entry.filter}
              label={entry.label}
              primary={filter === entry.filter}
              onPress={() => setFilter(entry.filter)}
              style={styles.chip}
            />
          ))}
          {many ? <FocusButton label={scopeLabel} onPress={() => setMenu({ name: 'scope' })} style={styles.chip} /> : null}
        </View>

        {status.line ? (
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {status.line}
          </Text>
        ) : null}
        {failed.length > 0 ? (
          <View style={styles.retries}>
            {failed.slice(0, MAX_RETRY_BUTTONS).map(st => (
              <FocusButton
                key={st.source.key}
                label={`Retry ${labels.get(st.source.key) ?? st.source.label}`}
                onPress={() => controller.retry(st.source.key)}
                style={styles.chip}
              />
            ))}
          </View>
        ) : null}

        {loading ? <ActivityIndicator color={colors.accent} size="large" style={styles.spinner} /> : null}
        {status.empty ? <Text style={styles.empty}>{status.empty}</Text> : null}
        {snapshot.groups.length > 0 ? (
          <FlatList
            ref={listRef}
            data={snapshot.groups}
            key={`results-${COLUMNS}`}
            numColumns={COLUMNS}
            keyExtractor={group => group.key}
            columnWrapperStyle={{ marginBottom: gap }}
            renderItem={({ item: group, index }) => (
              <View style={{ marginRight: (index + 1) % COLUMNS === 0 ? 0 : gap }}>
                <WideCard
                  key={group.key === restore ? `restore-${restoreNonce}` : 'card'}
                  title={cardTitle(group.display.item)}
                  subtitle={typeYearSubtitle(group.display.item)}
                  caption={many ? sourceCaption(group, labels, sources) : undefined}
                  imageUrl={group.display.item.landscapeUrl}
                  width={cardWidth}
                  preferred={group.key === restore}
                  onFocus={() => controller.remember({ key: group.key, hitKeys: group.hits.map(h => h.key) })}
                  onPress={() => choose(group)}
                />
              </View>
            )}
            contentContainerStyle={{ paddingTop: px(8), paddingBottom: s(120) }}
            initialNumToRender={Math.max(COLUMNS * 3, restoreIndex + 1 + COLUMNS * 2)}
            windowSize={5}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: colors.background, paddingTop: px(4) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  label: { color: colors.textMuted, fontSize: type.body, marginTop: px(4), marginBottom: px(10) },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    height: px(68),
    paddingHorizontal: px(20),
    borderRadius: px(12),
    borderWidth: 2,
    borderColor: colors.surfaceFocused,
    backgroundColor: colors.surface,
    marginBottom: px(18),
  },
  inputText: { flex: 1, color: colors.text, fontSize: type.heading, marginLeft: px(16) },
  placeholder: { color: colors.textMuted },
  glyph: { width: px(28), height: px(28) },
  glyphLens: { width: px(20), height: px(20), borderRadius: px(10), borderWidth: 3, borderColor: colors.textMuted },
  glyphHandle: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: px(10),
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    transform: [{ rotate: '45deg' }],
  },
  keys: { alignSelf: 'flex-start' },
  keyRow: { flexDirection: 'row', marginBottom: px(KEY_GAP) },
  editKey: { minHeight: px(KEY), paddingHorizontal: px(24), marginRight: px(KEY_GAP), minWidth: px(140) },
  hint: { color: colors.textMuted, fontSize: type.caption, marginTop: px(14) },
  results: { flex: 1 },
  heading: { color: colors.text, fontSize: type.title, fontWeight: '800', marginBottom: px(14) },
  chips: { flexDirection: 'row', marginBottom: px(20) },
  chip: { marginRight: px(14), minHeight: px(52), paddingHorizontal: px(24) },
  status: { color: colors.textMuted, fontSize: type.caption, marginBottom: px(12) },
  retries: { flexDirection: 'row', marginBottom: px(16) },
  spinner: { marginTop: px(48) },
  empty: { color: colors.textMuted, fontSize: type.body, marginTop: px(24) },
  menu: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: px(192) },
  menuActions: { marginTop: px(32) },
  menuAction: { marginBottom: px(16), alignSelf: 'flex-start', minWidth: px(520) },
});
