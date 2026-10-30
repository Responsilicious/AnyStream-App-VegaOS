import type { ExternalIds, MediaItem, ServerKind } from '../providers/types';

/**
 * Cross-server search model (docs/cross-server-search.md). Nothing here holds a token: a source names a saved
 * connection, and its provider is built privately from the connection store when a search runs.
 */

/** One saved connection that search can ask, as the profile it currently browses as. */
export interface SearchSource {
  /** The saved connection's id. Stable across a Plex profile change, so never use it alone as a cache key. */
  key: string;
  /** Prefix for anything cached per server + account + profile (connections/model.ts `contextKey`). */
  contextKey: string;
  provider: ServerKind;
  /** The server's own id (Jellyfin/Emby `Id`, Plex `machineIdentifier`). */
  serverId: string;
  /** The name shown for the server on this TV (alias, else the server's own). */
  label: string;
  profileName: string;
  /** Changes whenever the profile or credential behind the connection changes; results from an older one are dropped. */
  revision: string;
  /** False when the saved sign-in is missing or expired: listed as needing sign-in, never queried. */
  signedIn: boolean;
}

/** Points at one copy of a title: which provider, server and viewer, and the server's own item id. */
export interface ItemRef {
  provider: ServerKind;
  serverId: string;
  contextKey: string;
  itemId: string;
}

/** A collision-safe key for an item reference: the same id on two servers, or two profiles, never collides. */
export function refKey(ref: ItemRef): string {
  return [ref.provider, ref.serverId, ref.contextKey, ref.itemId].map(encodeURIComponent).join('/');
}

/** One title as one source returned it. */
export interface SourceHit {
  key: string;
  sourceKey: string;
  ref: ItemRef;
  /** As the source's provider mapped it: ids are native to that server. */
  item: MediaItem;
  /** Position in that source's own answer, for stable ordering. */
  rank: number;
}

export function makeHit(source: SearchSource, item: MediaItem, rank: number): SourceHit {
  const ref: ItemRef = { provider: source.provider, serverId: source.serverId, contextKey: source.contextKey, itemId: item.id };
  return { key: refKey(ref), sourceKey: source.key, ref, item, rank };
}

/** One card: every copy of what search believes is the same title, best copy first. */
export interface SearchGroup {
  /** Stable for a given set of copies, whatever order the servers answered in. */
  key: string;
  kind: MediaItem['kind'];
  /** Copies in preference order: the active connection's first, then the source order. */
  hits: SourceHit[];
  /** The copy the card shows. */
  display: SourceHit;
  /** 0 exact title, 1 title starts with the query, 2 anything else. */
  bucket: 0 | 1 | 2;
}

export type SourceStatus =
  | 'pending'
  | 'complete'
  /** Did not answer, or answered with an error: Retry may help. */
  | 'unavailable'
  /** Sign-in missing, expired or refused. Not queried again until the user signs in. */
  | 'auth-required'
  /** The server refused this profile. */
  | 'denied'
  | 'timed-out';

export interface SourceState {
  source: SearchSource;
  status: SourceStatus;
  /** Titles this source returned; it may have more, since each source is capped. */
  count: number;
}

/** Which ids count most when two disagree about a match. */
export const ID_ORDER: ReadonlyArray<keyof ExternalIds> = ['tmdb', 'imdb', 'tvdb'];
