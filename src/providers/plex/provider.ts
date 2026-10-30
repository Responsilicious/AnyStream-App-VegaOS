import { newDeviceId } from '../../util/ids';
import type {
  DeviceCapabilities,
  GenreTile,
  ItemPage,
  ItemQuery,
  KindFilter,
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
import { PlexError } from './errors';
import { PlexHttp, type DeviceInfo, type FetchLike } from './http';
import {
  fetchByGenre,
  fetchChildren,
  fetchContinuePlaying,
  fetchEpisodes,
  fetchGenres,
  fetchItem,
  fetchItems,
  fetchLibraries,
  fetchRecentlyAdded,
  fetchSimilar,
  fetchUpNext,
  searchItems,
  setPlayed,
} from './items';
import { countPlexLibrary, fetchPlexCapabilities, fetchPlexFacets, queryPlexLibrary } from './library';
import { fetchPlexVersions, getPlexPlayback, reportPlex, stopPlexTranscode } from './playback';

/**
 * One Plex media server for one account. The session's token is that server's own access token from
 * discovery, never the plex.tv account token.
 */
export class PlexProvider implements MediaProvider {
  readonly kind = 'plex' as const;

  constructor(
    readonly session: Session,
    private readonly http: PlexHttp,
    private readonly caps: DeviceCapabilities,
  ) {}

  getLibraries(): Promise<Library[]> {
    return fetchLibraries(this.http);
  }

  getItems(query: ItemQuery): Promise<ItemPage> {
    return fetchItems(this.http, query);
  }

  getItem(id: string): Promise<MediaItem> {
    return fetchItem(this.http, id);
  }

  getChildren(id: string): Promise<MediaItem[]> {
    return fetchChildren(this.http, id);
  }

  getContinuePlaying(): Promise<MediaItem[]> {
    return fetchContinuePlaying(this.http);
  }

  getUpNext(): Promise<MediaItem[]> {
    return fetchUpNext(this.http);
  }

  getRecentlyAdded(libraryId: string): Promise<MediaItem[]> {
    return fetchRecentlyAdded(this.http, libraryId);
  }

  getGenres(): Promise<GenreTile[]> {
    return fetchGenres(this.http);
  }

  markPlayed(id: string): Promise<void> {
    return setPlayed(this.http, id, true);
  }

  setPlayed(id: string, played: boolean): Promise<void> {
    return setPlayed(this.http, id, played);
  }

  /** Plex has no favourites list for library items, so this says so rather than pretending. */
  setFavorite(_id: string, _favorite: boolean): Promise<void> {
    return Promise.reject(new PlexError('unsupported', 'Plex has no favourites'));
  }

  getEpisodes(seriesId: string): Promise<MediaItem[]> {
    return fetchEpisodes(this.http, seriesId);
  }

  getVersions(id: string): Promise<MediaVersion[]> {
    return fetchPlexVersions(this.http, id);
  }

  getSimilar(id: string): Promise<MediaItem[]> {
    return fetchSimilar(this.http, id);
  }

  getByGenre(genre: string, filter: KindFilter, limit: number): Promise<MediaItem[]> {
    return fetchByGenre(this.http, genre, filter, limit);
  }

  search(term: string, filter: KindFilter): Promise<MediaItem[]> {
    return searchItems(this.http, term, filter);
  }

  /** Asked once per library: what the server advertises does not change while the app runs. */
  private readonly capabilities = new Map<string, Promise<LibraryCapabilities>>();

  getLibraryCapabilities(library: Library, signal?: AbortSignal): Promise<LibraryCapabilities> {
    const key = `${library.id}:${library.kind}`;
    let found = this.capabilities.get(key);
    if (!found) {
      found = fetchPlexCapabilities(this.http, library, signal);
      // A failed or cancelled lookup is not remembered, so the next visit asks again.
      found.catch(() => this.capabilities.delete(key));
      this.capabilities.set(key, found);
    }
    return found;
  }

  getLibraryFacets(library: Library, signal?: AbortSignal): Promise<LibraryFacets> {
    return fetchPlexFacets(this.http, library, signal);
  }

  queryLibrary(library: Library, view: LibraryView, start: number, limit: number, signal?: AbortSignal): Promise<LibraryPage<MediaItem>> {
    return queryPlexLibrary(this.http, library, view, start, limit, signal);
  }

  countLibrary(library: Library, view: LibraryView, signal?: AbortSignal): Promise<number | null> {
    return countPlexLibrary(this.http, library, view, signal);
  }

  getPlayback(itemId: string, options?: PlaybackOptions): Promise<PlaybackDecision> {
    // A fresh transcode session per start, so a retry never reuses a stopped one.
    return getPlexPlayback(this.http, this.caps, itemId, newDeviceId(), options);
  }

  reportStarted(report: ProgressReport): Promise<void> {
    return reportPlex(this.http, report, 'start');
  }

  reportProgress(report: ProgressReport): Promise<void> {
    return reportPlex(this.http, report, 'progress');
  }

  reportStopped(report: ProgressReport): Promise<void> {
    return reportPlex(this.http, report, 'stop');
  }

  stopTranscode(decision: PlaybackDecision): Promise<void> {
    return stopPlexTranscode(this.http, decision);
  }
}

export function createPlexProvider(session: Session, device: DeviceInfo, caps: DeviceCapabilities, fetchImpl?: FetchLike): PlexProvider {
  return new PlexProvider(session, new PlexHttp(session.server.baseUrl, device, session.accessToken, fetchImpl), caps);
}
