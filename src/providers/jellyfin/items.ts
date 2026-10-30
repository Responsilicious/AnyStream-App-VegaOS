import { buildQuery, joinUrl } from '../../util/url';
import { ticksToMs } from '../../util/ticks';
import type { GenreTile, ItemPage, ItemQuery, KindFilter, Library, MediaItem } from '../types';
import type { JellyfinHttp } from './http';

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type?: string;
  CollectionType?: string;
  ProductionYear?: number;
  Overview?: string;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string; Thumb?: string };
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  BackdropImageTags?: string[];
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean; LastPlayedDate?: string; IsFavorite?: boolean };
  Genres?: string[];
  OfficialRating?: string;
  CommunityRating?: number;
  People?: Array<{ Name?: string; Type?: string }>;
  /** Episode number, or season number for a season. */
  IndexNumber?: number;
  /** Season number, on an episode. */
  ParentIndexNumber?: number;
  SeriesId?: string;
  SeriesName?: string;
}

interface ItemsResponse {
  Items: JellyfinItem[];
  TotalRecordCount: number;
}

const KIND_BY_TYPE: Record<string, MediaItem['kind']> = {
  Movie: 'movie',
  Series: 'series',
  Season: 'season',
  Episode: 'episode',
};

export function imageUrl(
  baseUrl: string,
  itemId: string,
  kind: 'Primary' | 'Backdrop' | 'Thumb',
  width: number,
  tag?: string,
): string {
  const query = buildQuery({ maxWidth: width, quality: 90, tag });
  return joinUrl(baseUrl, `/Items/${itemId}/Images/${kind}`) + query;
}

/** The names of the people with one role, or undefined when there are none. */
function names(people: JellyfinItem['People'], role: string): string[] | undefined {
  const found = people?.filter(p => p.Type === role && p.Name).map(p => p.Name as string);
  return found && found.length > 0 ? found : undefined;
}

/** A server timestamp as epoch milliseconds, or undefined when it is missing or unreadable. */
function parseDate(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Width requested for 16:9 card artwork: twice the 320 px card, so it stays sharp on a 4K screen. */
const LANDSCAPE_WIDTH = 640;

/** An episode shows its own still; anything else its thumb or backdrop. The show backdrop stands in when an episode has no still. */
function landscapeUrl(baseUrl: string, raw: JellyfinItem, kind: MediaItem['kind']): string | undefined {
  const primary = raw.ImageTags?.Primary;
  if (kind === 'episode' && primary) {
    return imageUrl(baseUrl, raw.Id, 'Primary', LANDSCAPE_WIDTH, primary);
  }
  const thumb = raw.ImageTags?.Thumb;
  if (thumb) {
    return imageUrl(baseUrl, raw.Id, 'Thumb', LANDSCAPE_WIDTH, thumb);
  }
  const backdrop = raw.BackdropImageTags?.[0];
  if (backdrop) {
    return imageUrl(baseUrl, raw.Id, 'Backdrop', LANDSCAPE_WIDTH, backdrop);
  }
  const parentBackdrop = raw.ParentBackdropImageTags?.[0];
  if (raw.ParentBackdropItemId && parentBackdrop) {
    return imageUrl(baseUrl, raw.ParentBackdropItemId, 'Backdrop', LANDSCAPE_WIDTH, parentBackdrop);
  }
  return undefined;
}

export function mapItem(baseUrl: string, raw: JellyfinItem): MediaItem {
  const resumeMs = ticksToMs(raw.UserData?.PlaybackPositionTicks);
  const primaryTag = raw.ImageTags?.Primary;
  const backdropTag = raw.BackdropImageTags?.[0];
  const kind = KIND_BY_TYPE[raw.Type ?? ''] ?? 'other';
  const cast = names(raw.People, 'Actor');
  return {
    id: raw.Id,
    title: raw.Name,
    kind,
    genres: raw.Genres && raw.Genres.length > 0 ? raw.Genres : undefined,
    officialRating: raw.OfficialRating,
    communityRating: raw.CommunityRating,
    cast,
    index: raw.IndexNumber,
    seasonIndex: raw.ParentIndexNumber,
    seriesId: raw.SeriesId,
    seriesTitle: raw.SeriesName,
    // An episode's primary image is a landscape still, so it doubles as the row thumbnail.
    thumbUrl: kind === 'episode' && primaryTag ? imageUrl(baseUrl, raw.Id, 'Primary', 480, primaryTag) : undefined,
    landscapeUrl: landscapeUrl(baseUrl, raw, kind),
    year: raw.ProductionYear,
    overview: raw.Overview,
    runtimeMs: raw.RunTimeTicks ? ticksToMs(raw.RunTimeTicks) : undefined,
    resumeMs,
    played: raw.UserData?.Played === true,
    lastPlayed: parseDate(raw.UserData?.LastPlayedDate),
    favorite: raw.UserData?.IsFavorite === true ? true : undefined,
    directors: names(raw.People, 'Director'),
    // 300 px wide covers a poster tile at TV scale; the server resizes so the TV never downloads originals.
    posterUrl: primaryTag ? imageUrl(baseUrl, raw.Id, 'Primary', 300, primaryTag) : undefined,
    backdropUrl: backdropTag ? imageUrl(baseUrl, raw.Id, 'Backdrop', 1280, backdropTag) : undefined,
  };
}

export async function fetchLibraries(http: JellyfinHttp, userId: string): Promise<Library[]> {
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Views`);
  return response.Items.map((view): Library => ({
    id: view.Id,
    name: view.Name,
    kind:
      view.CollectionType === 'movies'
        ? 'movies'
        : view.CollectionType === 'tvshows'
        ? 'tvshows'
        : 'other',
  })).filter(library => library.kind !== 'other');
}

export async function fetchItems(
  http: JellyfinHttp,
  userId: string,
  query: ItemQuery,
): Promise<ItemPage> {
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items`, {
    query: {
      ParentId: query.parentId,
      Recursive: true,
      IncludeItemTypes: 'Movie,Series',
      SortBy: query.sort === 'recent' ? 'DateCreated' : 'SortName',
      SortOrder: query.sort === 'recent' ? 'Descending' : 'Ascending',
      Fields: 'Overview,ProductionYear,RunTimeTicks',
      EnableImageTypes: 'Primary,Backdrop',
      ImageTypeLimit: 1,
      StartIndex: query.startIndex ?? 0,
      Limit: query.limit ?? 60,
      Genres: query.genres && query.genres.length > 0 ? query.genres.join('|') : undefined,
    },
  });
  return {
    items: response.Items.map(raw => mapItem(http.baseUrl, raw)),
    total: response.TotalRecordCount,
  };
}

/** Full metadata for one title. The single-item endpoint already includes cast, genres and rating. */
export async function fetchItem(http: JellyfinHttp, userId: string, itemId: string): Promise<MediaItem> {
  const raw = await http.get<JellyfinItem>(`/Users/${userId}/Items/${itemId}`);
  return mapItem(http.baseUrl, raw);
}

/** Seasons of a series, or episodes of a season. The server answers by parent type, in watching order. */
export async function fetchChildren(
  http: JellyfinHttp,
  userId: string,
  parentId: string,
): Promise<MediaItem[]> {
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items`, {
    query: {
      ParentId: parentId,
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      SortOrder: 'Ascending',
      Fields: 'Overview,ProductionYear,RunTimeTicks',
      EnableImageTypes: 'Primary',
      ImageTypeLimit: 1,
      IsMissing: false,
    },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}

const CARD_FIELDS = 'Overview,ProductionYear,RunTimeTicks,Genres,OfficialRating';
const CARD_IMAGES = { EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1 };

/**
 * Started but unfinished, most recently watched first. Asks for plenty: the app keeps one card per series,
 * so a dozen raw items can easily be only a few series.
 */
export async function fetchContinuePlaying(http: JellyfinHttp, userId: string): Promise<MediaItem[]> {
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items/Resume`, {
    query: {
      Limit: 60,
      MediaTypes: 'Video',
      Recursive: true,
      Fields: CARD_FIELDS,
      ...CARD_IMAGES,
      EnableTotalRecordCount: false,
    },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}

/**
 * The next unwatched episode of series already in progress. Series never started are left out, and so are
 * episodes that are themselves part-watched (those belong in Continue Playing).
 */
export async function fetchUpNext(http: JellyfinHttp, userId: string): Promise<MediaItem[]> {
  const response = await http.get<ItemsResponse>('/Shows/NextUp', {
    query: {
      UserId: userId,
      Limit: 12,
      Fields: CARD_FIELDS,
      ...CARD_IMAGES,
      DisableFirstEpisode: true,
      EnableResumable: false,
      EnableRewatching: false,
      EnableTotalRecordCount: false,
    },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}

/** Newly added titles in one library: movies, and one entry per series for new episodes. This endpoint answers with a bare array. */
export async function fetchRecentlyAdded(
  http: JellyfinHttp,
  userId: string,
  libraryId: string,
): Promise<MediaItem[]> {
  const items = await http.get<JellyfinItem[]>(`/Users/${userId}/Items/Latest`, {
    query: { ParentId: libraryId, Limit: 16, GroupItems: true, Fields: CARD_FIELDS, ...CARD_IMAGES },
  });
  return items.map(raw => mapItem(http.baseUrl, raw));
}

/** How many genres get a picture lookup. One request each, so this bounds the start-up cost of Home. */
const GENRE_TILE_LIMIT = 8;

/** Genres with at least one title. The picture is the backdrop of a random title in the genre. */
export async function fetchGenres(http: JellyfinHttp, userId: string): Promise<GenreTile[]> {
  const response = await http.get<ItemsResponse>('/Genres', {
    query: {
      UserId: userId,
      IncludeItemTypes: 'Movie,Series',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      EnableTotalRecordCount: false,
    },
  });
  const tiles = await Promise.all(
    response.Items.slice(0, GENRE_TILE_LIMIT).map(async (genre): Promise<GenreTile | null> => {
      try {
        const found = await http.get<ItemsResponse>(`/Users/${userId}/Items`, {
          query: {
            Genres: genre.Name,
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            SortBy: 'Random',
            Limit: 1,
            EnableImageTypes: 'Backdrop',
            ImageTypeLimit: 1,
          },
        });
        if (found.Items.length === 0) {
          return null;
        }
        const pick = found.Items[0];
        const tag = pick.BackdropImageTags?.[0];
        return {
          name: genre.Name,
          imageUrl: tag ? imageUrl(http.baseUrl, pick.Id, 'Backdrop', LANDSCAPE_WIDTH, tag) : undefined,
        };
      } catch {
        // A failed picture lookup must not hide the genre: show the tile without art.
        return { name: genre.Name };
      }
    }),
  );
  return tiles.filter((tile): tile is GenreTile => tile !== null);
}

/** Marks a title watched for this user. Jellyfin also clears its resume position. */
export async function markPlayed(http: JellyfinHttp, userId: string, itemId: string): Promise<void> {
  await http.post(`/Users/${userId}/PlayedItems/${itemId}`);
}

const TYPES_FOR_FILTER: Record<KindFilter, string> = {
  all: 'Movie,Series,Episode',
  movies: 'Movie',
  series: 'Series',
  episodes: 'Episode',
};

/** Titles in one genre for a reel. Episodes are left out, so an "all" reel is movies and series only. */
export async function fetchByGenre(
  http: JellyfinHttp,
  userId: string,
  genre: string,
  filter: KindFilter,
  limit: number,
): Promise<MediaItem[]> {
  const types = filter === 'all' || filter === 'episodes' ? 'Movie,Series' : TYPES_FOR_FILTER[filter];
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items`, {
    query: {
      Genres: genre,
      IncludeItemTypes: types,
      Recursive: true,
      // Newest added first: a genre reel is for finding what is new, not for browsing A to Z.
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Limit: limit,
      Fields: CARD_FIELDS,
      ...CARD_IMAGES,
      EnableTotalRecordCount: false,
    },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}

/** How many results one search returns: enough to fill a few screens, small enough to answer quickly. */
const SEARCH_LIMIT = 30;

export async function searchItems(
  http: JellyfinHttp,
  userId: string,
  term: string,
  filter: KindFilter,
): Promise<MediaItem[]> {
  const trimmed = term.trim();
  if (!trimmed) {
    return [];
  }
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items`, {
    query: {
      SearchTerm: trimmed,
      IncludeItemTypes: TYPES_FOR_FILTER[filter],
      Recursive: true,
      Limit: SEARCH_LIMIT,
      Fields: CARD_FIELDS,
      ...CARD_IMAGES,
      EnableTotalRecordCount: false,
    },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}

/** Marks a title watched or unwatched for this user. Unwatching also clears the saved position. */
export async function setPlayed(http: JellyfinHttp, userId: string, itemId: string, played: boolean): Promise<void> {
  const path = `/Users/${userId}/PlayedItems/${itemId}`;
  if (played) {
    await http.post(path);
  } else {
    await http.delete(path);
  }
}

export async function setFavorite(
  http: JellyfinHttp,
  userId: string,
  itemId: string,
  favorite: boolean,
): Promise<void> {
  const path = `/Users/${userId}/FavoriteItems/${itemId}`;
  if (favorite) {
    await http.post(path);
  } else {
    await http.delete(path);
  }
}

/** All episodes of a series in watching order, with this user's progress. Specials come back as season 0. */
export async function fetchEpisodes(http: JellyfinHttp, userId: string, seriesId: string): Promise<MediaItem[]> {
  const response = await http.get<ItemsResponse>(`/Shows/${seriesId}/Episodes`, {
    query: {
      UserId: userId,
      Fields: 'Overview,RunTimeTicks,ProductionYear',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      ImageTypeLimit: 1,
      IsMissing: false,
    },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}

/** Titles similar to this one. */
export async function fetchSimilar(http: JellyfinHttp, userId: string, itemId: string): Promise<MediaItem[]> {
  const response = await http.get<ItemsResponse>(`/Items/${itemId}/Similar`, {
    query: { UserId: userId, Limit: 12, Fields: CARD_FIELDS, ...CARD_IMAGES },
  });
  return response.Items.map(raw => mapItem(http.baseUrl, raw));
}
