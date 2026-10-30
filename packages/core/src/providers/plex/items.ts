import { buildQuery, joinUrl } from '../../util/url';
import type { GenreTile, ItemPage, ItemQuery, KindFilter, Library, MediaItem } from '../types';
import type { PlexHttp } from './http';

/** The fields AnyStream reads from a Plex Metadata entry. Times are milliseconds; dates are epoch seconds. */
export interface PlexMetadata {
  ratingKey: string;
  type?: string;
  title?: string;
  year?: number;
  summary?: string;
  duration?: number;
  viewOffset?: number;
  viewCount?: number;
  lastViewedAt?: number;
  thumb?: string;
  art?: string;
  /** A wide still for an episode, or a title's thumb artwork. */
  grandparentThumb?: string;
  grandparentArt?: string;
  parentThumb?: string;
  grandparentTitle?: string;
  grandparentRatingKey?: string;
  parentRatingKey?: string;
  parentIndex?: number;
  index?: number;
  contentRating?: string;
  audienceRating?: number;
  rating?: number;
  Genre?: Array<{ tag?: string }>;
  Role?: Array<{ tag?: string }>;
  Director?: Array<{ tag?: string }>;
  leafCount?: number;
  addedAt?: number;
  viewedLeafCount?: number;
  Media?: PlexMedia[];
}

export interface PlexStream {
  id: number;
  streamType: number;
  index?: number;
  codec?: string;
  languageCode?: string;
  language?: string;
  title?: string;
  displayTitle?: string;
  extendedDisplayTitle?: string;
  channels?: number;
  audioChannelLayout?: string;
  profile?: string;
  width?: number;
  height?: number;
  bitDepth?: number;
  colorTrc?: string;
  DOVIPresent?: boolean;
  default?: boolean;
  forced?: boolean;
  selected?: boolean;
}

export interface PlexPart {
  id: number;
  key: string;
  container?: string;
  duration?: number;
  Stream?: PlexStream[];
}

export interface PlexMedia {
  id: number;
  title?: string;
  duration?: number;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  videoResolution?: string;
  width?: number;
  Part?: PlexPart[];
}

interface Container<T> {
  MediaContainer?: T & { size?: number; totalSize?: number };
}

interface Directory {
  key: string;
  title?: string;
  type?: string;
  fastKey?: string;
}

const KIND_BY_TYPE: Record<string, MediaItem['kind']> = {
  movie: 'movie',
  show: 'series',
  season: 'season',
  episode: 'episode',
};

/** Plex's numeric type ids for library queries. */
const TYPE_ID = { movie: 1, show: 2, season: 3, episode: 4 } as const;

/**
 * A server-resized image. The image component cannot send headers, so the server token rides in the query;
 * these URLs only ever go to the same server and never appear on screen or in logs.
 */
export function plexImageUrl(http: PlexHttp, path: string | undefined, width: number, height?: number): string | undefined {
  if (!path) {
    return undefined;
  }
  const query = buildQuery({
    width,
    height: height ?? Math.round(width * 1.5),
    minSize: 1,
    upscale: 1,
    url: path,
    'X-Plex-Token': http.token,
  });
  return joinUrl(http.baseUrl, '/photo/:/transcode') + query;
}

function tags(list: Array<{ tag?: string }> | undefined): string[] | undefined {
  const found = list?.map(t => t.tag).filter((t): t is string => !!t);
  return found && found.length > 0 ? found : undefined;
}

const LANDSCAPE_WIDTH = 640;

export function mapPlexItem(http: PlexHttp, raw: PlexMetadata): MediaItem {
  const kind = KIND_BY_TYPE[raw.type ?? ''] ?? 'other';
  const isEpisode = kind === 'episode';
  // Plex reports an episode's poster as its show's (grandparent) poster; the episode's own thumb is a still.
  const poster = isEpisode ? raw.grandparentThumb ?? raw.parentThumb : raw.thumb;
  const backdrop = isEpisode ? raw.grandparentArt ?? raw.art : raw.art;
  const wide = isEpisode ? raw.thumb ?? backdrop : raw.art;
  const viewOffset = raw.viewOffset ?? 0;
  const played =
    kind === 'series' || kind === 'season'
      ? raw.leafCount !== undefined && raw.leafCount > 0 && raw.viewedLeafCount === raw.leafCount
      : (raw.viewCount ?? 0) > 0 && viewOffset === 0;
  return {
    id: raw.ratingKey,
    title: raw.title ?? '',
    kind,
    year: raw.year,
    overview: raw.summary,
    runtimeMs: raw.duration,
    resumeMs: viewOffset,
    played,
    genres: tags(raw.Genre),
    officialRating: raw.contentRating,
    communityRating: raw.audienceRating ?? raw.rating,
    cast: tags(raw.Role),
    directors: tags(raw.Director),
    index: raw.index,
    seasonIndex: isEpisode ? raw.parentIndex : undefined,
    seriesId: isEpisode ? raw.grandparentRatingKey : kind === 'season' ? raw.parentRatingKey : undefined,
    seriesTitle: isEpisode ? raw.grandparentTitle : undefined,
    lastPlayed: raw.lastViewedAt ? raw.lastViewedAt * 1000 : undefined,
    posterUrl: plexImageUrl(http, poster, 300),
    backdropUrl: plexImageUrl(http, backdrop, 1280, 720),
    thumbUrl: isEpisode ? plexImageUrl(http, raw.thumb, 480, 270) : undefined,
    landscapeUrl: plexImageUrl(http, wide, LANDSCAPE_WIDTH, 360),
  };
}

function metadata(response: Container<{ Metadata?: PlexMetadata[] }> | undefined): PlexMetadata[] {
  return response?.MediaContainer?.Metadata ?? [];
}

export async function fetchLibraries(http: PlexHttp): Promise<Library[]> {
  const response = await http.get<Container<{ Directory?: Directory[] }>>('/library/sections');
  return (response?.MediaContainer?.Directory ?? [])
    .map((d): Library => ({
      id: d.key,
      name: d.title ?? '',
      kind: d.type === 'movie' ? 'movies' : d.type === 'show' ? 'tvshows' : 'other',
    }))
    .filter(library => library.kind !== 'other');
}

/** The section's id for a genre name, or undefined when this section has no such genre. */
async function genreId(http: PlexHttp, sectionId: string, name: string): Promise<string | undefined> {
  const response = await http.get<Container<{ Directory?: Directory[] }>>(`/library/sections/${sectionId}/genre`);
  return response?.MediaContainer?.Directory?.find(d => d.title?.toLowerCase() === name.toLowerCase())?.key;
}

async function sectionType(http: PlexHttp, sectionId: string): Promise<number> {
  const libraries = await fetchLibraries(http);
  return libraries.find(l => l.id === sectionId)?.kind === 'tvshows' ? TYPE_ID.show : TYPE_ID.movie;
}

export async function fetchItems(http: PlexHttp, query: ItemQuery): Promise<ItemPage> {
  const type = await sectionType(http, query.parentId);
  let genre: string | undefined;
  if (query.genres && query.genres.length > 0) {
    genre = await genreId(http, query.parentId, query.genres[0]);
    if (!genre) {
      return { items: [], total: 0 };
    }
  }
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/sections/${query.parentId}/all`, {
    query: {
      type,
      sort: query.sort === 'recent' ? 'addedAt:desc' : 'titleSort:asc',
      genre,
      'X-Plex-Container-Start': query.startIndex ?? 0,
      'X-Plex-Container-Size': query.limit ?? 60,
    },
  });
  const items = metadata(response).map(raw => mapPlexItem(http, raw));
  return { items, total: response?.MediaContainer?.totalSize ?? items.length };
}

export async function fetchItem(http: PlexHttp, id: string): Promise<MediaItem> {
  const raw = metadata(await http.get(`/library/metadata/${encodeURIComponent(id)}`))[0];
  if (!raw) {
    throw new Error('Plex returned no metadata');
  }
  return mapPlexItem(http, raw);
}

export async function fetchRawItem(http: PlexHttp, id: string): Promise<PlexMetadata | undefined> {
  return metadata(await http.get(`/library/metadata/${encodeURIComponent(id)}`))[0];
}

/** Seasons of a show, or episodes of a season, in Plex's order. */
export async function fetchChildren(http: PlexHttp, id: string): Promise<MediaItem[]> {
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/metadata/${encodeURIComponent(id)}/children`);
  return metadata(response).map(raw => mapPlexItem(http, raw));
}

/** Every episode of a show with this user's progress; specials are season 0. */
export async function fetchEpisodes(http: PlexHttp, showId: string): Promise<MediaItem[]> {
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/metadata/${encodeURIComponent(showId)}/allLeaves`);
  return metadata(response)
    .map(raw => mapPlexItem(http, raw))
    .sort((a, b) => (a.seasonIndex ?? 0) - (b.seasonIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0));
}

/**
 * Plex's On Deck mixes part-watched titles with the next episode of shows in progress. Split it: anything
 * with a resume point is Continue Playing; an episode without one is Up Next.
 */
async function fetchOnDeck(http: PlexHttp): Promise<MediaItem[]> {
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>('/library/onDeck', {
    query: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 60 },
  });
  return metadata(response).map(raw => mapPlexItem(http, raw));
}

export async function fetchContinuePlaying(http: PlexHttp): Promise<MediaItem[]> {
  return (await fetchOnDeck(http))
    .filter(item => item.resumeMs > 0)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}

export async function fetchUpNext(http: PlexHttp): Promise<MediaItem[]> {
  return (await fetchOnDeck(http)).filter(item => item.kind === 'episode' && item.resumeMs === 0).slice(0, 12);
}

/** Newest titles in one library: movies, or one entry per show. */
export async function fetchRecentlyAdded(http: PlexHttp, sectionId: string): Promise<MediaItem[]> {
  const type = await sectionType(http, sectionId);
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/sections/${sectionId}/all`, {
    query: { type, sort: 'addedAt:desc', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 16 },
  });
  return metadata(response).map(raw => mapPlexItem(http, raw));
}

const GENRE_TILE_LIMIT = 8;

/** Genres across movie and show libraries, merged by name, with a picture from one title where possible. */
export async function fetchGenres(http: PlexHttp): Promise<GenreTile[]> {
  const libraries = await fetchLibraries(http);
  const bySection = await Promise.all(
    libraries.map(async l => {
      const response = await http.get<Container<{ Directory?: Directory[] }>>(`/library/sections/${l.id}/genre`);
      return (response?.MediaContainer?.Directory ?? []).map(d => ({ section: l.id, id: d.key, name: d.title ?? '' }));
    }),
  );
  const seen = new Map<string, { section: string; id: string; name: string }>();
  for (const g of bySection.flat()) {
    if (g.name && !seen.has(g.name.toLowerCase())) {
      seen.set(g.name.toLowerCase(), g);
    }
  }
  const all = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const withArt = await Promise.all(
    all.slice(0, GENRE_TILE_LIMIT).map(async (g): Promise<GenreTile> => {
      try {
        const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/sections/${g.section}/all`, {
          query: { genre: g.id, sort: 'random', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 1 },
        });
        const pick = metadata(response)[0];
        return { name: g.name, imageUrl: plexImageUrl(http, pick?.art, LANDSCAPE_WIDTH, 360) };
      } catch {
        return { name: g.name };
      }
    }),
  );
  return [...withArt, ...all.slice(GENRE_TILE_LIMIT).map(g => ({ name: g.name }))];
}

/** Titles in one genre across libraries, newest first. Episodes are never included. */
export async function fetchByGenre(http: PlexHttp, genre: string, filter: KindFilter, limit: number): Promise<MediaItem[]> {
  const libraries = (await fetchLibraries(http)).filter(l =>
    filter === 'movies' ? l.kind === 'movies' : filter === 'series' ? l.kind === 'tvshows' : true,
  );
  const lists = await Promise.all(
    libraries.map(async l => {
      const id = await genreId(http, l.id, genre);
      if (!id) {
        return [];
      }
      const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/sections/${l.id}/all`, {
        query: { genre: id, sort: 'addedAt:desc', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': limit },
      });
      return metadata(response);
    }),
  );
  return lists
    .flat()
    .map(raw => ({ raw, item: mapPlexItem(http, raw) }))
    .sort((a, b) => (b.raw.addedAt ?? 0) - (a.raw.addedAt ?? 0))
    .slice(0, limit)
    .map(x => x.item);
}

const SEARCH_TYPES: Record<KindFilter, string[]> = {
  all: ['movie', 'show', 'episode'],
  movies: ['movie'],
  series: ['show'],
  episodes: ['episode'],
};

export async function searchItems(http: PlexHttp, term: string, filter: KindFilter): Promise<MediaItem[]> {
  const trimmed = term.trim();
  if (!trimmed) {
    return [];
  }
  const response = await http.get<Container<{ Hub?: Array<{ type?: string; Metadata?: PlexMetadata[] }> }>>('/hubs/search', {
    query: { query: trimmed, limit: 30 },
  });
  const wanted = SEARCH_TYPES[filter];
  return (response?.MediaContainer?.Hub ?? [])
    .filter(hub => wanted.includes(hub.type ?? ''))
    .flatMap(hub => hub.Metadata ?? [])
    .filter(raw => wanted.includes(raw.type ?? ''))
    .map(raw => mapPlexItem(http, raw));
}

export async function fetchSimilar(http: PlexHttp, id: string): Promise<MediaItem[]> {
  const response = await http.get<Container<{ Metadata?: PlexMetadata[] }>>(`/library/metadata/${encodeURIComponent(id)}/similar`, {
    query: { count: 12 },
  });
  return metadata(response).map(raw => mapPlexItem(http, raw));
}

/** Watched or unwatched for this user. Unwatching also clears the resume point, as on Jellyfin. */
export async function setPlayed(http: PlexHttp, id: string, played: boolean): Promise<void> {
  await http.get(played ? '/:/scrobble' : '/:/unscrobble', {
    query: { key: id, identifier: 'com.plexapp.plugins.library' },
  });
}
