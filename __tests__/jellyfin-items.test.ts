import { createJellyfinProvider } from '../src/providers/jellyfin';
import { mapItem } from '../src/providers/jellyfin/items';
import { DEFAULT_CAPABILITIES } from '../src/player/capabilities';
import { DEVICE, SESSION, fakeFetch } from './helpers/fakes';

const BASE = 'https://watch.example.com';

describe('mapItem metadata', () => {
  it('keeps genres, rating and cast (actors only)', () => {
    const item = mapItem(BASE, {
      Id: 'm1',
      Name: 'Film',
      Type: 'Movie',
      Genres: ['Action'],
      OfficialRating: 'PG-13',
      CommunityRating: 8.2,
      People: [
        { Name: 'Actor One', Type: 'Actor' },
        { Name: 'Director', Type: 'Director' },
        { Name: 'Actor Two', Type: 'Actor' },
      ],
    });
    expect(item.genres).toEqual(['Action']);
    expect(item.officialRating).toBe('PG-13');
    expect(item.communityRating).toBe(8.2);
    expect(item.cast).toEqual(['Actor One', 'Actor Two']);
  });

  it('leaves empty lists undefined', () => {
    const item = mapItem(BASE, { Id: 'm1', Name: 'Film', Type: 'Movie', Genres: [], People: [] });
    expect(item.genres).toBeUndefined();
    expect(item.cast).toBeUndefined();
  });

  it('gives an episode its numbers, series and a thumbnail from its still', () => {
    const episode = mapItem(BASE, {
      Id: 'e1',
      Name: 'Pilot',
      Type: 'Episode',
      IndexNumber: 3,
      ParentIndexNumber: 2,
      SeriesId: 's1',
      SeriesName: 'Show',
      ImageTags: { Primary: 'tag1' },
    });
    expect(episode.kind).toBe('episode');
    expect(episode.index).toBe(3);
    expect(episode.seasonIndex).toBe(2);
    expect(episode.seriesId).toBe('s1');
    expect(episode.seriesTitle).toBe('Show');
    expect(episode.thumbUrl).toContain('/Items/e1/Images/Primary');
    expect(episode.thumbUrl).toContain('maxWidth=480');
  });

  it('gives movies no thumbnail', () => {
    const movie = mapItem(BASE, { Id: 'm1', Name: 'Film', Type: 'Movie', ImageTags: { Primary: 't' } });
    expect(movie.thumbUrl).toBeUndefined();
  });
});

describe('provider getItem and getChildren', () => {
  it('fetches one title for the signed-in user', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: { Id: 'm1', Name: 'Film', Type: 'Movie', Overview: 'Plot', Genres: ['Drama'] },
    }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    const item = await provider.getItem('m1');

    expect(calls[0].url).toBe(`${BASE}/Users/user-1/Items/m1`);
    expect(item.title).toBe('Film');
    expect(item.overview).toBe('Plot');
    expect(item.genres).toEqual(['Drama']);
  });

  it('lists children in order, skipping missing episodes', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      body: {
        Items: [
          { Id: 'e1', Name: 'One', Type: 'Episode', IndexNumber: 1, ParentIndexNumber: 1 },
          { Id: 'e2', Name: 'Two', Type: 'Episode', IndexNumber: 2, ParentIndexNumber: 1 },
        ],
        TotalRecordCount: 2,
      },
    }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    const children = await provider.getChildren('season-1');

    expect(children.map(c => c.title)).toEqual(['One', 'Two']);
    expect(calls[0].url).toContain('/Users/user-1/Items?');
    expect(calls[0].url).toContain('ParentId=season-1');
    expect(calls[0].url).toContain('SortBy=ParentIndexNumber%2CIndexNumber%2CSortName');
    expect(calls[0].url).toContain('IsMissing=false');
  });

  it('surfaces an error rather than an empty list when the server fails', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: {} }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    await expect(provider.getChildren('x')).rejects.toMatchObject({ kind: 'server' });
  });

  it('lists series alongside movies in a library', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { Items: [], TotalRecordCount: 0 } }));
    const provider = createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fetchImpl);
    await provider.getItems({ parentId: 'lib' });
    expect(calls[0].url).toContain('IncludeItemTypes=Movie%2CSeries');
  });
});

describe('landscape artwork', () => {
  it('uses an episode still, a thumb, a backdrop, then the show backdrop', () => {
    const episode = mapItem(BASE, { Id: 'e1', Name: 'Pilot', Type: 'Episode', ImageTags: { Primary: 'p' } });
    expect(episode.landscapeUrl).toContain('/Items/e1/Images/Primary');
    expect(episode.landscapeUrl).toContain('maxWidth=640');

    const thumb = mapItem(BASE, { Id: 'm1', Name: 'Film', Type: 'Movie', ImageTags: { Thumb: 't', Primary: 'p' } });
    expect(thumb.landscapeUrl).toContain('/Items/m1/Images/Thumb');

    const backdrop = mapItem(BASE, { Id: 'm2', Name: 'Film', Type: 'Movie', BackdropImageTags: ['b'] });
    expect(backdrop.landscapeUrl).toContain('/Items/m2/Images/Backdrop');

    const bare = mapItem(BASE, {
      Id: 'e2',
      Name: 'No still',
      Type: 'Episode',
      ParentBackdropItemId: 'show1',
      ParentBackdropImageTags: ['pb'],
    });
    expect(bare.landscapeUrl).toContain('/Items/show1/Images/Backdrop');
  });

  it('never falls back to a portrait poster', () => {
    const film = mapItem(BASE, { Id: 'm3', Name: 'Film', Type: 'Movie', ImageTags: { Primary: 'p' } });
    expect(film.landscapeUrl).toBeUndefined();
  });
});

describe('Home rows from the provider', () => {
  const provider = (reply: (url: string) => unknown) => {
    const fake = fakeFetch(call => ({ body: reply(call.url) }));
    return { ...fake, provider: createJellyfinProvider(SESSION, DEVICE, DEFAULT_CAPABILITIES, fake.fetchImpl) };
  };

  it('asks for unfinished video, most recent first', async () => {
    const { calls, provider: p } = provider(() => ({
      Items: [{ Id: 'e1', Name: 'One', Type: 'Episode', UserData: { PlaybackPositionTicks: 6000000000 } }],
    }));
    const items = await p.getContinuePlaying();
    expect(calls[0].url).toContain('/Users/user-1/Items/Resume?');
    expect(calls[0].url).toContain('MediaTypes=Video');
    expect(items[0].resumeMs).toBe(600000);
  });

  it('asks Up Next for series already in progress, leaving out part-watched episodes', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [] }));
    await p.getUpNext();
    expect(calls[0].url).toContain('/Shows/NextUp?');
    expect(calls[0].url).toContain('UserId=user-1');
    expect(calls[0].url).toContain('DisableFirstEpisode=true');
    expect(calls[0].url).toContain('EnableResumable=false');
  });

  it('reads Recently Added from a bare array', async () => {
    const { calls, provider: p } = provider(() => [{ Id: 'm1', Name: 'New', Type: 'Movie' }]);
    const items = await p.getRecentlyAdded('lib-movies');
    expect(calls[0].url).toContain('/Users/user-1/Items/Latest?');
    expect(calls[0].url).toContain('ParentId=lib-movies');
    expect(items.map(i => i.title)).toEqual(['New']);
  });

  it('builds genre tiles from a random title backdrop, dropping empty genres and keeping failed ones', async () => {
    const { provider: p } = provider(url => {
      if (url.includes('/Genres')) {
        return { Items: [{ Name: 'Drama' }, { Name: 'Empty' }, { Name: 'Broken' }] };
      }
      if (url.includes('Genres=Drama')) {
        return { Items: [{ Id: 'm1', Name: 'Film', BackdropImageTags: ['b'] }] };
      }
      if (url.includes('Genres=Empty')) {
        return { Items: [] };
      }
      return null;
    });
    const tiles = await p.getGenres();
    expect(tiles.map(t => t.name)).toEqual(['Drama', 'Broken']);
    expect(tiles[0].imageUrl).toContain('/Items/m1/Images/Backdrop');
    expect(tiles[1].imageUrl).toBeUndefined();
  });

  it('marks a title watched for the signed-in user', async () => {
    const { calls, provider: p } = provider(() => ({}));
    await p.markPlayed('m1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${BASE}/Users/user-1/PlayedItems/m1`);
  });

  it('loads a genre reel without episodes, in name order', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [{ Id: 'm1', Name: 'Film', Type: 'Movie' }] }));
    const items = await p.getByGenre('Sci-Fi', 'all', 12);
    expect(items.map(i => i.title)).toEqual(['Film']);
    expect(calls[0].url).toContain('Genres=Sci-Fi');
    expect(calls[0].url).toContain('IncludeItemTypes=Movie%2CSeries');
    expect(calls[0].url).toContain('Limit=12');
    expect(calls[0].url).toContain('SortBy=DateCreated');
    expect(calls[0].url).toContain('SortOrder=Descending');
  });

  it('lists a library newest added first when asked, and A to Z otherwise', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [], TotalRecordCount: 0 }));
    await p.getItems({ parentId: 'lib', sort: 'recent' });
    await p.getItems({ parentId: 'lib' });
    expect(calls[0].url).toContain('SortBy=DateCreated');
    expect(calls[0].url).toContain('SortOrder=Descending');
    expect(calls[1].url).toContain('SortBy=SortName');
    expect(calls[1].url).toContain('SortOrder=Ascending');
  });

  it('limits a genre reel to the chosen kind', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [] }));
    await p.getByGenre('Drama', 'series', 6);
    expect(calls[0].url).toContain('IncludeItemTypes=Series');
    expect(calls[0].url).not.toContain('Movie');
  });

  it('searches by the typed text, including episodes for All', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [{ Id: 'e1', Name: 'Pilot', Type: 'Episode' }] }));
    const items = await p.search('  space  ', 'all');
    expect(items).toHaveLength(1);
    expect(calls[0].url).toContain('SearchTerm=space');
    expect(calls[0].url).toContain('IncludeItemTypes=Movie%2CSeries%2CEpisode');
  });

  it('narrows a search to one kind, and a blank search asks nothing', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [] }));
    await p.search('space', 'episodes');
    expect(calls[0].url).toContain('IncludeItemTypes=Episode');
    expect(await p.search('   ', 'all')).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('reads when a title was last played, and asks for plenty of resume items', async () => {
    const { calls, provider: p } = provider(() => ({
      Items: [
        { Id: 'e1', Name: 'One', Type: 'Episode', UserData: { LastPlayedDate: '2026-10-28T20:00:00.0000000Z' } },
        { Id: 'e2', Name: 'Two', Type: 'Episode', UserData: { LastPlayedDate: 'not a date' } },
        { Id: 'e3', Name: 'Three', Type: 'Episode' },
      ],
    }));
    const items = await p.getContinuePlaying();
    expect(items[0].lastPlayed).toBe(Date.UTC(2026, 9, 28, 20, 0, 0));
    expect(items[1].lastPlayed).toBeUndefined();
    expect(items[2].lastPlayed).toBeUndefined();
    expect(calls[0].url).toContain('Limit=60');
  });

  it('loads every episode of a series with this user progress', async () => {
    const { calls, provider: p } = provider(() => ({
      Items: [
        { Id: 'e1', Name: 'One', Type: 'Episode', IndexNumber: 1, ParentIndexNumber: 1, UserData: { Played: true } },
        { Id: 's0', Name: 'Special', Type: 'Episode', IndexNumber: 1, ParentIndexNumber: 0 },
      ],
    }));
    const episodes = await p.getEpisodes('show-1');
    expect(calls[0].url).toContain('/Shows/show-1/Episodes?');
    expect(calls[0].url).toContain('UserId=user-1');
    expect(calls[0].url).toContain('IsMissing=false');
    expect(episodes.map(e => [e.seasonIndex, e.index, e.played])).toEqual([
      [1, 1, true],
      [0, 1, false],
    ]);
  });

  it('asks for similar titles for More like this', async () => {
    const { calls, provider: p } = provider(() => ({ Items: [{ Id: 'm2', Name: 'Other', Type: 'Movie' }] }));
    const items = await p.getSimilar('m1');
    expect(calls[0].url).toContain('/Items/m1/Similar?');
    expect(calls[0].url).toContain('UserId=user-1');
    expect(items.map(i => i.title)).toEqual(['Other']);
  });

  it('adds and removes favourites and watched marks with the right method', async () => {
    const { calls, provider: p } = provider(() => ({}));
    await p.setFavorite('m1', true);
    await p.setFavorite('m1', false);
    await p.setPlayed('m1', true);
    await p.setPlayed('m1', false);
    expect(calls.map(c => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'POST /Users/user-1/FavoriteItems/m1',
      'DELETE /Users/user-1/FavoriteItems/m1',
      'POST /Users/user-1/PlayedItems/m1',
      'DELETE /Users/user-1/PlayedItems/m1',
    ]);
  });

  it('reads the favourite flag and the directors of a title', async () => {
    const { provider: p } = provider(() => ({
      Id: 'm1',
      Name: 'Film',
      Type: 'Movie',
      UserData: { IsFavorite: true },
      People: [
        { Name: 'Maya Chen', Type: 'Director' },
        { Name: 'Alex Rivera', Type: 'Actor' },
      ],
    }));
    const item = await p.getItem('m1');
    expect(item.favorite).toBe(true);
    expect(item.directors).toEqual(['Maya Chen']);
    expect(item.cast).toEqual(['Alex Rivera']);
  });
});
