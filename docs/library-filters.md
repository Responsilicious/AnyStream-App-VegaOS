# Movies and Series: filters and sorting

Implemented 30 Oct 2026 from Will's spec "AnyStream — Movies and Shows filters and sorting" (v1.1). This file records what shipped, how each choice maps to each server, and what is still unverified.

## What the user sees

- Under the page title (**Movies** or **Series**, matching the top bar): **Filters** (with the number of filter groups applied) and **Sort: Title A–Z** (always naming the order), then one removable chip per applied choice, then **Clear filters**.
- Both buttons open the same right-hand drawer, on the Filters or Sort tab. Both tabs edit one draft. Nothing changes until the main button (**Show 48 movies**, **Show movies**, **Apply sorting** or **Show results**) is pressed. **Reset all** resets the draft to no filters and Title A–Z without applying. Back or **Close** throws the draft away.
- Genre, Watch status and Year open their own list inside the drawer. Genre is a checklist with **Done** (several genres = any of them); the others return to their field after one choice. Back closes a list first, then the drawer.
- The page behind cannot take focus while the drawer is open (posters, toolbar, library tabs and the header are made non-focusable), and focus returns to the button that opened it.
- Zero results: "No movies match these filters", the choices in words, **Edit filters** and **Clear filters**. A failed request shows the error and **Try again**; it is never shown as zero results.

## Semantics

| Choice | Movies | Series |
|---|---|---|
| Genre | Any of the chosen genres (OR); groups combine with AND | same |
| Watch status | Any / Unwatched (not watched to the end, started ones included) / In progress (has a resume point) / Watched | Any / Has unwatched episodes / Completed (every available episode watched) |
| Year | Release year | First-aired year |
| Sort | Title A–Z, Z–A, Recently added, Release date newest/oldest, Community rating, Runtime shortest/longest | Title A–Z, Z–A, Recently added (the series itself, not its newest episode), First aired newest/oldest, Community rating |

Year choices are presets (this year, last 5 years, each decade back to the 1950s, before 1950); a simple list is quicker with a remote than number pickers. A saved range that is not a preset still shows, selected.

Not in this release, on purpose:

- **Series Not started / In progress.** Neither server filters series by "started" on the server side, and deriving it on the TV needs complete episode counts for the whole library. Withheld rather than approximated.
- **Age rating, video quality, "has unwatched episodes" as a separate toggle.** Age ratings differ by server and country; quality needs per-version resolution data. "Has unwatched episodes" is one of the Series watch states instead of a second control.

## Provider mapping

### Jellyfin (`src/providers/jellyfin/library.ts`)

Static capabilities: every field below has been part of `/Users/{userId}/Items` for many versions.

| Semantic | Parameter |
|---|---|
| Genres | `GenreIds=a\|b` (ids from `/Genres?ParentId=<library>&IncludeItemTypes=Movie\|Series`) |
| Year range | `Years=2020,2021,…` (matches ProductionYear) |
| Unwatched / Has unwatched episodes | `IsPlayed=false` |
| Watched / Completed | `IsPlayed=true` (a series is played when all its episodes are) |
| In progress (movies) | `Filters=IsResumable` |
| Sorts | `SortName`, `DateCreated`, `PremiereDate`, `CommunityRating`, `Runtime`, each followed by `SortName` as tie-breaker (`SortOrder=Descending,Ascending`) |
| Exact count | same query with `Limit=0` → `TotalRecordCount` |

### Plex (`src/providers/plex/library.ts`)

Capabilities come from the server itself: `/library/sections/<id>/all?type=<1|2>&includeMeta=1&X-Plex-Container-Size=0` returns `Meta.Type[]` with the filters and sorts the section accepts. An option appears only when its key is advertised (cached per library for the session; a failed lookup is retried next visit). Without that description the page offers only Title A–Z/Z–A and Recently added.

| Semantic | Parameter | Needs advertised |
|---|---|---|
| Genres | `genre=3,7` (comma = any of; ids from `/library/sections/<id>/genre?type=`) | `genre` |
| Year range | `year>>=2020&year<<=2026` | `year` |
| Unwatched / Watched | `unwatched=1` / `unwatched=0` | `unwatched` |
| In progress (movies) | `inProgress=1` | `inProgress` |
| Has unwatched episodes | `unwatchedLeaves=1` (or `unwatched=1` on servers that only advertise that) | `unwatchedLeaves` or `unwatched` |
| Completed (series) | `unwatchedLeaves=0` | `unwatchedLeaves` |
| Sorts | `titleSort`, `addedAt:desc`, `originallyAvailableAt`, `audienceRating:desc`, `duration`, each followed by `titleSort` | that sort key |
| Exact count | `X-Plex-Container-Size=0` → `totalSize` | — |

Emby: there is no Emby provider in AnyStream, so nothing is mapped.

## State, persistence and requests

- `src/library/viewState.ts`: semantic state, labels, chips, validation. `src/library/prefsStore.ts`: saved views. `src/library/browseController.ts`: the query transaction. All unit-tested in `__tests__/library-filters.test.ts`.
- **Saved per provider, server, viewer, library and page** under `anystream.libraryView.v1.<scope>` in MMKV. Movies and Series each keep their own sort. Only a view whose first page loaded is saved: drafts, counts and failed applies never are. Entries are checked field by field when read; unknown or damaged ones count as nothing saved and are not deleted.
- **Restoring:** the saved view is checked against the library's capabilities and genres before the first request, so the first results already use it. Anything no longer available is removed and named in a line under the toolbar.
- **Apply is one transaction:** the old grid stays until the new first page arrives; failure keeps the old results and leaves the draft and the error in the drawer. Every request has a sequence number; superseded applies, counts and pages are aborted and ignored if they still answer. Changing filters or sort resets paging; pages of two views never mix.
- **Counts:** asked only after a real draft edit, 300 ms after the last one, and only when the server gives exact totals.
- **Back from a title page** restores the same results, loaded pages and focused card from memory (no reload). A top bar visit, a server or profile switch drops that memory and reloads using the saved view.

## Unverified (needs a check on real servers)

These mappings follow the servers' published APIs (Jellyfin OpenAPI; Plex's own `includeMeta` description, as used by python-plexapi) but were not run against Will's servers while writing this:

- Where titles **without** a date, rating or runtime land. Neither server documents null ordering for these sorts; Plex has a `nullsLast` direction, Jellyfin has none.
- Whether Will's Plex server advertises `unwatchedLeaves` for TV (if not, Series shows only "Has unwatched episodes").
- Jellyfin `IsPlayed` on series with missing (virtual) episodes.
- Layout on the stick at 1920 × 1080 design size, and remote navigation from viewing distance.
