import type { MediaItem } from '../providers/types';

/** "2 h 16 min", "45 min", or "" when the runtime is unknown. */
export function formatRuntime(ms: number | undefined): string {
  if (!ms || ms < 60000) {
    return '';
  }
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** "2h 08m" or "48 min": the compact runtime the title pages use. */
export function formatRuntimeCompact(ms: number | undefined): string {
  if (!ms || ms < 60000) {
    return '';
  }
  const total = Math.round(ms / 60000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours}h ${minutes < 10 ? `0${minutes}` : minutes}m`;
}

/** One line under a title: year, age rating, runtime, score, then up to three genres. */
export function formatMeta(item: MediaItem): string {
  const parts: string[] = [];
  if (item.year) {
    parts.push(String(item.year));
  }
  if (item.officialRating) {
    parts.push(item.officialRating);
  }
  const runtime = formatRuntime(item.runtimeMs);
  if (runtime) {
    parts.push(runtime);
  }
  if (item.communityRating) {
    parts.push(`${item.communityRating.toFixed(1)}/10`);
  }
  if (item.genres && item.genres.length > 0) {
    parts.push(item.genres.slice(0, 3).join(', '));
  }
  return parts.join('  ·  ');
}

/** "S2 E5" for an episode row; falls back to whichever number is known. */
export function episodeLabel(item: MediaItem): string {
  const season = item.seasonIndex !== undefined ? `S${item.seasonIndex}` : '';
  const episode = item.index !== undefined ? `E${item.index}` : '';
  return [season, episode].filter(Boolean).join(' ');
}

/** The headline on a card: a series name for its episodes, otherwise the title itself. */
export function cardTitle(item: MediaItem): string {
  return item.seriesTitle ?? item.title;
}

/** "23 min left" for something part-watched, or "" when it is not. Never says less than 1 min. */
export function formatTimeLeft(item: MediaItem): string {
  if (!item.runtimeMs || item.resumeMs <= 0) {
    return '';
  }
  const leftMs = item.runtimeMs - item.resumeMs;
  if (leftMs <= 0) {
    return '';
  }
  return `${Math.max(1, Math.round(leftMs / 60000))} min left`;
}

/** Under a Continue Playing card's title: "S2 E4 · Episode title" for an episode, the year for a film. */
export function continueSubtitle(item: MediaItem): string {
  return item.kind === 'episode' ? upNextSubtitle(item) : item.year ? String(item.year) : '';
}

/** The line under that: how much is left, "10 min left". */
export function continueCaption(item: MediaItem): string {
  return formatTimeLeft(item);
}

/** Under an Up Next card: "S2 E2 · The Crossing". */
export function upNextSubtitle(item: MediaItem): string {
  return [episodeLabel(item), item.title].filter(Boolean).join('  ·  ');
}

/** Under a Recently Added card: the year, or the episode label for an episode. */
export function recentSubtitle(item: MediaItem): string {
  if (item.kind === 'episode') {
    return upNextSubtitle(item);
  }
  return item.year ? String(item.year) : '';
}

/** The word before the year on a result card: Movie, Series, Episode, or Documentary for a documentary. */
export function typeLabel(item: MediaItem): string {
  if (item.genres?.some(g => g.toLowerCase() === 'documentary')) {
    return 'Documentary';
  }
  switch (item.kind) {
    case 'movie':
      return 'Movie';
    case 'series':
      return 'Series';
    case 'episode':
      return 'Episode';
    case 'season':
      return 'Season';
    default:
      return '';
  }
}

/** "Series · 2026", as under the cards on the Genres and Search screens. */
export function typeYearSubtitle(item: MediaItem): string {
  return [typeLabel(item), item.year ? String(item.year) : ''].filter(Boolean).join('  ·  ');
}
