import {
  canStartAgain,
  episodePrimary,
  episodeRuntimeLine,
  episodeStatus,
  episodesOfSeason,
  initialEpisode,
  moviePrimary,
  movieMeta,
  nextEpisode,
  pickCurrent,
  pickNextUnwatched,
  progressOf,
  seasonTabs,
  seriesMeta,
  sortEpisodes,
} from '../src/titlePage';
import type { MediaItem } from '../src/providers/types';

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const ep = (season: number, index: number, extra: Partial<MediaItem> = {}): MediaItem => ({
  id: `s${season}e${index}`,
  title: `Episode ${index}`,
  kind: 'episode',
  seasonIndex: season,
  index,
  resumeMs: 0,
  played: false,
  runtimeMs: 48 * MIN,
  ...extra,
});

const watched = (season: number, index: number, daysAgo = 10): MediaItem =>
  ep(season, index, { played: true, lastPlayed: Date.UTC(2026, 9, 29) - daysAgo * DAY });

const partial = (season: number, index: number, minutes: number, daysAgo = 1): MediaItem =>
  ep(season, index, { resumeMs: minutes * MIN, lastPlayed: Date.UTC(2026, 9, 29) - daysAgo * DAY });

const show = [ep(1, 1), ep(1, 2), ep(1, 3), ep(1, 4), ep(2, 1), ep(2, 2)];

describe('ordering and seasons', () => {
  it('sorts by season then episode, with Specials last', () => {
    const mixed = [ep(2, 1), ep(0, 1), ep(1, 2), ep(1, 1)];
    expect(sortEpisodes(mixed).map(e => e.id)).toEqual(['s1e1', 's1e2', 's2e1', 's0e1']);
  });

  it('lists a tab per season with Specials last, and only seasons that have episodes', () => {
    expect(seasonTabs([ep(0, 1), ep(2, 1), ep(1, 1), ep(1, 2)])).toEqual([
      { season: 1, label: 'Season 1' },
      { season: 2, label: 'Season 2' },
      { season: 0, label: 'Specials' },
    ]);
  });

  it('returns the episodes of one season in order', () => {
    expect(episodesOfSeason([ep(1, 2), ep(2, 1), ep(1, 1)], 1).map(e => e.id)).toEqual(['s1e1', 's1e2']);
  });
});

describe('initialEpisode: where the user came from', () => {
  it('selects the exact episode a card stands for, whatever the history says', () => {
    const episodes = [watched(1, 1), watched(1, 2), partial(1, 3, 10), ep(1, 4)];
    expect(initialEpisode(episodes, 's1e2')?.id).toBe('s1e2');
    expect(initialEpisode(episodes, 's1e4')?.id).toBe('s1e4');
  });

  it('falls back to the general rule when the episode is not in the list', () => {
    const episodes = [watched(1, 1), partial(1, 2, 10)];
    expect(initialEpisode(episodes, 'gone')?.id).toBe('s1e2');
  });

  it('general card: the resumable episode, the most recently played one', () => {
    const episodes = [watched(1, 1), partial(1, 2, 10, 5), partial(1, 4, 20, 1), ep(1, 5)];
    expect(initialEpisode(episodes)?.id).toBe('s1e4');
  });

  it('general card with nothing in progress: the next unwatched after the last one watched', () => {
    const episodes = [ep(1, 1), watched(1, 2, 5), ep(1, 3), watched(1, 4, 2), ep(1, 5)];
    // The gap at E1 is old; the viewer is up to E5.
    expect(initialEpisode(episodes)?.id).toBe('s1e5');
  });

  it('next unwatched crosses into the next season', () => {
    const episodes = [watched(1, 1), watched(1, 2), ep(2, 1), ep(2, 2)];
    expect(initialEpisode(episodes)?.id).toBe('s2e1');
  });

  it('a series never started opens on the first regular episode, not a special', () => {
    expect(initialEpisode([ep(0, 1), ep(1, 1), ep(1, 2)])?.id).toBe('s1e1');
  });

  it('a fully watched series opens on the first regular episode, ready to replay', () => {
    const episodes = [watched(1, 1), watched(1, 2), watched(2, 1)];
    const chosen = initialEpisode(episodes);
    expect(chosen?.id).toBe('s1e1');
    expect(episodePrimary(chosen as MediaItem)).toEqual({ kind: 'replay', label: 'Replay S1 E1' });
  });

  it('uses a special only when the series has nothing else', () => {
    expect(initialEpisode([ep(0, 1), ep(0, 2)])?.id).toBe('s0e1');
    expect(initialEpisode([])).toBeUndefined();
  });
});

describe('pickCurrent and pickNextUnwatched', () => {
  it('changing season: the resumable episode, else the first unwatched, else the first', () => {
    expect(pickCurrent([watched(2, 1), partial(2, 2, 5), ep(2, 3)])?.id).toBe('s2e2');
    expect(pickCurrent([watched(2, 1), ep(2, 2), ep(2, 3)])?.id).toBe('s2e2');
    expect(pickCurrent([watched(2, 1), watched(2, 2)])?.id).toBe('s2e1');
  });

  it('next unwatched is undefined when everything is watched', () => {
    expect(pickNextUnwatched([watched(1, 1), watched(1, 2)])).toBeUndefined();
  });

  it('finds the episode after the current one, never a special', () => {
    expect(nextEpisode(show, show[0])?.id).toBe('s1e2');
    expect(nextEpisode(show, show[3])?.id).toBe('s2e1');
    expect(nextEpisode(show, show[5])).toBeUndefined();
    expect(nextEpisode([...show, ep(0, 1)], show[5])).toBeUndefined();
  });
});

describe('primary actions', () => {
  it('names the target of an episode button', () => {
    expect(episodePrimary(partial(1, 4, 10))).toEqual({ kind: 'resume', label: 'Resume S1 E4' });
    expect(episodePrimary(ep(1, 5))).toEqual({ kind: 'play', label: 'Play S1 E5' });
    expect(episodePrimary(watched(1, 1))).toEqual({ kind: 'replay', label: 'Replay S1 E1' });
  });

  it('names the movie action by state', () => {
    const base: MediaItem = { id: 'm', title: 'M', kind: 'movie', resumeMs: 0, played: false };
    expect(moviePrimary(base).label).toBe('Play movie');
    expect(moviePrimary({ ...base, resumeMs: 5 * MIN }).label).toBe('Resume movie');
    expect(moviePrimary({ ...base, played: true }).label).toBe('Play again');
  });

  it('offers Start again only with a saved position', () => {
    expect(canStartAgain(partial(1, 4, 10))).toBe(true);
    expect(canStartAgain(ep(1, 4))).toBe(false);
    expect(canStartAgain(watched(1, 4))).toBe(false);
  });
});

describe('text', () => {
  it('writes each episode card status', () => {
    expect(episodeStatus(watched(1, 1))).toBe('Watched');
    expect(episodeStatus(partial(1, 4, 25))).toBe('23 min left');
    expect(episodeStatus(ep(1, 5))).toBe('48 min  ·  Unwatched');
    expect(episodeStatus({ ...ep(1, 5), runtimeMs: undefined })).toBe('Unwatched');
  });

  it('writes the runtime line of the selected episode', () => {
    expect(episodeRuntimeLine(partial(1, 4, 25))).toBe('48 min  ·  23 min left');
    expect(episodeRuntimeLine(ep(1, 5))).toBe('48 min');
    expect(episodeRuntimeLine(watched(1, 1))).toBe('48 min');
  });

  it('writes the series header from its episodes, not counting Specials', () => {
    const series: MediaItem = {
      id: 's',
      title: 'Show',
      kind: 'series',
      resumeMs: 0,
      played: false,
      year: 2026,
      officialRating: '12',
      genres: ['Sci-Fi', 'Drama'],
    };
    expect(seriesMeta(series, [...show, ep(0, 1)])).toBe('2026  ·  12  ·  Sci-Fi  ·  2 seasons');
    expect(seriesMeta(series, [ep(1, 1)])).toBe('2026  ·  12  ·  Sci-Fi  ·  1 season');
    expect(seriesMeta({ ...series, genres: undefined, officialRating: undefined }, [])).toBe('2026');
  });

  it('writes the movie header', () => {
    const movie: MediaItem = {
      id: 'm',
      title: 'M',
      kind: 'movie',
      resumeMs: 0,
      played: false,
      year: 2025,
      officialRating: '12',
      genres: ['Sci-Fi', 'Drama'],
      runtimeMs: 128 * MIN,
    };
    expect(movieMeta(movie)).toBe('2025  ·  12  ·  Sci-Fi  ·  2h 08m');
  });

  it('measures progress only for something started and not finished', () => {
    expect(progressOf(partial(1, 4, 24))).toBe(0.5);
    expect(progressOf(ep(1, 4))).toBe(0);
    expect(progressOf(watched(1, 4))).toBe(0);
  });
});
