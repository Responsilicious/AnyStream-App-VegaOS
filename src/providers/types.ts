/**
 * Provider-agnostic model. Screens and the player only ever see these types, so
 * adding Plex (M4) means a new folder under providers/, not changes elsewhere.
 */

import type { LibraryCapabilities, LibraryFacets, LibraryPage, LibraryView } from './libraryQuery';

export type {
  FilterState,
  GenreFacet,
  LibraryCapabilities,
  LibraryFacets,
  LibraryPage,
  LibraryView,
  SortPreset,
  WatchStatus,
  YearRange,
} from './libraryQuery';

export type ServerKind = 'jellyfin' | 'plex';

export interface ServerRecord {
  /** The server's own id (Jellyfin `Id`, Plex `machineIdentifier`). */
  id: string;
  kind: ServerKind;
  name: string;
  baseUrl: string;
}

export interface Session {
  server: ServerRecord;
  userId: string;
  userName: string;
  accessToken: string;
}

export interface Library {
  id: string;
  name: string;
  kind: 'movies' | 'tvshows' | 'other';
}

export interface MediaItem {
  id: string;
  title: string;
  kind: 'movie' | 'series' | 'season' | 'episode' | 'other';
  year?: number;
  overview?: string;
  runtimeMs?: number;
  /** Where to resume, or 0 when unwatched or finished. */
  resumeMs: number;
  played: boolean;
  posterUrl?: string;
  backdropUrl?: string;
  genres?: string[];
  /** Age rating such as "PG-13", as the server reports it. */
  officialRating?: string;
  /** Community score out of 10. */
  communityRating?: number;
  /** Actor names, billing order. Only filled by getItem. */
  cast?: string[];
  /** Episode number within its season, or season number within its series. */
  index?: number;
  /** For an episode: the season it belongs to. */
  seasonIndex?: number;
  seriesId?: string;
  seriesTitle?: string;
  /** Wide still for an episode row. */
  thumbUrl?: string;
  /** When the signed-in user last played this, in epoch milliseconds. */
  lastPlayed?: number;
  /** On this user's favourites list. */
  favorite?: boolean;
  /** Director names. Only filled by getItem. */
  directors?: string[];
  /** 16:9 artwork for Home cards: an episode still, or a title thumb or backdrop. */
  landscapeUrl?: string;
}

/** Which kinds of title a genre reel or a search should include. */
export type KindFilter = 'all' | 'movies' | 'series' | 'episodes';

/** A genre as Home and the Genres screen show it: a name over a picture from one of its titles. */
export interface GenreTile {
  name: string;
  imageUrl?: string;
}

export interface ItemPage {
  items: MediaItem[];
  total: number;
}

export interface ItemQuery {
  parentId: string;
  startIndex?: number;
  limit?: number;
  genres?: string[];
  /** 'name' is A to Z (the default); 'recent' is newest added first. */
  sort?: 'name' | 'recent';
}

/** What this TV can decode. Built once per launch, then shaped per provider. */
export interface DeviceCapabilities {
  videoCodecs: string[];
  audioCodecs: string[];
  /** Containers that URL mode (plain MP4/MP3 playback) is trusted to handle. */
  directPlayContainers: string[];
  /** Codecs requested when the server transcodes to HLS. */
  hlsVideoCodecs: string[];
  hlsAudioCodecs: string[];
  maxWidth: number;
  maxHeight: number;
  /** bits per second */
  maxBitrate: number;
}

export type PlayMethod = 'DirectPlay' | 'Transcode';

/** 'url' = HTMLMediaElement.src (MP4); 'hls' = MSE via the Amazon hls.js build. */
export type PlaybackMode = 'url' | 'hls';

/** One audio track or subtitle track of the file being played. */
export interface TrackOption {
  /** The server's stream index: what to send back to pick it. */
  index: number;
  /** What the menu shows, such as "English  ·  AC3 5.1". */
  label: string;
  language?: string;
  isDefault: boolean;
  /** Marked forced by the file: the subtitle is for foreign-language lines only. */
  isForced?: boolean;
}

export interface TrackInfo {
  audio: TrackOption[];
  subtitles: TrackOption[];
}

/** The tracks in use: an audio index and a subtitle index, or -1 for subtitles off. */
export interface TrackSelection {
  audioIndex?: number;
  subtitleIndex: number;
}

/** One version of a title (a cut, or the same film at another quality), with what the title page shows for it. */
export interface MediaVersion {
  /** What to pass as `mediaSourceId` to play this version. */
  id: string;
  /** "2160p", "Director's Cut" or similar; "Version 2" when the server gives no name. */
  name: string;
  runtimeMs?: number;
  /** Quality marks this version really has, in display order: "4K", "Dolby Vision" or "HDR", "7.1" or "5.1", "Atmos". */
  badges: string[];
  tracks?: TrackInfo;
  /** The audio track that plays when none is chosen. */
  defaultAudioIndex?: number;
}

/** What to play when starting from a title page: a version and tracks chosen there. Anything left out uses the defaults. */
export interface StartChoice {
  mediaSourceId?: string;
  audioIndex?: number;
  subtitleIndex?: number;
}

export interface PlaybackDecision {
  mode: PlaybackMode;
  method: PlayMethod;
  url: string;
  mediaSourceId: string;
  playSessionId?: string;
  durationMs?: number;
  /** Which tracks the file has; may be missing for a source that does not describe them. */
  tracks?: TrackInfo;
  /** Which of them this stream plays. */
  selection?: TrackSelection;
  /** The audio track the file plays when none is asked for. */
  defaultAudioIndex?: number;
}

export interface PlaybackOptions {
  startMs?: number;
  /** Skip direct play and ask the server for an HLS transcode. */
  forceTranscode?: boolean;
  maxBitrate?: number;
  /** Play this audio track. Left out, the server's default track plays. */
  audioIndex?: number;
  /** Show this subtitle track, burned into the picture by the server; -1 or left out for none. */
  subtitleIndex?: number;
  /** The version of the file the track indexes belong to. The server ignores track choices without it. */
  mediaSourceId?: string;
}

export type ProgressEvent = 'start' | 'progress' | 'pause' | 'resume' | 'stop';

export interface ProgressReport {
  item: MediaItem;
  decision: PlaybackDecision;
  positionMs: number;
  paused: boolean;
}

/** The slice of a provider that the playback controller depends on. */
export interface PlaybackProvider {
  getPlayback(itemId: string, options?: PlaybackOptions): Promise<PlaybackDecision>;
  reportStarted(report: ProgressReport): Promise<void>;
  reportProgress(report: ProgressReport): Promise<void>;
  reportStopped(report: ProgressReport): Promise<void>;
  stopTranscode(decision: PlaybackDecision): Promise<void>;
}

export interface MediaProvider extends PlaybackProvider {
  readonly kind: ServerKind;
  readonly session: Session;
  getLibraries(): Promise<Library[]>;
  getItems(query: ItemQuery): Promise<ItemPage>;
  /** One title with its full metadata (cast, genres, rating). */
  getItem(id: string): Promise<MediaItem>;
  /** Seasons of a series, or episodes of a season, in watching order. */
  getChildren(id: string): Promise<MediaItem[]>;
  /** Started but unfinished titles, most recently watched first. */
  getContinuePlaying(): Promise<MediaItem[]>;
  /** The next unwatched episode of each series already being watched. */
  getUpNext(): Promise<MediaItem[]>;
  /** Newly added titles in one library. */
  getRecentlyAdded(libraryId: string): Promise<MediaItem[]>;
  /** Genres that have at least one title, with a picture where one is available. */
  getGenres(): Promise<GenreTile[]>;
  /** Marks a title as watched. This also takes it out of Continue Playing. */
  markPlayed(id: string): Promise<void>;
  /** Sets the watched state either way. Unwatching also clears the resume point. */
  setPlayed(id: string, played: boolean): Promise<void>;
  /** Adds or removes a title from the user's favourites. */
  setFavorite(id: string, favorite: boolean): Promise<void>;
  /** Every episode of a series, with this user's progress: seasons in order, specials as season 0. */
  getEpisodes(seriesId: string): Promise<MediaItem[]>;
  /** The playable versions of a movie or episode, with quality badges and tracks. Usually one. */
  getVersions(id: string): Promise<MediaVersion[]>;
  /** Titles like this one, for "More like this". */
  getSimilar(id: string): Promise<MediaItem[]>;
  /** Titles in one genre, for a genre reel. Episodes are never included. */
  getByGenre(genre: string, filter: KindFilter, limit: number): Promise<MediaItem[]>;
  /** Titles matching what was typed. A blank term finds nothing. */
  search(term: string, filter: KindFilter): Promise<MediaItem[]>;
  /** Which filters and sorts this library really supports (Movies and Series pages). */
  getLibraryCapabilities(library: Library, signal?: AbortSignal): Promise<LibraryCapabilities>;
  /** The genres this viewer can see in this library, with the server's own ids. */
  getLibraryFacets(library: Library, signal?: AbortSignal): Promise<LibraryFacets>;
  /** One page of the library, filtered and sorted by the server across the whole library. */
  queryLibrary(library: Library, view: LibraryView, start: number, limit: number, signal?: AbortSignal): Promise<LibraryPage<MediaItem>>;
  /** How many titles a filter matches, or null when the server cannot say exactly. */
  countLibrary(library: Library, view: LibraryView, signal?: AbortSignal): Promise<number | null>;
}
