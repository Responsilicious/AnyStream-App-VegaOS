import {
  buildHome,
  cardActions,
  CONTINUE_RULES,
  continueKey,
  initialFeatured,
  isEmpty,
  selectContinuePlaying,
  type HomeData,
} from '../src/home';
import type { MediaItem } from '../src/providers/types';
import {
  cardTitle,
  continueCaption,
  continueSubtitle,
  formatTimeLeft,
  recentSubtitle,
  upNextSubtitle,
} from '../src/util/format';

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

const lib = (id: string, name = `Library ${id}`) => ({ id, name, kind: 'movies' as const });
const row = (id: string, items: MediaItem[]) => ({ library: lib(id), items });

const movie = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  title: `Movie ${id}`,
  kind: 'movie',
  resumeMs: 0,
  played: false,
  ...extra,
});

const episode = (id: string, seriesId: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  title: `Episode ${id}`,
  kind: 'episode',
  seriesId,
  seriesTitle: `Show ${seriesId}`,
  seasonIndex: 1,
  index: 2,
  resumeMs: 0,
  played: false,
  ...extra,
});

/** An episode with 45 minutes of runtime, `watchedMin` minutes in, played `ago` ms before NOW. */
const watchedEpisode = (id: string, seriesId: string, watchedMin: number, ago: number, extra: Partial<MediaItem> = {}) =>
  episode(id, seriesId, { runtimeMs: 45 * MIN, resumeMs: watchedMin * MIN, lastPlayed: NOW - ago, ...extra });

const watchedMovie = (id: string, runtimeMin: number, watchedMin: number, ago: number) =>
  movie(id, { runtimeMs: runtimeMin * MIN, resumeMs: watchedMin * MIN, lastPlayed: NOW - ago });

const empty: HomeData = { continuePlaying: [], continueMore: [], upNext: [], recentlyAdded: [], genres: [] };

describe('selectContinuePlaying', () => {
  it('shows one card per series: the episode played most recently, not the highest number', () => {
    const { row: shown } = selectContinuePlaying(
      [
        watchedEpisode('e5', 's1', 20, 2 * DAY, { index: 5 }),
        watchedEpisode('e2', 's1', 10, 1 * DAY, { index: 2 }),
        watchedEpisode('e3', 's1', 15, 3 * DAY, { index: 3 }),
      ],
      NOW,
    );
    expect(shown.map(i => i.id)).toEqual(['e2']);
  });

  it('keeps separate series and movies as separate cards, most recently played first', () => {
    const { row: shown } = selectContinuePlaying(
      [
        watchedEpisode('a1', 'sa', 10, 5 * DAY),
        watchedMovie('m1', 100, 40, 1 * DAY),
        watchedEpisode('b1', 'sb', 10, 3 * DAY),
      ],
      NOW,
    );
    expect(shown.map(i => i.id)).toEqual(['m1', 'b1', 'a1']);
  });

  it('ignores anything watched for less than a minute', () => {
    const { row: shown } = selectContinuePlaying(
      [watchedEpisode('e1', 's1', 0.5, 1 * DAY), watchedEpisode('e2', 's2', 1, 1 * DAY)],
      NOW,
    );
    expect(shown.map(i => i.id)).toEqual(['e2']);
  });

  it('keeps a 45 minute episode with 10 minutes left, and hides one with 2 left', () => {
    expect(selectContinuePlaying([watchedEpisode('e1', 's1', 35, DAY)], NOW).row).toHaveLength(1);
    expect(selectContinuePlaying([watchedEpisode('e1', 's1', 43, DAY)], NOW).row).toHaveLength(0);
  });

  it('keeps a 10 minute episode with 2 minutes left: 20 percent remains', () => {
    const short = episode('e1', 's1', { runtimeMs: 10 * MIN, resumeMs: 8 * MIN, lastPlayed: NOW - DAY });
    expect(selectContinuePlaying([short], NOW).row).toHaveLength(1);
  });

  it('applies the movie limit of 5 minutes, and needs 95 percent as well', () => {
    expect(selectContinuePlaying([watchedMovie('m1', 120, 116, DAY)], NOW).row).toHaveLength(0);
    // 7 minutes left of a 120 minute film is 94.2 percent: shown.
    expect(selectContinuePlaying([watchedMovie('m2', 120, 113, DAY)], NOW).row).toHaveLength(1);
    // 4 minutes left of a 40 minute film is only 90 percent: shown even though it is under 5 minutes.
    expect(selectContinuePlaying([watchedMovie('m3', 40, 36, DAY)], NOW).row).toHaveLength(1);
  });

  it('picks the current episode before the near-finished test, so an abandoned one does not return', () => {
    const current = watchedEpisode('e4', 's1', 44, 1 * DAY);
    const abandoned = watchedEpisode('e2', 's1', 10, 20 * DAY);
    expect(selectContinuePlaying([current, abandoned], NOW).row).toEqual([]);
  });

  it('does not mark anything watched or change a resume point', () => {
    const nearly = watchedEpisode('e1', 's1', 44, DAY);
    const copy = { ...nearly };
    selectContinuePlaying([nearly], NOW);
    expect(nearly).toEqual(copy);
  });

  it('limits Home to twelve cards and puts the rest behind View all', () => {
    const items = Array.from({ length: 15 }, (_, i) => watchedMovie(`m${i}`, 100, 40, (i + 1) * DAY));
    const { row: shown, more } = selectContinuePlaying(items, NOW);
    expect(shown).toHaveLength(CONTINUE_RULES.rowLimit);
    expect(shown[0].id).toBe('m0');
    expect(more.map(i => i.id)).toEqual(['m12', 'm13', 'm14']);
  });

  it('moves entries untouched for over 90 days behind View all, keeping their progress', () => {
    const old = watchedMovie('old', 100, 40, 91 * DAY);
    const recent = watchedMovie('new', 100, 40, 2 * DAY);
    const { row: shown, more } = selectContinuePlaying([old, recent], NOW);
    expect(shown.map(i => i.id)).toEqual(['new']);
    expect(more.map(i => i.id)).toEqual(['old']);
    expect(more[0].resumeMs).toBe(40 * MIN);
  });

  it('treats an item with no play date as fresh and sorts it after dated ones', () => {
    const undated = movie('u', { runtimeMs: 100 * MIN, resumeMs: 40 * MIN });
    const dated = watchedMovie('d', 100, 40, 3 * DAY);
    expect(selectContinuePlaying([undated, dated], NOW).row.map(i => i.id)).toEqual(['d', 'u']);
  });

  it('hides a removed series until something in it is played again', () => {
    const e = watchedEpisode('e1', 's1', 10, 5 * DAY);
    const hidden = { s1: e.lastPlayed as number };
    expect(selectContinuePlaying([e], NOW, hidden).row).toEqual([]);
    const replayed = { ...e, lastPlayed: NOW - 1 * DAY };
    expect(selectContinuePlaying([replayed], NOW, hidden).row.map(i => i.id)).toEqual(['e1']);
  });

  it('removing one episode hides the whole series, so an older episode cannot take its place', () => {
    const current = watchedEpisode('e4', 's1', 10, 1 * DAY);
    const older = watchedEpisode('e2', 's1', 10, 9 * DAY);
    const hidden = { [continueKey(current)]: current.lastPlayed as number };
    expect(selectContinuePlaying([current, older], NOW, hidden).row).toEqual([]);
  });

  it('keys a movie by its own id and an episode by its series', () => {
    expect(continueKey(movie('m1'))).toBe('m1');
    expect(continueKey(episode('e1', 's9'))).toBe('s9');
  });
});

describe('buildHome', () => {
  const inputs = (over: Partial<Parameters<typeof buildHome>[0]> = {}) => ({
    resume: [],
    upNext: [],
    recentlyAdded: [],
    genres: [],
    now: NOW,
    ...over,
  });

  it('keeps a series out of Up Next while it has a Continue Playing card', () => {
    const home = buildHome(
      inputs({
        resume: [watchedEpisode('e1', 's1', 10, DAY)],
        upNext: [episode('e2', 's1'), episode('x1', 's2')],
      }),
    );
    expect(home.upNext.map(i => i.id)).toEqual(['x1']);
  });

  it('never shows the same episode in both rows', () => {
    const shared = watchedEpisode('e1', 's1', 10, DAY);
    const home = buildHome(inputs({ resume: [shared], upNext: [shared] }));
    expect(home.upNext).toEqual([]);
  });

  it('lets Up Next move on when the current episode is hidden as nearly finished', () => {
    const home = buildHome(
      inputs({ resume: [watchedEpisode('e1', 's1', 44, DAY)], upNext: [episode('e2', 's1')] }),
    );
    expect(home.continuePlaying).toEqual([]);
    expect(home.upNext.map(i => i.id)).toEqual(['e2']);
  });

  it('passes the View all entries through', () => {
    const home = buildHome(inputs({ resume: [watchedMovie('old', 100, 40, 100 * DAY)] }));
    expect(home.continuePlaying).toEqual([]);
    expect(home.continueMore.map(i => i.id)).toEqual(['old']);
  });

  it('leaves out of Recently Added whatever is already shown above', () => {
    const home = buildHome(
      inputs({
        resume: [watchedMovie('m1', 100, 40, DAY)],
        upNext: [episode('e1', 's1')],
        recentlyAdded: [row('a', [movie('m1'), movie('m2'), { ...movie('s1'), kind: 'series' }])],
      }),
    );
    expect(home.recentlyAdded).toHaveLength(1);
    expect(home.recentlyAdded[0].items.map(i => i.id)).toEqual(['m2']);
  });

  it('keeps one Recently Added row per library, in library order, dropping an empty one', () => {
    const home = buildHome(
      inputs({ recentlyAdded: [row('movies', [movie('m1'), movie('m2')]), row('shows', []), row('docs', [movie('d1')])] }),
    );
    expect(home.recentlyAdded.map(r => r.library.id)).toEqual(['movies', 'docs']);
    expect(home.recentlyAdded[0].items.map(i => i.id)).toEqual(['m1', 'm2']);
  });

  it('shows a title that appears in two libraries only once', () => {
    const home = buildHome(
      inputs({ recentlyAdded: [row('a', [movie('m1')]), row('b', [movie('m1'), movie('m2')])] }),
    );
    expect(home.recentlyAdded.map(r => r.items.map(i => i.id))).toEqual([['m1'], ['m2']]);
  });

  it('passes genres through unchanged', () => {
    const genres = [{ name: 'Drama' }, { name: 'Comedy' }];
    expect(buildHome(inputs({ genres })).genres).toEqual(genres);
  });
});

describe('initialFeatured and isEmpty', () => {
  it('features where you left off, else what is next, else what is new', () => {
    expect(initialFeatured({ ...empty, continuePlaying: [movie('a')], upNext: [movie('b')] })?.id).toBe('a');
    expect(initialFeatured({ ...empty, upNext: [movie('b')], recentlyAdded: [row('a', [movie('c')])] })?.id).toBe('b');
    expect(initialFeatured({ ...empty, recentlyAdded: [row('a', [movie('c')])] })?.id).toBe('c');
    expect(initialFeatured(empty)).toBeUndefined();
  });

  it('is empty only when every row is, View all entries included', () => {
    expect(isEmpty(empty)).toBe(true);
    expect(isEmpty({ ...empty, genres: [{ name: 'Drama' }] })).toBe(false);
    expect(isEmpty({ ...empty, continueMore: [movie('old')] })).toBe(false);
  });
});

describe('cardText', () => {
  it('shows the series name as the headline of an episode', () => {
    expect(cardTitle(episode('e1', 's1'))).toBe('Show s1');
    expect(cardTitle(movie('m1'))).toBe('Movie m1');
  });

  it('says how much is left, never less than a minute, and nothing when not started', () => {
    expect(formatTimeLeft(movie('m', { runtimeMs: 3600000, resumeMs: 2220000 }))).toBe('23 min left');
    expect(formatTimeLeft(movie('m', { runtimeMs: 3600000, resumeMs: 3590000 }))).toBe('1 min left');
    expect(formatTimeLeft(movie('m', { runtimeMs: 3600000, resumeMs: 0 }))).toBe('');
    expect(formatTimeLeft(movie('m', { runtimeMs: 3600000, resumeMs: 3600000 }))).toBe('');
    expect(formatTimeLeft(movie('m', { resumeMs: 1000 }))).toBe('');
  });

  it('writes each Continue Playing card as title, episode line and time left', () => {
    const e = episode('e1', 's1', { seasonIndex: 2, index: 4, runtimeMs: 45 * MIN, resumeMs: 35 * MIN });
    expect(cardTitle(e)).toBe('Show s1');
    expect(continueSubtitle(e)).toBe('S2 E4  ·  Episode e1');
    expect(continueCaption(e)).toBe('10 min left');
    expect(continueSubtitle(movie('m', { year: 1999 }))).toBe('1999');
    expect(continueSubtitle(movie('m'))).toBe('');
  });

  it('writes the other rows', () => {
    expect(upNextSubtitle(episode('e1', 's1'))).toBe('S1 E2  ·  Episode e1');
    expect(recentSubtitle(movie('m', { year: 1999 }))).toBe('1999');
    expect(recentSubtitle(movie('m'))).toBe('');
    expect(recentSubtitle(episode('e1', 's1'))).toBe('S1 E2  ·  Episode e1');
  });
});

describe('cardActions', () => {
  it('offers Details and Mark watched for something not started', () => {
    expect(cardActions(movie('m1'))).toEqual(['details', 'mark-watched']);
  });

  it('adds Resume and Start again once there is a resume point', () => {
    expect(cardActions(movie('m1', { resumeMs: 60000, runtimeMs: 600000 }))).toEqual([
      'resume',
      'play-from-start',
      'details',
      'mark-watched',
    ]);
  });

  it('offers Remove from row only on a Continue Playing card', () => {
    const started = movie('m1', { resumeMs: 60000, runtimeMs: 600000 });
    expect(cardActions(started, true)).toContain('remove-from-row');
    expect(cardActions(started, false)).not.toContain('remove-from-row');
  });

  it('does not offer Mark watched for a title already watched', () => {
    expect(cardActions(movie('m1', { played: true }))).toEqual(['details']);
  });
});
