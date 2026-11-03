import type { QueryValue } from '../../util/url';
import type { CollectionListQuery, CollectionSort, CollectionsSource, LibraryPage, MediaItem } from '../types';
import { JellyfinError } from './errors';
import type { JellyfinHttp } from './http';
import { mapItem, type JellyfinItem } from './items';

/**
 * Read-only Jellyfin collections (docs/collections.md). A collection is a `BoxSet`; its members are "linked
 * children", not files under it, so they are listed with the collection as the parent. Nothing here calls the
 * Collections API (create, add, remove): that API changes the server and is out of scope.
 *
 * Checked against the Jellyfin server source (ItemsController, Folder, BoxSet; 3 Nov 2026):
 * - `IncludeItemTypes=BoxSet&Recursive=true` with no ParentId searches from the user's root, so collections are found
 *   whichever libraries their titles live in, and the server filters each one by this user's access in memory.
 * - With a BoxSet as ParentId the server never collapses items into collections, and returns members in the
 *   collection's own display order (release date unless changed on the server) when no SortBy is sent. It sorts
 *   before it pages, so StartIndex walks one stable order and a SortBy applies to every member, not one page.
 * - `TotalRecordCount` for members counts what this user may see. `ChildCount` on the collection does not apply
 *   parental ratings, so it is never shown.
 */

interface ItemsResponse {
  Items: JellyfinItem[];
  TotalRecordCount?: number;
}

const FIELDS = 'Overview,ProductionYear,RunTimeTicks,Genres,OfficialRating,PremiereDate';
const IMAGES = { EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1 };

/** Sort parameters for members. 'collection' sends none, so the server's own collection order stands. */
const MEMBER_SORT: Record<CollectionSort, { SortBy?: string; SortOrder?: string }> = {
  collection: {},
  titleAsc: { SortBy: 'SortName', SortOrder: 'Ascending' },
  titleDesc: { SortBy: 'SortName', SortOrder: 'Descending' },
  // Title breaks ties, so titles with the same or no date still come in one fixed order.
  releaseAsc: { SortBy: 'PremiereDate,ProductionYear,SortName', SortOrder: 'Ascending,Ascending,Ascending' },
  releaseDesc: { SortBy: 'PremiereDate,ProductionYear,SortName', SortOrder: 'Descending,Descending,Ascending' },
};

/** The /Users/{id}/Items parameters that list collections. Exported for tests. */
export function collectionListQuery(query: CollectionListQuery, start: number, limit: number): Record<string, QueryValue> {
  const search = query.search?.trim();
  return {
    IncludeItemTypes: 'BoxSet',
    Recursive: true,
    SortBy: 'SortName',
    SortOrder: query.sort === 'titleDesc' ? 'Descending' : 'Ascending',
    SearchTerm: search ? search : undefined,
    Fields: 'Overview',
    ...IMAGES,
    StartIndex: start,
    Limit: limit,
    EnableTotalRecordCount: true,
  };
}

/** The /Users/{id}/Items parameters that list one collection's direct members. Exported for tests. */
export function collectionMembersQuery(id: string, sort: CollectionSort, start: number, limit: number): Record<string, QueryValue> {
  return {
    ParentId: id,
    // Direct members only: a series stays one card, a nested collection stays one card.
    Recursive: false,
    // Said explicitly although the server never collapses inside a collection: members must not hide behind boxes.
    CollapseBoxSetItems: false,
    ...MEMBER_SORT[sort],
    Fields: FIELDS,
    ...IMAGES,
    EnableUserData: true,
    StartIndex: start,
    Limit: limit,
    EnableTotalRecordCount: true,
  };
}

/** A page of items, each id once. A repeated reference (the same item twice) is dropped, never merged by title. */
function uniquePage(http: JellyfinHttp, response: ItemsResponse): LibraryPage<MediaItem> {
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  for (const raw of response.Items ?? []) {
    if (!raw?.Id || seen.has(raw.Id)) {
      continue;
    }
    seen.add(raw.Id);
    items.push(mapItem(http.baseUrl, raw));
  }
  return { items, total: typeof response.TotalRecordCount === 'number' ? response.TotalRecordCount : null };
}

export async function listJellyfinCollections(
  http: JellyfinHttp,
  userId: string,
  query: CollectionListQuery,
  start: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage<MediaItem>> {
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items`, { query: collectionListQuery(query, start, limit), signal });
  const page = uniquePage(http, response);
  // Only collections belong on this page, whatever else a server version mixes in.
  return { ...page, items: page.items.filter(item => item.kind === 'collection') };
}

export async function getJellyfinCollection(http: JellyfinHttp, userId: string, id: string, signal?: AbortSignal): Promise<MediaItem> {
  const raw = await http.get<JellyfinItem>(`/Users/${userId}/Items/${id}`, { signal });
  const item = mapItem(http.baseUrl, raw);
  if (item.kind !== 'collection') {
    // The id now names something else (or the server reused it): treat the collection as gone.
    throw new JellyfinError('not-found', `Not a collection: ${id}`);
  }
  return item;
}

export async function listJellyfinCollectionMembers(
  http: JellyfinHttp,
  userId: string,
  id: string,
  sort: CollectionSort,
  start: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LibraryPage<MediaItem>> {
  const response = await http.get<ItemsResponse>(`/Users/${userId}/Items`, { query: collectionMembersQuery(id, sort, start, limit), signal });
  return uniquePage(http, response);
}

export function jellyfinCollections(http: JellyfinHttp, userId: string): CollectionsSource {
  return {
    list: (query, start, limit, signal) => listJellyfinCollections(http, userId, query, start, limit, signal),
    get: (id, signal) => getJellyfinCollection(http, userId, id, signal),
    members: (id, sort, start, limit, signal) => listJellyfinCollectionMembers(http, userId, id, sort, start, limit, signal),
  };
}
