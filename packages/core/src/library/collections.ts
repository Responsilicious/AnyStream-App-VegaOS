import type { CollectionListQuery, CollectionListSort, CollectionSort, MediaItem } from '../providers/types';
import type { KeyValueStore } from '../storage/keyValueStore';
import { typeLabel } from '../util/format';

/**
 * Collections page and collection page rules (docs/collections.md): sort choices and their words, the saved sort
 * for each, and where a member card leads. Pure, so it is unit-tested in Node.
 */

export const COLLECTION_LIST_SORTS: CollectionListSort[] = ['titleAsc', 'titleDesc'];
export const COLLECTION_MEMBER_SORTS: CollectionSort[] = ['collection', 'titleAsc', 'titleDesc', 'releaseAsc', 'releaseDesc'];
export const DEFAULT_LIST_SORT: CollectionListSort = 'titleAsc';
/** A collection opens in the order its server keeps for it until the viewer picks another. */
export const DEFAULT_MEMBER_SORT: CollectionSort = 'collection';

const SORT_LABELS: Record<CollectionSort, string> = {
  collection: 'Collection order',
  titleAsc: 'Title A–Z',
  titleDesc: 'Title Z–A',
  releaseAsc: 'Release date, oldest first',
  releaseDesc: 'Release date, newest first',
};

const SORT_HELP: Partial<Record<CollectionSort, string>> = {
  collection: 'The order set for this collection on the server',
  releaseAsc: 'Titles without a date are grouped together, A–Z',
  releaseDesc: 'Titles without a date are grouped together, A–Z',
};

export function collectionSortLabel(sort: CollectionSort): string {
  return SORT_LABELS[sort];
}

export function collectionSortHelp(sort: CollectionSort): string | undefined {
  return SORT_HELP[sort];
}

/** The key a collections query is known by: a late page for another search or sort is recognised and dropped. */
export function listQueryKey(query: CollectionListQuery): string {
  return `${query.sort}|${(query.search ?? '').trim().toLowerCase()}`;
}

/** Who a saved Collections sort belongs to. Collections span a server's libraries, so there is no library id. */
export interface CollectionScope {
  provider: string;
  serverId: string;
  /** The viewer: the signed-in user or profile. */
  userId: string;
}

const PREFIX = 'anystream.collections.v1';

function scopePath(scope: CollectionScope): string {
  return [scope.provider, scope.serverId, scope.userId].map(encodeURIComponent).join('/');
}

/**
 * The sort applied on the Collections page, and on each collection page where the viewer changed it. Separate keys
 * from the Movies and Series views (library/prefsStore.ts), so neither can overwrite the other. A collection with no
 * saved choice opens in Collection order. Damaged or unknown values read as "nothing saved".
 */
export class CollectionPrefsStore {
  constructor(private readonly store: KeyValueStore) {}

  listSort(scope: CollectionScope): CollectionListSort {
    const raw = this.store.getString(`${PREFIX}.list.${scopePath(scope)}`);
    return COLLECTION_LIST_SORTS.includes(raw as CollectionListSort) ? (raw as CollectionListSort) : DEFAULT_LIST_SORT;
  }

  saveListSort(scope: CollectionScope, sort: CollectionListSort): void {
    this.store.set(`${PREFIX}.list.${scopePath(scope)}`, sort);
  }

  memberSort(scope: CollectionScope, collectionId: string): CollectionSort {
    const raw = this.store.getString(this.memberKey(scope, collectionId));
    return COLLECTION_MEMBER_SORTS.includes(raw as CollectionSort) ? (raw as CollectionSort) : DEFAULT_MEMBER_SORT;
  }

  saveMemberSort(scope: CollectionScope, collectionId: string, sort: CollectionSort): void {
    const key = this.memberKey(scope, collectionId);
    if (sort === DEFAULT_MEMBER_SORT) {
      // Back to the default: nothing to remember.
      this.store.delete(key);
    } else {
      this.store.set(key, sort);
    }
  }

  private memberKey(scope: CollectionScope, collectionId: string): string {
    return `${PREFIX}.members.${scopePath(scope)}/${encodeURIComponent(collectionId)}`;
  }
}

/** Where choosing a member card goes. Nothing here ever plays. */
export type MemberTarget =
  /** A movie's title page. */
  | { to: 'detail'; item: MediaItem }
  /** A series page, with one episode or one season selected when the card stood for it. */
  | { to: 'series'; series: MediaItem; episodeId?: string; season?: number }
  /** Another collection's page. */
  | { to: 'collection'; item: MediaItem }
  /** An episode or season that does not say which series it belongs to: ask the server before going anywhere. */
  | { to: 'resolve'; item: MediaItem }
  /** A kind of item the app has no page for: say so on the card. */
  | { to: 'unsupported'; reason: string };

function seriesStub(item: MediaItem, seriesId: string): MediaItem {
  return { id: seriesId, title: item.seriesTitle ?? item.title, kind: 'series', resumeMs: 0, played: false };
}

/** Routes a member by its real kind (docs/collections.md section 4). Episodes and seasons need their series' id. */
export function memberTarget(item: MediaItem): MemberTarget {
  switch (item.kind) {
    case 'movie':
      return { to: 'detail', item };
    case 'series':
      return { to: 'series', series: item };
    case 'collection':
      return { to: 'collection', item };
    case 'episode':
      return item.seriesId ? { to: 'series', series: seriesStub(item, item.seriesId), episodeId: item.id } : { to: 'resolve', item };
    case 'season':
      // A season's number is its index; without one the series still opens, on its usual episode.
      return item.seriesId ? { to: 'series', series: seriesStub(item, item.seriesId), season: item.index } : { to: 'resolve', item };
    default:
      return { to: 'unsupported', reason: `${memberTypeLabel(item)} items can't be opened in AnyStream yet.` };
  }
}

/** Splits "MusicVideo" into "Music video" for a type the app has no word of its own for. */
function spacedType(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The type word on a member card: mixed collections must say what each card is. */
export function memberTypeLabel(item: MediaItem): string {
  if (item.kind === 'collection') {
    return 'Collection';
  }
  if (item.kind === 'other') {
    return item.typeName ? spacedType(item.typeName) : 'Other';
  }
  // typeLabel says "Documentary" for documentaries; the kind is what matters on a mixed shelf.
  switch (item.kind) {
    case 'movie':
      return 'Movie';
    case 'series':
      return 'Series';
    case 'season':
      return 'Season';
    case 'episode':
      return 'Episode';
    default:
      return typeLabel(item) || 'Other';
  }
}

/** The line under a member card: "Movie · 1999", "Episode · S2 E5 · Show", "Season 3 · Show". */
export function memberCaption(item: MediaItem): string {
  const parts: string[] = [];
  if (item.kind === 'episode') {
    parts.push('Episode');
    if (item.seasonIndex !== undefined && item.index !== undefined) {
      parts.push(`S${item.seasonIndex} E${item.index}`);
    }
    if (item.seriesTitle) {
      parts.push(item.seriesTitle);
    }
  } else if (item.kind === 'season') {
    parts.push(item.index !== undefined ? `Season ${item.index}` : 'Season');
    if (item.seriesTitle) {
      parts.push(item.seriesTitle);
    }
  } else {
    parts.push(memberTypeLabel(item));
    if (item.year) {
      parts.push(String(item.year));
    }
  }
  return parts.join('  ·  ');
}

/** "12 titles", or nothing when the count is not known. */
export function titleCount(total: number | null): string | undefined {
  if (total === null) {
    return undefined;
  }
  return total === 1 ? '1 title' : `${total} titles`;
}
