import type { MediaItem, MediaVersion, StartChoice, TrackSelection } from './providers/types';
import { episodeLabel, formatMeta, formatRuntime, formatRuntimeCompact, formatTimeLeft } from './util/format';

/**
 * Rules for the series and movie pages (docs/title-pages.md). Everything here is plain logic over the
 * user's own progress, so it can be tested without a screen.
 */

/** Season 0 is Jellyfin's Specials. Everything else is a regular season. */
export function isSpecial(episode: MediaItem): boolean {
  return episode.seasonIndex === 0;
}

function order(a: MediaItem, b: MediaItem): number {
  return (a.seasonIndex ?? 1) - (b.seasonIndex ?? 1) || (a.index ?? 0) - (b.index ?? 0);
}

/** Episodes in watching order: regular seasons first, Specials last. */
export function sortEpisodes(episodes: MediaItem[]): MediaItem[] {
  const regular = episodes.filter(e => !isSpecial(e)).sort(order);
  const specials = episodes.filter(isSpecial).sort(order);
  return [...regular, ...specials];
}

export interface SeasonTab {
  /** The season number; 0 for Specials. */
  season: number;
  label: string;
}

/** One tab per season that has episodes: Season 1, Season 2 ..., then Specials. */
export function seasonTabs(episodes: MediaItem[]): SeasonTab[] {
  const seasons = [...new Set(episodes.map(e => e.seasonIndex ?? 1))].sort((a, b) => {
    if (a === 0) {
      return 1;
    }
    if (b === 0) {
      return -1;
    }
    return a - b;
  });
  return seasons.map(season => ({ season, label: season === 0 ? 'Specials' : `Season ${season}` }));
}

export function episodesOfSeason(episodes: MediaItem[], season: number): MediaItem[] {
  return sortEpisodes(episodes.filter(e => (e.seasonIndex ?? 1) === season));
}

/** Started but not finished. */
function isResumable(episode: MediaItem): boolean {
  return episode.resumeMs > 0 && !episode.played;
}

/** The episode played most recently among `candidates`; ties and missing dates fall back to list order. */
function mostRecent(candidates: MediaItem[]): MediaItem | undefined {
  let best: MediaItem | undefined;
  for (const candidate of candidates) {
    if (!best || (candidate.lastPlayed ?? -Infinity) > (best.lastPlayed ?? -Infinity)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The episode to select inside a list: the resumable one (the most recently played, so a deliberate rewatch
 * counts), else the first unwatched, else the first.
 */
export function pickCurrent(episodes: MediaItem[]): MediaItem | undefined {
  const sorted = sortEpisodes(episodes);
  return mostRecent(sorted.filter(isResumable)) ?? sorted.find(e => !e.played) ?? sorted[0];
}

/**
 * The next unwatched episode: the first unwatched one after the episode watched most recently, so a viewer
 * who skipped around is not sent back to an old gap. Falls back to the first unwatched overall.
 */
export function pickNextUnwatched(episodes: MediaItem[]): MediaItem | undefined {
  const regular = sortEpisodes(episodes).filter(e => !isSpecial(e));
  const lastWatched = mostRecent(regular.filter(e => e.played || e.resumeMs > 0));
  const after = lastWatched ? regular.slice(regular.indexOf(lastWatched) + 1) : regular;
  return after.find(e => !e.played) ?? regular.find(e => !e.played);
}

/**
 * Which episode opens selected (docs/title-pages.md section 3). `entryEpisodeId` is set when the user came
 * from a card that stands for one episode: Continue Playing, Up Next or an episode search result.
 * Specials are kept out of the automatic choice unless the series has nothing else.
 */
export function initialEpisode(episodes: MediaItem[], entryEpisodeId?: string): MediaItem | undefined {
  if (entryEpisodeId) {
    const exact = episodes.find(e => e.id === entryEpisodeId);
    if (exact) {
      return exact;
    }
  }
  const regular = sortEpisodes(episodes).filter(e => !isSpecial(e));
  if (regular.length === 0) {
    return sortEpisodes(episodes)[0];
  }
  const resumable = mostRecent(regular.filter(isResumable));
  if (resumable) {
    return resumable;
  }
  const unwatched = pickNextUnwatched(episodes);
  if (unwatched) {
    return unwatched;
  }
  // Never started and fully watched both end up here only when nothing is unwatched: start again from the top.
  return regular[0];
}

/** The episode after `current` in watching order, within the regular seasons. */
export function nextEpisode(episodes: MediaItem[], current: MediaItem): MediaItem | undefined {
  const regular = sortEpisodes(episodes).filter(e => !isSpecial(e));
  const index = regular.findIndex(e => e.id === current.id);
  return index >= 0 ? regular[index + 1] : undefined;
}

export type PlayKind = 'resume' | 'play' | 'replay';

export interface PrimaryAction {
  kind: PlayKind;
  label: string;
}

/** "Resume S1 E4", "Play S1 E5" or "Replay S1 E1": the button names exactly what it will start. */
export function episodePrimary(episode: MediaItem): PrimaryAction {
  const label = episodeLabel(episode);
  const suffix = label ? ` ${label}` : '';
  if (isResumable(episode)) {
    return { kind: 'resume', label: `Resume${suffix}` };
  }
  if (episode.played) {
    return { kind: 'replay', label: `Replay${suffix}` };
  }
  return { kind: 'play', label: `Play${suffix}` };
}

/** Play movie, Resume movie or Play again. */
export function moviePrimary(movie: MediaItem): PrimaryAction {
  if (isResumable(movie)) {
    return { kind: 'resume', label: 'Resume movie' };
  }
  if (movie.played) {
    return { kind: 'replay', label: 'Play again' };
  }
  return { kind: 'play', label: 'Play movie' };
}

/** Whether the secondary Start again action applies: there is a saved position to leave behind. */
export function canStartAgain(item: MediaItem): boolean {
  return isResumable(item);
}

/** The text under an episode card: "Watched", "23 min left" or "48 min · Unwatched". */
export function episodeStatus(episode: MediaItem): string {
  if (episode.played) {
    return 'Watched';
  }
  const left = formatTimeLeft(episode);
  if (left) {
    return left;
  }
  const runtime = formatRuntime(episode.runtimeMs);
  return runtime ? `${runtime}  ·  Unwatched` : 'Unwatched';
}

/** "48 min" or "48 min  ·  23 min left" under the selected episode's description. */
export function episodeRuntimeLine(episode: MediaItem): string {
  return [formatRuntime(episode.runtimeMs), episode.played ? '' : formatTimeLeft(episode)].filter(Boolean).join('  ·  ');
}

/** "2026 · 12 · Sci-Fi · 2 seasons" for the series header. */
export function seriesMeta(series: MediaItem, episodes: MediaItem[]): string {
  const seasons = seasonTabs(episodes).filter(t => t.season !== 0).length;
  const parts: string[] = [];
  if (series.year) {
    parts.push(String(series.year));
  }
  if (series.officialRating) {
    parts.push(series.officialRating);
  }
  if (series.genres && series.genres.length > 0) {
    parts.push(series.genres[0]);
  }
  if (seasons > 0) {
    parts.push(seasons === 1 ? '1 season' : `${seasons} seasons`);
  }
  return parts.join('  ·  ');
}

/** "2025 · 12 · Sci-Fi · 2h 08m" for the movie header (formatMeta also adds the score and more genres). */
export function movieMeta(movie: MediaItem): string {
  const parts: string[] = [];
  if (movie.year) {
    parts.push(String(movie.year));
  }
  if (movie.officialRating) {
    parts.push(movie.officialRating);
  }
  if (movie.genres && movie.genres.length > 0) {
    parts.push(movie.genres[0]);
  }
  const runtime = formatRuntimeCompact(movie.runtimeMs);
  if (runtime) {
    parts.push(runtime);
  }
  return parts.length > 0 ? parts.join('  ·  ') : formatMeta(movie);
}

/**
 * What to hand the player from the title page. Only what differs from the defaults is sent, so an untouched page
 * still allows direct play: the default audio track needs no special stream.
 */
export function startChoice(
  version: MediaVersion | undefined,
  versions: MediaVersion[],
  selection: TrackSelection,
): StartChoice | undefined {
  const choice: StartChoice = {};
  if (version && versions.length > 1) {
    choice.mediaSourceId = version.id;
  }
  if (selection.audioIndex !== undefined && selection.audioIndex !== version?.defaultAudioIndex) {
    choice.audioIndex = selection.audioIndex;
    choice.mediaSourceId = version?.id ?? choice.mediaSourceId;
  }
  if (selection.subtitleIndex >= 0) {
    choice.subtitleIndex = selection.subtitleIndex;
    choice.mediaSourceId = version?.id ?? choice.mediaSourceId;
  }
  return Object.keys(choice).length > 0 ? choice : undefined;
}

/** "English  ·  Subtitles off" or "French  ·  English subtitles": the label of the Audio and subtitles button. */
export function trackSummary(version: MediaVersion | undefined, selection: TrackSelection): string {
  const audio = version?.tracks?.audio.find(a => a.index === selection.audioIndex);
  const subtitle = version?.tracks?.subtitles.find(t => t.index === selection.subtitleIndex);
  const firstPart = (label: string) => label.split('  ·  ')[0];
  return [
    audio ? firstPart(audio.label) : '',
    subtitle ? `${firstPart(subtitle.label)} subtitles` : 'Subtitles off',
  ]
    .filter(Boolean)
    .join('  ·  ');
}

/**
 * A series remembers choices by language, not track number, because each episode is its own file: English
 * subtitles chosen on one episode stay on for the next. `subtitleLanguage` null means subtitles off.
 */
export interface TrackPreference {
  audioLanguage?: string;
  subtitleLanguage: string | null;
}

export const NO_PREFERENCE: TrackPreference = { subtitleLanguage: null };

/** The tracks of `version` that match `preference`: the default audio and no subtitles where nothing matches. */
export function selectionFor(version: MediaVersion | undefined, preference: TrackPreference): TrackSelection {
  const audio = preference.audioLanguage
    ? version?.tracks?.audio.find(a => a.language === preference.audioLanguage)
    : undefined;
  const subtitles = version?.tracks?.subtitles ?? [];
  const subtitle = preference.subtitleLanguage
    ? subtitles.find(t => t.language === preference.subtitleLanguage && !t.isForced) ??
      subtitles.find(t => t.language === preference.subtitleLanguage)
    : undefined;
  return { audioIndex: audio?.index ?? version?.defaultAudioIndex, subtitleIndex: subtitle?.index ?? -1 };
}

/** The preference after choosing tracks on `version`. A track with no language changes only this episode. */
export function updatePreference(
  preference: TrackPreference,
  version: MediaVersion | undefined,
  change: Partial<TrackSelection>,
): TrackPreference {
  const next = { ...preference };
  if (change.audioIndex !== undefined) {
    const audio = version?.tracks?.audio.find(a => a.index === change.audioIndex);
    next.audioLanguage = audio?.language ?? next.audioLanguage;
  }
  if (change.subtitleIndex !== undefined) {
    const subtitle = version?.tracks?.subtitles.find(t => t.index === change.subtitleIndex);
    next.subtitleLanguage = change.subtitleIndex < 0 ? null : subtitle?.language ?? next.subtitleLanguage;
  }
  return next;
}

/** Whether there is anything to choose: a second audio track or any subtitle. */
export function hasTrackChoices(version: MediaVersion | undefined): boolean {
  return (version?.tracks?.audio.length ?? 0) > 1 || (version?.tracks?.subtitles.length ?? 0) > 0;
}

/** Progress as 0 to 1, or 0 when there is none to show. */
export function progressOf(item: MediaItem): number {
  return isResumable(item) && item.runtimeMs ? Math.min(1, item.resumeMs / item.runtimeMs) : 0;
}
