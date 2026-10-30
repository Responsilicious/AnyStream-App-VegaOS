import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EpisodeCard } from '../components/EpisodeCard';
import { FocusButton } from '../components/FocusButton';
import { BackLink, PreviewImage, ProgressBar, QualityBadges, VersionPicker } from '../components/TitleParts';
import { TopBar } from '../components/TopBar';
import { TrackMenu } from '../components/TrackMenu';
import { px, useScale } from '../layout';
import type { Section } from '../navigation';
import { describeError } from '../providers/jellyfin';
import type { MediaItem, MediaProvider, MediaVersion, StartChoice, TrackSelection } from '../providers/types';
import {
  canStartAgain,
  episodePrimary,
  episodeRuntimeLine,
  episodesOfSeason,
  hasTrackChoices,
  initialEpisode,
  NO_PREFERENCE,
  nextEpisode,
  pickCurrent,
  progressOf,
  seasonTabs,
  selectionFor,
  seriesMeta,
  startChoice,
  trackSummary,
  updatePreference,
  type TrackPreference,
} from '../titlePage';
import { colors, focus, type } from '../theme';
import { episodeLabel } from '../util/format';

interface Props {
  provider: MediaProvider;
  /** The series. May be a stub from a card; the full record is fetched. */
  series: MediaItem;
  /** Set when the user came from a card that stands for one episode (Continue Playing, Up Next, a search hit). */
  entryEpisodeId?: string;
  nav: { active: Section; profileName: string; backLabel: string; onSection: (section: Section) => void };
  /** `choice` carries the version and tracks picked on this page, when they differ from the defaults. */
  onPlay: (episode: MediaItem, choice?: StartChoice) => void;
  onBack: () => void;
  /** Copies of this title on other servers ("Also on Plex"); opens the chooser that asks before switching. */
  alsoOn?: { label: string; onPress: () => void };
}

/**
 * The series page (docs/title-pages.md): identity and synopsis on the left, the selected episode's details and
 * actions beneath, a still of that episode on the right, and a season selector over an episode row. Selecting
 * an episode changes everything about the selection at once and never plays it.
 */
export function SeriesPage({ provider, series, entryEpisodeId, nav, onPlay, onBack, alsoOn }: Props) {
  const s = useScale();
  const [full, setFull] = useState<MediaItem>(series);
  const [episodes, setEpisodes] = useState<MediaItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [season, setSeason] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [favorite, setFavorite] = useState(!!series.favorite);
  // Bumped when an episode is selected, so the primary button is recreated and takes focus: the next step is obvious.
  const [focusNonce, setFocusNonce] = useState(0);
  const listRef = useRef<FlatList<MediaItem>>(null);
  const [versions, setVersions] = useState<MediaVersion[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TrackSelection>({ subtitleIndex: -1 });
  const [tracksOpen, setTracksOpen] = useState(false);
  // Kept by language for the whole visit, so each newly selected episode starts with the same audio and subtitles.
  const preference = useRef<TrackPreference>(NO_PREFERENCE);

  useEffect(() => {
    // The track panel has its own Back handler, which closes it; the page's only applies while it is shut.
    if (tracksOpen) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack, tracksOpen]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEpisodes(null);
    provider
      .getItem(series.id)
      .then(loaded => {
        if (!cancelled) {
          setFull(loaded);
          setFavorite(!!loaded.favorite);
        }
      })
      .catch(() => {
        // The stub already names the series; the header just has less in it.
      });
    provider
      .getEpisodes(series.id)
      .then(found => {
        if (cancelled) {
          return;
        }
        const first = initialEpisode(found, entryEpisodeId);
        setEpisodes(found);
        setSelectedId(first?.id);
        setSeason(first?.seasonIndex ?? 1);
      })
      .catch(e => {
        if (!cancelled) {
          setError(describeError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, series.id, entryEpisodeId, attempt]);

  const selected = useMemo(() => episodes?.find(e => e.id === selectedId), [episodes, selectedId]);

  // Each episode is its own file with its own versions and tracks.
  useEffect(() => {
    let cancelled = false;
    setVersions([]);
    setVersionId(null);
    setSelection({ subtitleIndex: -1 });
    if (!selectedId) {
      return undefined;
    }
    provider
      .getVersions(selectedId)
      .then(found => {
        if (!cancelled && found.length > 0) {
          setVersions(found);
          setVersionId(found[0].id);
          setSelection(selectionFor(found[0], preference.current));
        }
      })
      .catch(() => {
        // Without versions the episode plays the server's defaults and the page offers no badges or track choices.
      });
    return () => {
      cancelled = true;
    };
  }, [provider, selectedId]);

  const version = versions.find(v => v.id === versionId) ?? versions[0];

  const chooseVersion = useCallback((next: MediaVersion) => {
    setVersionId(next.id);
    setSelection(selectionFor(next, preference.current));
  }, []);

  const chooseTracks = useCallback(
    (change: Partial<TrackSelection>) => {
      preference.current = updatePreference(preference.current, version, change);
      setSelection(current => ({ ...current, ...change }));
    },
    [version],
  );

  const closeTracks = useCallback(() => setTracksOpen(false), []);

  // The next episode is a different file: look up its tracks so it plays with the same languages.
  const playNext = useCallback(
    async (episode: MediaItem) => {
      try {
        const found = await provider.getVersions(episode.id);
        onPlay(episode, startChoice(found[0], found, selectionFor(found[0], preference.current)));
      } catch {
        onPlay(episode);
      }
    },
    [onPlay, provider],
  );
  const tabs = useMemo(() => (episodes ? seasonTabs(episodes) : []), [episodes]);
  const row = useMemo(() => (episodes ? episodesOfSeason(episodes, season) : []), [episodes, season]);
  const next = selected && episodes ? nextEpisode(episodes, selected) : undefined;

  // Keep the selected card in view when the selection or season changes, and after the track panel closes
  // (the page is drawn afresh then).
  useEffect(() => {
    const index = row.findIndex(e => e.id === selectedId);
    if (index >= 0 && !tracksOpen) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    }
  }, [row, selectedId, tracksOpen]);

  const chooseSeason = useCallback(
    (number: number) => {
      if (!episodes) {
        return;
      }
      setSeason(number);
      setSelectedId(pickCurrent(episodesOfSeason(episodes, number))?.id);
    },
    [episodes],
  );

  const toggleFavorite = useCallback(async () => {
    const wanted = !favorite;
    setFavorite(wanted);
    try {
      await provider.setFavorite(series.id, wanted);
    } catch {
      setFavorite(!wanted);
    }
  }, [favorite, provider, series.id]);

  const primary = selected ? episodePrimary(selected) : undefined;
  const cardWidth = s(320) + 2 * focus.borderWidth;
  const gap = s(24);
  const choice = startChoice(version, versions, selection);

  if (tracksOpen && version) {
    return (
      <View style={styles.screen}>
        <PreviewImage uri={selected?.landscapeUrl ?? selected?.thumbUrl ?? full.landscapeUrl ?? full.backdropUrl} />
        <TrackMenu
          tracks={version.tracks}
          selection={selection}
          busy={false}
          error={null}
          onChoose={chooseTracks}
          onClose={closeTracks}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopBar active={nav.active} profileName={nav.profileName} onSelect={nav.onSection} />
      <ScrollView contentContainerStyle={{ paddingBottom: s(60) }}>
        <View style={{ paddingHorizontal: s(96) }}>
          <BackLink label={nav.backLabel} onPress={onBack} />
        </View>

        <View style={[styles.main, { paddingHorizontal: s(96) }]}>
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {full.title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {seriesMeta(full, episodes ?? [])}
            </Text>
            {full.overview ? (
              <Text style={styles.synopsis} numberOfLines={2}>
                {full.overview}
              </Text>
            ) : null}

            {selected ? (
              <View style={styles.selection}>
                <Text style={styles.eyebrow}>SELECTED EPISODE</Text>
                <Text style={styles.episodeTitle} numberOfLines={1}>
                  {[episodeLabel(selected), selected.title].filter(Boolean).join('  ·  ')}
                </Text>
                {selected.overview ? (
                  <Text style={styles.episodeText} numberOfLines={3}>
                    {selected.overview}
                  </Text>
                ) : null}
                <Text style={styles.runtime}>
                  {episodeRuntimeLine(version?.runtimeMs ? { ...selected, runtimeMs: version.runtimeMs } : selected)}
                </Text>
                <QualityBadges badges={version?.badges} />
                <ProgressBar progress={progressOf(selected)} width={s(460)} />
              </View>
            ) : null}

            {error ? (
              <View style={styles.selection}>
                <Text style={styles.error}>{error}</Text>
                <FocusButton label="Retry" primary preferred onPress={() => setAttempt(n => n + 1)} style={styles.action} />
              </View>
            ) : null}
            {!error && episodes === null ? (
              <ActivityIndicator color={colors.accent} size="large" style={styles.spinner} />
            ) : null}
            {!error && episodes !== null && episodes.length === 0 ? (
              <Text style={styles.episodeText}>No episodes found for this series.</Text>
            ) : null}

            {selected && primary && episodes !== null ? (
              <View style={styles.actions}>
                <FocusButton
                  key={`play-${selectedId}-${focusNonce}`}
                  label={primary.label}
                  primary
                  preferred
                  onPress={() => onPlay(primary.kind === 'replay' ? { ...selected, resumeMs: 0 } : selected, choice)}
                  style={styles.action}
                />
                {canStartAgain(selected) ? (
                  <FocusButton
                    label="Start episode again"
                    onPress={() => onPlay({ ...selected, resumeMs: 0 }, choice)}
                    style={styles.action}
                  />
                ) : null}
                {selected.played && next ? (
                  <FocusButton
                    label={`Play next ${episodeLabel(next)}`}
                    onPress={() => void playNext(next)}
                    style={styles.action}
                  />
                ) : null}
                {hasTrackChoices(version) ? (
                  <FocusButton
                    label={trackSummary(version, selection)}
                    onPress={() => setTracksOpen(true)}
                    style={styles.action}
                  />
                ) : null}
                <FocusButton label={favorite ? 'Favourited' : 'Favourite'} onPress={() => void toggleFavorite()} style={styles.action} />
                {alsoOn ? <FocusButton label={alsoOn.label} onPress={alsoOn.onPress} style={styles.action} /> : null}
              </View>
            ) : null}
            {selected && episodes !== null ? (
              <VersionPicker versions={versions} selectedId={version?.id} onChoose={chooseVersion} />
            ) : null}
          </View>

          <PreviewImage uri={selected?.landscapeUrl ?? selected?.thumbUrl ?? full.landscapeUrl ?? full.backdropUrl} />
        </View>

        {episodes !== null && episodes.length > 0 ? (
          <View style={styles.episodes}>
            <View style={[styles.episodesHeader, { paddingHorizontal: s(96) }]}>
              <Text style={styles.heading}>Episodes</Text>
              <View style={styles.chips}>
                {tabs.map(tab => (
                  <FocusButton
                    key={tab.season}
                    label={tab.label}
                    primary={tab.season === season}
                    onPress={() => chooseSeason(tab.season)}
                    style={styles.chip}
                  />
                ))}
              </View>
            </View>
            <FlatList
              ref={listRef}
              horizontal
              data={row}
              keyExtractor={e => e.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: s(96), paddingVertical: px(8) }}
              ItemSeparatorComponent={() => <View style={{ width: gap }} />}
              getItemLayout={(_, index) => ({ length: cardWidth + gap, offset: (cardWidth + gap) * index, index })}
              renderItem={({ item }) => (
                <EpisodeCard
                  episode={item}
                  selected={item.id === selectedId}
                  onPress={() => {
                    setSelectedId(item.id);
                    setFocusNonce(n => n + 1);
                  }}
                />
              )}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  main: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: px(4) },
  info: { flex: 1, paddingRight: px(48) },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  meta: { color: colors.text, fontSize: type.body, marginTop: px(6) },
  synopsis: { color: colors.text, fontSize: type.body, lineHeight: Math.round(type.body * 1.35), marginTop: px(8) },
  selection: { marginTop: px(16) },
  eyebrow: { color: colors.accent, fontSize: type.caption, fontWeight: '800', letterSpacing: 1 },
  episodeTitle: { color: colors.text, fontSize: type.title, fontWeight: '800', marginTop: px(4) },
  episodeText: { color: colors.text, fontSize: type.body, lineHeight: Math.round(type.body * 1.35), marginTop: px(6) },
  runtime: { color: colors.text, fontSize: type.body, marginTop: px(8), marginBottom: px(6) },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(14) },
  action: { marginRight: px(14), marginBottom: px(8) },
  spinner: { marginTop: px(32), alignSelf: 'flex-start' },
  error: { color: colors.danger, fontSize: type.body },
  episodes: { marginTop: px(12) },
  episodesHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: px(6) },
  heading: { color: colors.text, fontSize: type.title, fontWeight: '800', marginRight: px(24) },
  chips: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  chip: { marginRight: px(12), minHeight: px(52), paddingHorizontal: px(24) },
});
