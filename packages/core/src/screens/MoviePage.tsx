import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { BackLink, FactRow, PreviewImage, ProgressBar, QualityBadges, VersionPicker } from '../components/TitleParts';
import { TopBar } from '../components/TopBar';
import { WideCard } from '../components/WideCard';
import { px, useScale } from '../layout';
import type { Section } from '../navigation';
import { TrackMenu } from '../components/TrackMenu';
import type { MediaItem, MediaProvider, MediaVersion, StartChoice, TrackSelection } from '../providers/types';
import {
  canStartAgain,
  hasTrackChoices,
  moviePrimary,
  movieMeta,
  progressOf,
  startChoice,
  trackSummary,
} from '../titlePage';
import { colors, type } from '../theme';
import { formatRuntimeCompact, formatTimeLeft } from '../util/format';

interface Props {
  provider: MediaProvider;
  /** The poster or card that was chosen: shown straight away while the full record loads. */
  item: MediaItem;
  nav: { active: Section; profileName: string; backLabel: string; onSection: (section: Section) => void };
  /** `choice` carries the version and tracks picked on this page, when they differ from the defaults. */
  onPlay: (item: MediaItem, choice?: StartChoice) => void;
  /** A title in More like this was chosen. */
  onOpen: (item: MediaItem) => void;
  onBack: () => void;
}

/**
 * The movie page (docs/title-pages.md): facts, synopsis, director and cast, saved progress and the actions on
 * the left, a still on the right, More like this beneath. Playback stays off until the user's own progress
 * has loaded, so the button never says Play over a half-watched film.
 */
export function MoviePage({ provider, item, nav, onPlay, onOpen, onBack }: Props) {
  const s = useScale();
  const [movie, setMovie] = useState<MediaItem | null>(null);
  const [similar, setSimilar] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<MediaVersion[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TrackSelection>({ subtitleIndex: -1 });
  const [tracksOpen, setTracksOpen] = useState(false);

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
    setVersions([]);
    provider
      .getVersions(item.id)
      .then(found => {
        if (!cancelled && found.length > 0) {
          setVersions(found);
          setVersionId(found[0].id);
          setSelection({ audioIndex: found[0].defaultAudioIndex, subtitleIndex: -1 });
        }
      })
      .catch(() => {
        // Without versions the page plays the server's default and offers no badges or track choices.
      });
    return () => {
      cancelled = true;
    };
  }, [provider, item.id, attempt]);

  const version = versions.find(v => v.id === versionId) ?? versions[0];

  const chooseVersion = useCallback((next: MediaVersion) => {
    setVersionId(next.id);
    // Track numbers belong to one file, so a new version starts from its own defaults.
    setSelection({ audioIndex: next.defaultAudioIndex, subtitleIndex: -1 });
  }, []);

  const chooseTracks = useCallback((change: Partial<TrackSelection>) => {
    setSelection(current => ({ ...current, ...change }));
  }, []);

  const closeTracks = useCallback(() => setTracksOpen(false), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setMovie(null);
    provider
      .getItem(item.id)
      .then(loaded => {
        if (!cancelled) {
          setMovie(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load this title.');
        }
      });
    provider
      .getSimilar(item.id)
      .then(found => {
        if (!cancelled) {
          setSimilar(found);
        }
      })
      .catch(() => {
        // More like this is a nicety: without it the page simply ends after the actions.
      });
    return () => {
      cancelled = true;
    };
  }, [provider, item.id, attempt]);

  const toggleFavorite = useCallback(async () => {
    if (!movie) {
      return;
    }
    const wanted = !movie.favorite;
    setMovie({ ...movie, favorite: wanted });
    try {
      await provider.setFavorite(movie.id, wanted);
    } catch {
      setMovie(current => (current ? { ...current, favorite: !wanted } : current));
    }
  }, [movie, provider]);

  const toggleWatched = useCallback(async () => {
    if (!movie || busy) {
      return;
    }
    const wanted = !movie.played;
    setBusy(true);
    try {
      await provider.setPlayed(movie.id, wanted);
      // Watched clears the saved position on the server; mirror that here instead of waiting for a reload.
      setMovie({ ...movie, played: wanted, resumeMs: 0 });
    } catch {
      // Leave the state as it was: the button simply did nothing.
    } finally {
      setBusy(false);
    }
  }, [busy, movie, provider]);

  // A chosen version may run longer or shorter (a director's cut), so its runtime wins.
  const base = movie ?? item;
  const shown = version?.runtimeMs ? { ...base, runtimeMs: version.runtimeMs } : base;
  const primary = movie ? moviePrimary(movie) : undefined;
  const left = movie ? formatTimeLeft(movie) : '';
  const gap = s(24);
  const choice = startChoice(version, versions, selection);

  if (tracksOpen && version) {
    return (
      <View style={styles.screen}>
        <PreviewImage uri={shown.landscapeUrl ?? shown.backdropUrl} />
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
              {shown.title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {movieMeta(shown)}
            </Text>
            <QualityBadges badges={version?.badges} />
            {shown.overview ? (
              <Text style={styles.synopsis} numberOfLines={3}>
                {shown.overview}
              </Text>
            ) : null}
            {shown.directors ? <FactRow label="Director">{shown.directors.slice(0, 2).join(', ')}</FactRow> : null}
            {shown.cast ? <FactRow label="Starring">{shown.cast.slice(0, 4).join(', ')}</FactRow> : null}

            {movie && progressOf(movie) > 0 ? (
              <View style={styles.progress}>
                <ProgressBar progress={progressOf(movie)} width={s(460)} />
                <Text style={styles.left}>{left}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.error}>{error}</Text>
                <FocusButton label="Retry" primary preferred onPress={() => setAttempt(n => n + 1)} style={styles.action} />
              </View>
            ) : null}
            {!error && !movie ? <ActivityIndicator color={colors.accent} size="large" style={styles.spinner} /> : null}

            {movie && primary ? (
              <View style={styles.actions}>
                <FocusButton
                  label={primary.label}
                  primary
                  preferred
                  onPress={() => onPlay(primary.kind === 'replay' ? { ...movie, resumeMs: 0 } : movie, choice)}
                  style={styles.action}
                />
                {canStartAgain(movie) ? (
                  <FocusButton label="Start again" onPress={() => onPlay({ ...movie, resumeMs: 0 }, choice)} style={styles.action} />
                ) : null}
                {hasTrackChoices(version) ? (
                  <FocusButton
                    label={trackSummary(version, selection)}
                    onPress={() => setTracksOpen(true)}
                    style={styles.action}
                  />
                ) : null}
                <FocusButton
                  label={movie.favorite ? 'Favourited' : 'Favourite'}
                  onPress={() => void toggleFavorite()}
                  style={styles.action}
                />
                <FocusButton
                  label={movie.played ? 'Mark unwatched' : 'Mark watched'}
                  disabled={busy}
                  onPress={() => void toggleWatched()}
                  style={styles.action}
                />
              </View>
            ) : null}

            {movie ? <VersionPicker versions={versions} selectedId={version?.id} onChoose={chooseVersion} /> : null}
          </View>

          <PreviewImage uri={shown.landscapeUrl ?? shown.backdropUrl} />
        </View>

        {similar.length > 0 ? (
          <View style={styles.related}>
            <Text style={[styles.heading, { paddingHorizontal: s(96) }]}>More like this</Text>
            <FlatList
              horizontal
              data={similar}
              keyExtractor={m => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: s(96), paddingVertical: px(8) }}
              ItemSeparatorComponent={() => <View style={{ width: gap }} />}
              renderItem={({ item: related }) => (
                <WideCard
                  title={related.title}
                  subtitle={[related.year ? String(related.year) : '', formatRuntimeCompact(related.runtimeMs)]
                    .filter(Boolean)
                    .join('  ·  ')}
                  imageUrl={related.landscapeUrl}
                  onPress={() => onOpen(related)}
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
  synopsis: { color: colors.text, fontSize: type.body, lineHeight: Math.round(type.body * 1.35), marginTop: px(10), marginBottom: px(8) },
  progress: { marginTop: px(14), flexDirection: 'row', alignItems: 'center' },
  left: { color: colors.text, fontSize: type.body, marginLeft: px(16) },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(16) },
  action: { marginRight: px(14), marginBottom: px(8) },
  spinner: { marginTop: px(32), alignSelf: 'flex-start' },
  errorBox: { marginTop: px(16) },
  error: { color: colors.danger, fontSize: type.body },
  related: { marginTop: px(20) },
  heading: { color: colors.text, fontSize: type.title, fontWeight: '800', marginBottom: px(6) },
});
