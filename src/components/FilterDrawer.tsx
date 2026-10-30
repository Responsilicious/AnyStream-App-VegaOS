import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import {
  DEFAULT_VIEW,
  activeFilterCount,
  applyLabel,
  genreLabel,
  pageNoun,
  sameView,
  sortHelp,
  sortLabel,
  sortOptions,
  toggleGenre,
  watchHelp,
  watchLabel,
  watchOptions,
  yearFieldLabel,
  yearLabel,
  yearPresets,
  type MediaPage,
} from '../library/viewState';
import type { LibraryCapabilities, LibraryFacets, LibraryView } from '../providers/types';
import { colors, focus, type } from '../theme';
import { useBack } from '../useBack';
import { FocusButton } from './FocusButton';
import { OptionRow } from './OptionRow';

export type DrawerTab = 'filters' | 'sort';
type Nested = 'genre' | 'watch' | 'year';

interface Props {
  page: MediaPage;
  tab: DrawerTab;
  caps: LibraryCapabilities;
  facets: LibraryFacets;
  applied: LibraryView;
  draft: LibraryView;
  /** Exact match count for the draft, or null when unknown. */
  draftCount: number | null;
  /** Apply is running: the button is disabled so it cannot be sent twice. */
  pending: boolean;
  error: string | null;
  onTab: (tab: DrawerTab) => void;
  onDraft: (draft: LibraryView) => void;
  onApply: () => void;
  /** Close without applying: the draft is thrown away. */
  onClose: () => void;
}

/**
 * The Movies and Series filter and sort panel (docs/library-filters.md). Both tabs edit one draft; nothing reaches
 * the library until Apply, and Back or Close throws the draft away. Genre, watch status and year open their own
 * lists in the same panel, and Back closes such a list first.
 */
export function FilterDrawer({ page, tab, caps, facets, applied, draft, draftCount, pending, error, onTab, onDraft, onApply, onClose }: Props) {
  const s = useScale();
  const [nested, setNested] = useState<Nested | null>(null);
  // The row to focus when a list closes or the tab changes, so focus lands where the user was.
  const [focusId, setFocusId] = useState<string>(() => (tab === 'sort' ? `sort:${draft.sort}` : 'field:genre'));
  const presets = yearPresets(new Date().getFullYear());

  useBack(() => {
    if (nested) {
      closeNested();
    } else {
      onClose();
    }
    return true;
  });

  const closeNested = () => {
    setFocusId(`field:${nested}`);
    setNested(null);
  };

  const setFilters = (filters: LibraryView['filters']) => onDraft({ ...draft, filters });

  const fields = (
    <>
      {caps.genres ? (
        <OptionRow
          kind="field"
          label="Genre"
          value={genreLabel(draft.filters.genreKeys, facets)}
          accessibilityHint={draft.filters.genreKeys.length > 0 ? `${draft.filters.genreKeys.length} selected` : undefined}
          preferred={focusId === 'field:genre'}
          disabled={facets.genres.length === 0}
          help={facets.genres.length === 0 ? 'No genres in this library' : undefined}
          onPress={() => setNested('genre')}
        />
      ) : null}
      {watchOptions(page, caps).length > 0 ? (
        <OptionRow
          kind="field"
          label="Watch status"
          value={watchLabel(draft.filters.watchStatus)}
          preferred={focusId === 'field:watch' || (focusId === 'field:genre' && !caps.genres)}
          onPress={() => setNested('watch')}
        />
      ) : null}
      {caps.years ? (
        <OptionRow
          kind="field"
          label={yearFieldLabel(page)}
          value={yearLabel(draft.filters.year)}
          preferred={focusId === 'field:year'}
          onPress={() => setNested('year')}
        />
      ) : null}
      {!caps.genres && !caps.years && watchOptions(page, caps).length === 0 ? (
        <Text style={styles.note}>This server does not offer filters for this library. You can still change the sort order.</Text>
      ) : null}
    </>
  );

  const sorts = sortOptions(page, caps).map(option => (
    <OptionRow
      key={option}
      kind="radio"
      label={sortLabel(option)}
      help={sortHelp(option, page)}
      selected={draft.sort === option}
      preferred={focusId === `sort:${option}`}
      onPress={() => onDraft({ ...draft, sort: option })}
    />
  ));

  let nestedTitle = '';
  let nestedRows: JSX.Element[] = [];
  if (nested === 'genre') {
    nestedTitle = 'Genre';
    nestedRows = facets.genres.map((genre, i) => (
      <OptionRow
        key={genre.key}
        kind="check"
        label={genre.label}
        selected={draft.filters.genreKeys.includes(genre.key)}
        preferred={i === 0}
        onPress={() => setFilters(toggleGenre(draft.filters, genre.key))}
      />
    ));
  } else if (nested === 'watch') {
    nestedTitle = 'Watch status';
    const current = draft.filters.watchStatus;
    nestedRows = [null, ...watchOptions(page, caps)].map(option => (
      <OptionRow
        key={option ?? 'any'}
        kind="radio"
        label={watchLabel(option)}
        help={option ? watchHelp(option) : undefined}
        selected={current === option}
        preferred={current === option}
        onPress={() => {
          setFilters({ ...draft.filters, watchStatus: option });
          closeNested();
        }}
      />
    ));
  } else if (nested === 'year') {
    nestedTitle = yearFieldLabel(page);
    const current = draft.filters.year;
    const matches = (r: { from: number; to: number } | null) => (r && current ? r.from === current.from && r.to === current.to : r === current);
    const rows = [{ id: 'any', label: 'Any', range: null as { from: number; to: number } | null }, ...presets];
    // A saved range that is not one of the presets still shows, selected, so it is never hidden.
    if (current && !presets.some(p => matches(p.range))) {
      rows.splice(1, 0, { id: 'saved', label: yearLabel(current), range: current });
    }
    nestedRows = rows.map(row => (
      <OptionRow
        key={row.id}
        kind="radio"
        label={row.label}
        selected={matches(row.range)}
        preferred={matches(row.range)}
        onPress={() => {
          setFilters({ ...draft.filters, year: row.range });
          closeNested();
        }}
      />
    ));
  }

  const filterCount = activeFilterCount(draft.filters);
  const isDefault = sameView(draft, DEFAULT_VIEW);

  return (
    <View style={styles.wrap} accessibilityViewIsModal>
      {/* Covers the page behind, so touch or pointer input cannot reach it either. */}
      <Pressable style={styles.scrim} focusable={false} onPress={onClose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={[styles.panel, { width: s(800), paddingHorizontal: s(48), paddingTop: s(28), paddingBottom: s(54) }]}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {nested ? nestedTitle : 'Filters & sort'}
          </Text>
          {nested ? null : <CloseButton onPress={onClose} />}
        </View>
        <Text style={styles.subtitle}>
          {nested === 'genre'
            ? draft.filters.genreKeys.length > 0
              ? `${draft.filters.genreKeys.length} selected · shows titles in any of them`
              : 'Choose one or more'
            : nested
            ? 'Choose one'
            : tab === 'sort'
            ? `Choose how your ${pageNoun(page)} are ordered.`
            : `Changes apply when you select Show ${pageNoun(page)}.`}
        </Text>

        {nested ? null : (
          <View style={styles.tabs} accessibilityRole="tablist">
            <Tab
              label={filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
              selected={tab === 'filters'}
              onPress={() => {
                setFocusId('field:genre');
                onTab('filters');
              }}
            />
            <Tab
              label="Sort"
              selected={tab === 'sort'}
              onPress={() => {
                setFocusId(`sort:${draft.sort}`);
                onTab('sort');
              }}
            />
          </View>
        )}

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {nested ? nestedRows : tab === 'filters' ? fields : sorts}
        </ScrollView>

        {error && !nested ? <Text style={styles.error}>{error}</Text> : null}
        {!nested && filterCount > 0 ? (
          <Text style={styles.selectedCount}>
            {filterCount === 1 ? '1 filter selected' : `${filterCount} filters selected`}
          </Text>
        ) : null}

        <View style={styles.footer}>
          {nested ? (
            <FocusButton label="Done" primary onPress={closeNested} style={styles.footerMain} />
          ) : (
            <>
              <FocusButton
                label={pending ? 'Loading…' : applyLabel(draft, applied, page, draftCount)}
                primary
                disabled={pending}
                onPress={onApply}
                style={styles.footerMain}
              />
              <FocusButton label="Reset" disabled={pending || isDefault} onPress={() => onDraft(DEFAULT_VIEW)} style={styles.footerSide} />
            </>
          )}
          <Text style={styles.backHint}>{nested ? 'Back · Keep choices' : 'Back · Cancel changes'}</Text>
        </View>
        {!nested ? <Text style={styles.footnote}>Reset clears every filter and sets Title A–Z. Nothing changes until you apply.</Text> : null}
      </View>
    </View>
  );
}

/** A plain × in the corner, as in the mockups, with the same white focus ring as every other control. */
function CloseButton({ onPress }: { onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel="Close without applying"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.close, focused && styles.closeFocused]}>
      <Text style={styles.closeMark}>×</Text>
    </Pressable>
  );
}

function Tab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected, focused && styles.tabFocused]}>
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  // Transparent: the grid stays visible as in the mockups, but presses on it close the panel instead of reaching it.
  scrim: { flex: 1 },
  panel: { backgroundColor: '#0E1626', borderLeftWidth: px(2), borderLeftColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: px(72) },
  title: { color: colors.text, fontSize: px(46), fontWeight: '800', flex: 1 },
  close: {
    width: px(64),
    height: px(64),
    borderRadius: px(32),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: px(16),
  },
  closeFocused: { borderColor: colors.focusRing, backgroundColor: colors.surface },
  closeMark: { color: colors.accent, fontSize: px(52), lineHeight: px(58), fontWeight: '300' },
  subtitle: { color: colors.accent, fontSize: px(26), marginTop: px(4), marginBottom: px(20) },
  tabs: {
    flexDirection: 'row',
    marginBottom: px(20),
    borderRadius: px(14),
    borderWidth: px(2),
    borderColor: colors.surfaceFocused,
    padding: px(2),
  },
  tab: {
    flex: 1,
    height: px(60),
    borderRadius: px(12),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: { backgroundColor: colors.accent },
  tabFocused: { borderColor: colors.focusRing },
  tabLabel: { color: colors.textMuted, fontSize: px(28), fontWeight: '700' },
  tabLabelSelected: { color: colors.accentText },
  content: { flex: 1 },
  contentInner: { paddingVertical: px(6) },
  note: { color: colors.textMuted, fontSize: type.body, marginTop: px(8) },
  error: { color: colors.danger, fontSize: type.body, marginTop: px(12) },
  selectedCount: { color: colors.accent, fontSize: px(26), fontWeight: '600', marginTop: px(12) },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: px(16) },
  footerMain: { minWidth: px(280) },
  footerSide: { marginLeft: px(16) },
  backHint: { color: colors.accent, fontSize: type.body, marginLeft: px(16), flexShrink: 1, textAlign: 'right', flex: 1 },
  footnote: { color: colors.textMuted, fontSize: type.caption, marginTop: px(10) },
});
