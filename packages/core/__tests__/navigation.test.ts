import {
  activeSection,
  backLabel,
  canGoBack,
  currentRoute,
  goToSection,
  goBack,
  HOME,
  openContinue,
  openGenre,
  openItem,
  playItem,
  selectSection,
} from '../src/navigation';
import type { MediaItem } from '../src/providers/types';

const item = (kind: MediaItem['kind'], id = 'x'): MediaItem => ({
  id,
  title: id,
  kind,
  resumeMs: 0,
  played: false,
});

describe('navigation', () => {
  it('starts at the library', () => {
    expect(currentRoute(HOME)).toEqual({ name: 'library', section: 'home' });
  });

  it('opens a movie on its detail page and a series on the series page', () => {
    expect(currentRoute(openItem(HOME, item('movie'))).name).toBe('detail');
    expect(currentRoute(openItem(HOME, item('series'))).name).toBe('series');
    expect(currentRoute(openItem(HOME, item('season'))).name).toBe('series');
    expect(currentRoute(openItem(HOME, item('other'))).name).toBe('detail');
  });

  it('plays from a detail page and Back returns to it, then to the library', () => {
    const movie = item('movie', 'm1');
    const detail = openItem(HOME, movie);
    const playing = playItem(detail, movie);
    expect(currentRoute(playing)).toEqual({ name: 'player', item: movie });

    const afterPlayer = goBack(playing);
    expect(currentRoute(afterPlayer).name).toBe('detail');
    expect(currentRoute(goBack(afterPlayer)).name).toBe('library');
  });

  it('returns from an episode to the series page it was started on', () => {
    const show = item('series', 's1');
    const episode = item('episode', 'e1');
    const stack = playItem(openItem(HOME, show), episode);
    expect(currentRoute(goBack(stack))).toMatchObject({ name: 'series', item: show, episodeId: 'e1' });
  });

  it('never pops the library, and does not mutate the stack it was given', () => {
    expect(goBack(HOME)).toEqual(HOME);
    const detail = openItem(HOME, item('movie'));
    const before = [...detail];
    goBack(detail);
    expect(detail).toEqual(before);
    expect(HOME).toHaveLength(1);
  });

  it('switches section from a top-level screen and Back returns Home', () => {
    const movies = selectSection(HOME, 'movies');
    expect(currentRoute(movies)).toEqual({ name: 'library', section: 'movies' });
    expect(canGoBack(movies)).toBe(true);
    expect(goBack(movies)).toEqual(HOME);
  });

  it('does not claim Back on Home, so the platform can leave the app', () => {
    expect(canGoBack(HOME)).toBe(false);
    expect(goBack(HOME)).toBe(HOME);
  });

  it('ignores section changes while a title or the player is showing', () => {
    const detail = openItem(HOME, item('movie'));
    expect(selectSection(detail, 'series')).toBe(detail);
  });

  it('keeps the section you were in when you come back from a title', () => {
    const series = selectSection(HOME, 'series');
    const show = item('series', 's1');
    const stack = playItem(openItem(series, show), item('episode', 'e1'));
    expect(currentRoute(goBack(goBack(stack)))).toEqual({ name: 'library', section: 'series' });
  });

  it('opens a genre and Back returns to where the tile was', () => {
    const genres = selectSection(HOME, 'genres');
    const stack = openGenre(genres, 'Sci-Fi');
    expect(currentRoute(stack)).toEqual({ name: 'genre', genre: 'Sci-Fi' });
    expect(currentRoute(goBack(stack))).toEqual({ name: 'library', section: 'genres' });
  });

  it('opens Continue Playing View all and Back returns Home', () => {
    const stack = openContinue(HOME);
    expect(currentRoute(stack)).toEqual({ name: 'continue' });
    expect(goBack(stack)).toEqual(HOME);
  });

  it('opens an episode as its series with that episode selected', () => {
    const stack = openItem(HOME, { ...item('episode', 'e7'), seriesId: 's1', seriesTitle: 'The Show' });
    expect(currentRoute(stack)).toMatchObject({
      name: 'series',
      episodeId: 'e7',
      item: { id: 's1', kind: 'series', title: 'The Show' },
    });
  });

  it('opens an episode with no series link on a title page instead', () => {
    expect(currentRoute(openItem(HOME, item('episode', 'lost'))).name).toBe('detail');
  });

  it('playing an episode from a series page makes it the selected one for the way back', () => {
    const show = { ...item('series', 's1') };
    const opened = openItem(HOME, show);
    const playing = playItem(opened, { ...item('episode', 'e9'), seriesId: 's1' });
    expect(currentRoute(playing).name).toBe('player');
    expect(currentRoute(goBack(playing))).toMatchObject({ name: 'series', episodeId: 'e9' });
  });

  it('leaves the pages and lights up the section the user came from', () => {
    const movies = selectSection(HOME, 'movies');
    const page = openItem(movies, item('movie'));
    expect(activeSection(page)).toBe('movies');
    expect(goToSection('series')).toEqual([{ name: 'library', section: 'series' }]);
  });

  it('names the screen to go back to', () => {
    const movies = selectSection(HOME, 'movies');
    expect(backLabel(openItem(movies, item('movie')))).toBe('Back to Movies');
    expect(backLabel(openItem(HOME, item('series')))).toBe('Back to Home');
    expect(backLabel(openItem(openGenre(HOME, 'Sci-Fi'), item('movie')))).toBe('Back to Sci-Fi');
    expect(backLabel(openItem(openContinue(HOME), item('movie')))).toBe('Back to Continue Playing');
    const show = { ...item('series', 's1'), title: 'The Show' };
    expect(backLabel(playItem(openItem(HOME, show), item('movie')))).toBe('Back to The Show');
    expect(backLabel(HOME)).toBe('Back');
  });
});
