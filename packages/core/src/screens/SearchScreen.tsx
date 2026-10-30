import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { KeyButton } from '../components/KeyButton';
import { WideCard } from '../components/WideCard';
import { px, useScale } from '../layout';
import { describeError } from '../providers/jellyfin';
import type { KindFilter, MediaItem, MediaProvider } from '../providers/types';
import { editQuery, KEY_ROWS, KIND_FILTERS, SEARCH_DEBOUNCE_MS, typeKey, type EditKey } from '../search';
import { colors, focus, type } from '../theme';
import { cardTitle, typeYearSubtitle } from '../util/format';

interface Props {
  provider: MediaProvider;
  onOpen: (item: MediaItem) => void;
}

const COLUMNS = 3;
const KEY = 68;
const KEY_GAP = 10;
/** Width of the keyboard column: six keys and the gaps between them, plus room for the focus outline. */
const PANEL = 6 * KEY + 5 * KEY_GAP + 24;

/**
 * Search with an on-screen keyboard, because a remote has no keys (docs/design/search-mockup.png): the
 * keyboard and the query on the left, matching titles on the right, with chips for the kind of title.
 * A search runs once typing pauses, and an answer that arrives after a newer one started is dropped.
 */
export function SearchScreen({ provider, onOpen }: Props) {
  const s = useScale();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KindFilter>('all');
  const [results, setResults] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      provider
        .search(term, filter)
        .then(found => {
          if (!cancelled) {
            setResults(found);
            setError(null);
            setLoading(false);
          }
        })
        .catch(e => {
          if (!cancelled) {
            setError(describeError(e));
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, query, filter]);

  const margin = s(96);
  const panelWidth = s(PANEL);
  const gap = s(24);
  const resultsWidth = width - 2 * margin - panelWidth - s(48);
  const cardWidth = Math.floor((resultsWidth - (COLUMNS - 1) * gap) / COLUMNS) - 2 * focus.borderWidth;

  const edit = (key: EditKey) => setQuery(q => editQuery(q, key));

  return (
    <View style={[styles.screen, { paddingHorizontal: margin }]}>
      <View style={{ width: panelWidth }}>
        <Text style={styles.title}>Search</Text>
        <Text style={styles.label}>Search your library</Text>
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
                  preferred={rowIndex === 0 && index === 0}
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
          {query.trim() ? `Results for “${query.trim()}”` : 'Start typing to find a title'}
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
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {!error && loading && <ActivityIndicator color={colors.accent} size="large" style={styles.spinner} />}
        {!error && !loading && results !== null && results.length === 0 && (
          <Text style={styles.empty}>{`No results for “${query.trim()}”.`}</Text>
        )}
        {!error && results !== null && results.length > 0 && (
          <FlatList
            data={results}
            key={`results-${COLUMNS}`}
            numColumns={COLUMNS}
            keyExtractor={item => item.id}
            columnWrapperStyle={{ marginBottom: gap }}
            renderItem={({ item, index }) => (
              <View style={{ marginRight: (index + 1) % COLUMNS === 0 ? 0 : gap }}>
                <WideCard
                  title={cardTitle(item)}
                  subtitle={typeYearSubtitle(item)}
                  imageUrl={item.landscapeUrl}
                  width={cardWidth}
                  onPress={() => onOpen(item)}
                />
              </View>
            )}
            contentContainerStyle={{ paddingTop: px(8), paddingBottom: s(120) }}
            initialNumToRender={COLUMNS * 3}
            windowSize={5}
          />
        )}
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
  spinner: { marginTop: px(48) },
  empty: { color: colors.textMuted, fontSize: type.body, marginTop: px(24) },
  error: { color: colors.danger, fontSize: type.body, marginTop: px(24) },
});
