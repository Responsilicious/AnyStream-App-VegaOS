# Jellyfin collections

Implemented 3 Nov 2026 from Will's plan "AnyStream — Jellyfin Collections implementation plan" (v1.0). This file records what shipped, how it maps to Jellyfin, what was verified and how, and what is still open.

## What the user sees

- **Top bar:** Collections after Genres, only when the active server supports it (Jellyfin today). Plex and Emby show no entry rather than a disabled one. With Collections and a long server name the bar is about 1780 of 1920 design pixels; the server pill is capped at 420 and shortens its name, so nothing overflows.
- **Home:** one portrait **Collections** row at the very bottom, under Browse by genre, with **View all** at the end. It is one request for 12 collections, made after the other rows are on screen, so it never delays Continue Playing or Up Next. No row when there are none or the request fails.
- **Collections page:** heading, the number of collections, a **Search collections** field (on-screen keyboard; results follow typing after a short pause), **Sort: Title A–Z / Z–A**, **Clear search**, then a six-column poster grid with the title under each poster. No filters: a mixed collection has no single runtime, resolution or watched state.
- **Collection page:** Back link, a breadcrumb for nested collections (Collections › Marvel › Phase One), title, "Collection · 12 titles", the overview (More / Less when long), **Browse titles** (moves focus to the first card) and **Sort: Collection order**, a contained 16:9 still on the right (decoration, never focusable), then the members as cards that say what each is: "Movie · 1999", "Episode · S2 E5 · Show", "Season 3 · Show", "Collection". Nothing on either page plays.
- **States:** loading; no collections yet ("made and managed on your Jellyfin server", Refresh); no search matches (Clear search); a collection with no titles this account can see ("None of this collection's titles are available to this account right now"); a removed or no longer shared collection (explains, Back); a collection that contains itself (explains, Back); connection, sign-in and server errors show the usual message and Try again, never an empty list.

## Routing members

| Member | Opens |
|---|---|
| Movie | Its title page |
| Series | Its series page, on the usual episode |
| Episode | Its series page with that exact episode (and so its season) selected |
| Season | Its series page on that season, choosing within it as the page normally would (resume, else next unwatched, else first) |
| Collection | Another collection page; Back returns to this one |
| Episode or season without a series id | The app asks the server for the item first; if it still has none, the card says it couldn't find the series |
| Anything else (music video, home video, …) | Nothing: the card says "Not available in AnyStream" and a press explains why. Never treated as a movie |

Series are never expanded into episodes and nested collections are never flattened.

## Ordering, paging and saved sorts

- **Collection order** is the default and sends no sort at all, so the server's own order stands: Jellyfin sorts a collection's members by its display-order setting (release date unless changed on the server, or the order they were added when set to Default) and only then pages. That is what the label means; the app never sorts on the TV.
- Other member orders: Title A–Z, Title Z–A, Release date oldest / newest. All are sent to the server, which sorts every member before paging, so page two continues the same order. Release date sorts by premiere date, then year, then title; titles without a date are grouped together by the server, A–Z among themselves.
- **Saved sorts** (`library/collections.ts`, `CollectionPrefsStore`): the Collections page sort per provider + server + viewer; a collection's sort per provider + server + viewer + collection id, saved only when it is not Collection order. Keys are `anystream.collections.v1.*`, apart from the Movies and Series views (`anystream.libraryView.v1.*`), so neither can overwrite the other. The saved sort is in the first request. Clearing a search keeps the sort.
- **Back** restores the Collections page (search, sort, loaded pages, focused card) and each collection page on the way (order, loaded pages, focused card, metadata) without asking the server again. Records are dropped when Back leaves a page, on a top-bar choice, and on any server or profile switch. Paging and late answers go through the same `BrowseController` as Movies and Series, now generic over the query type, so an answer for an older search or sort is ignored.

## Jellyfin mapping (`providers/jellyfin/collections.ts`)

Read-only: only `GET /Users/{userId}/Items` and `/Users/{userId}/Items/{id}` with the viewer's own token. The Collections API (create, add, remove) is never called.

| Need | Request |
|---|---|
| List collections | `IncludeItemTypes=BoxSet&Recursive=true&SortBy=SortName&SortOrder=…&SearchTerm=…&StartIndex&Limit`, no ParentId |
| One collection | `/Users/{u}/Items/{id}`; anything that is not a `BoxSet` counts as removed |
| Members | `ParentId={id}&Recursive=false&CollapseBoxSetItems=false`, plus SortBy only for a chosen order |

Repeated references in a page are dropped by id, never merged by title. Collections are `MediaItem`s of kind `'collection'` (`Type=BoxSet`); `CollectionFolder` (a library) is never treated as one.

**Movies, Series and genre reels now send `CollapseBoxSetItems=false`.** Without it, a server with "Group movies into collections" turned on returns BoxSets in place of their movies, which the app would have shown as broken movie cards. Titles now stay individual whatever the server setting, and the setting itself is never changed.

## What was verified, and how

Will's server was not reachable from the build sandbox, so the behaviour above was checked against the Jellyfin server source (master, 3 Nov 2026: `Jellyfin.Api/Controllers/ItemsController.cs`, `MediaBrowser.Controller/Entities/Folder.cs`, `Entities/Movies/BoxSet.cs`, `Emby.Server.Implementations/Dto/DtoService.cs`):

- `IncludeItemTypes=BoxSet` from the user root runs a recursive query whose BoxSets are filtered per user in memory (share and library access), so collections of any library are found and each appears once.
- With a BoxSet as parent, `CollapseBoxSetItems` is always off; `GetChildren` returns the linked children this user may see, sorted by the BoxSet's `DisplayOrder` (`PremiereDate` by default; `Default` keeps insertion order); `SortAndPage` keeps that order when no SortBy is given and applies a given SortBy to the whole list before paging.
- `TotalRecordCount` for members is counted after the same filtering, so "12 titles" is what this viewer can open. `ChildCount` on the BoxSet counts linked children by library access only, not parental rating, so it is never shown; collection cards show no count.
- A BoxSet whose members are all above a restricted user's rating limit is hidden from that user by the server.

Still to confirm on a real server: older versions (10.8 / 10.9) and Will's own version, `SearchTerm` on BoxSets, a nested and a self-containing collection, a mixed collection, a restricted user, and that Home stays quick with many collections. `apps/vega/scripts/verify-jellyfin-collections.mjs` prints all of these from a viewer token (GET only):

```sh
JELLYFIN_URL=https://watch.example.com JELLYFIN_TOKEN=<token> node apps/vega/scripts/verify-jellyfin-collections.mjs
```

## Not in this release

Collection links on title pages (needs a bounded reverse lookup), pinned or favourite collections, Play all, creating or editing collections, artwork changes, Plex and Emby collections. Emby has BoxSets too; it stays off until its ordering and visibility are checked the same way.

## Known gaps

- Not yet run on a stick or the simulator: focus movement, the keyboard over the grid, Back from nested pages and the 1920 × 1080 layout need a device check.
- Home's Collections row focus is restored on Back only once the row has loaded (it loads after the rest of Home).
- Member cards use each member's primary image; an episode's primary image is a landscape still, so it is cropped to the portrait card.
