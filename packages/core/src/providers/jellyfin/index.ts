import type {
  DeviceCapabilities,
  ServerRecord,
  GenreTile,
  ItemPage,
  KindFilter,
  ItemQuery,
  Library,
  LibraryCapabilities,
  LibraryFacets,
  LibraryPage,
  LibraryView,
  MediaItem,
  MediaProvider,
  MediaVersion,
  PlaybackDecision,
  PlaybackOptions,
  ProgressReport,
  Session,
} from '../types';
import { JellyfinHttp, type DeviceInfo, type FetchLike } from './http';
import {
  fetchChildren,
  fetchContinuePlaying,
  fetchEpisodes,
  fetchSimilar,
  fetchByGenre,
  fetchGenres,
  fetchItem,
  fetchItems,
  fetchLibraries,
  fetchRecentlyAdded,
  fetchUpNext,
  markPlayed,
  searchItems,
  setFavorite,
  setPlayed,
} from './items';
import {
  getPlaybackDecision,
  reportProgress,
  reportStarted,
  reportStopped,
  stopTranscode,
} from './playback';
import { countJellyfinLibrary, fetchLibraryFacets, jellyfinLibraryCapabilities, queryJellyfinLibrary } from './library';
import { fetchVersions } from './versions';

/**
 * Jellyfin, and Emby through the same code: Jellyfin forked from Emby and the two still share the item,
 * playback and progress API this provider uses. Only the headers differ (see `ApiDialect`).
 */
export class JellyfinProvider implements MediaProvider {
  readonly kind: 'jellyfin' | 'emby';

  constructor(
    readonly session: Session,
    private readonly http: JellyfinHttp,
    private readonly caps: DeviceCapabilities,
  ) {
    this.kind = http.dialect;
  }

  getLibraries(): Promise<Library[]> {
    return fetchLibraries(this.http, this.session.userId);
  }

  getItems(query: ItemQuery): Promise<ItemPage> {
    return fetchItems(this.http, this.session.userId, query);
  }

  getItem(id: string): Promise<MediaItem> {
    return fetchItem(this.http, this.session.userId, id);
  }

  getChildren(id: string): Promise<MediaItem[]> {
    return fetchChildren(this.http, this.session.userId, id);
  }

  getContinuePlaying(): Promise<MediaItem[]> {
    return fetchContinuePlaying(this.http, this.session.userId);
  }

  getUpNext(): Promise<MediaItem[]> {
    return fetchUpNext(this.http, this.session.userId);
  }

  getRecentlyAdded(libraryId: string): Promise<MediaItem[]> {
    return fetchRecentlyAdded(this.http, this.session.userId, libraryId);
  }

  getGenres(): Promise<GenreTile[]> {
    return fetchGenres(this.http, this.session.userId);
  }

  getByGenre(genre: string, filter: KindFilter, limit: number): Promise<MediaItem[]> {
    return fetchByGenre(this.http, this.session.userId, genre, filter, limit);
  }

  search(term: string, filter: KindFilter, signal?: AbortSignal): Promise<MediaItem[]> {
    return searchItems(this.http, this.session.userId, term, filter, signal);
  }

  getLibraryCapabilities(library: Library): Promise<LibraryCapabilities> {
    return Promise.resolve(jellyfinLibraryCapabilities(library));
  }

  getLibraryFacets(library: Library, signal?: AbortSignal): Promise<LibraryFacets> {
    return fetchLibraryFacets(this.http, this.session.userId, library, signal);
  }

  queryLibrary(library: Library, view: LibraryView, start: number, limit: number, signal?: AbortSignal): Promise<LibraryPage<MediaItem>> {
    return queryJellyfinLibrary(this.http, this.session.userId, library, view, start, limit, signal);
  }

  countLibrary(library: Library, view: LibraryView, signal?: AbortSignal): Promise<number | null> {
    return countJellyfinLibrary(this.http, this.session.userId, library, view, signal);
  }

  setPlayed(id: string, played: boolean): Promise<void> {
    return setPlayed(this.http, this.session.userId, id, played);
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return setFavorite(this.http, this.session.userId, id, favorite);
  }

  getEpisodes(seriesId: string): Promise<MediaItem[]> {
    return fetchEpisodes(this.http, this.session.userId, seriesId);
  }

  getVersions(id: string): Promise<MediaVersion[]> {
    return fetchVersions(this.http, this.session.userId, id);
  }

  getSimilar(id: string): Promise<MediaItem[]> {
    return fetchSimilar(this.http, this.session.userId, id);
  }

  markPlayed(id: string): Promise<void> {
    return markPlayed(this.http, this.session.userId, id);
  }

  getPlayback(itemId: string, options?: PlaybackOptions): Promise<PlaybackDecision> {
    return getPlaybackDecision(this.http, this.session.userId, this.caps, itemId, options);
  }

  reportStarted(report: ProgressReport): Promise<void> {
    return reportStarted(this.http, report);
  }

  reportProgress(report: ProgressReport): Promise<void> {
    return reportProgress(this.http, report);
  }

  reportStopped(report: ProgressReport): Promise<void> {
    return reportStopped(this.http, report);
  }

  stopTranscode(decision: PlaybackDecision): Promise<void> {
    return stopTranscode(this.http, decision);
  }
}

export function createJellyfinProvider(
  session: Session,
  device: DeviceInfo,
  caps: DeviceCapabilities,
  fetchImpl?: FetchLike,
): JellyfinProvider {
  return new JellyfinProvider(session, httpForServer(session.server, device, session.accessToken, fetchImpl), caps);
}

/** A client for a Jellyfin or Emby server, speaking its own dialect. */
export function httpForServer(
  server: Pick<ServerRecord, 'kind' | 'baseUrl'>,
  device: DeviceInfo,
  token?: string,
  fetchImpl?: FetchLike,
): JellyfinHttp {
  return new JellyfinHttp(server.baseUrl, device, token, fetchImpl, server.kind === 'emby' ? 'emby' : 'jellyfin');
}

export { JellyfinHttp } from './http';
export type { ApiDialect, DeviceInfo, FetchLike } from './http';
export { identifyServer, probeServer, serverProduct } from './probe';
export { checkSession, QuickConnectFlow, signInWithPassword, type SessionCheck } from './auth';
export { describeError, isJellyfinError, JellyfinError } from './errors';
