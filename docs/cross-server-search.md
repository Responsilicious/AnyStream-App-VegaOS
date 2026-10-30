# Cross-server search

Implementation plan, 30 October 2026. Built on branch `feature/cross-server-search`; see “Implementation status” at the end.

## Outcome

Search connected Plex, Emby and Jellyfin servers together. Show one card per matched title, with the servers that have it. Home, libraries, progress and playback remain specific to the active server and its profile.

This extends the cross-server search and “Also on” behaviour in `docs/plan.pdf`, following the keyboard, filters and TV layout in `docs/design.md`.

## Current foundations

- All three providers implement `MediaProvider.search(term, filter)`. Emby uses the Jellyfin provider with its own authentication headers.
- `SearchScreen` currently searches one provider after a 300 ms debounce. It ignores stale responses, but does not cancel network requests or preserve search state when unmounted.
- Provider items use raw server IDs. Neither provider mapper currently exposes external IDs.
- `ConnectionStore` already supplies saved server/account/profile connections and their sessions. A connection ID can survive a Plex profile change, so it alone cannot identify cached results.
- `ContextCoordinator` validates and prepares a destination before committing a switch. The app currently resets navigation to Home after switching; search needs a destination-aware path.
- Existing search responses are limited: Jellyfin requests 30 items; Plex requests a limit of 30 from its search hubs. The first release must describe results as bounded matches, not an exhaustive library count.

## Proposed experience

1. Keep the current keyboard and All / Movies / Series / Episodes chips. Search all eligible connected sources by default; offer a server selector for All servers or one server.
2. Show a server name and provider label on a single-source card. A grouped card shows “On 3 servers”, with full source names in its source chooser. Disambiguate identical names using provider and profile labels.
3. Selecting a card available on the active connection opens that copy's title page. The title page offers “Also on…” for alternatives. If the active connection has multiple copies, offer a copy chooser.
4. Selecting a card available only elsewhere opens a source chooser where needed, then “Switch to <server>?” with Switch and Cancel. Successful confirmation opens the selected title on that server; focusing a card never switches or plays.
5. Back from the title restores the search query, filter, server scope, results, focused group and scroll position. A successful switch remains the active server, and its copies become preferred. Cancelling or failing a switch keeps the original context and search intact.
6. Results appear as individual servers finish. Show “Searching 2 more servers…” while pending. A failed server leaves successful results visible and offers a targeted Retry. Distinguish no matches, incomplete results, all sources failed and sign-in required.

## 1. Source identity and profile scope

Introduce a provider-neutral search source containing the connection ID, context key, provider kind, server label and a session revision. Resolve credentials privately when constructing a provider; never put tokens or token-bearing artwork URLs in diagnostic output or persisted search state.

Use a structured, collision-safe item reference containing provider, server identity, native item ID and viewer context. Give every source hit a stable namespaced key. Keep native IDs at provider boundaries, translating references before `getItem`, children, playback and progress calls. Do not rewrite every stored item ID as part of search.

For the initial proposal, each saved connection contributes its currently selected, authenticated profile. Do not discover other users, unlock a protected profile, replace a profile token with an owner's token, or fall back to broader credentials. Sources with missing or expired sign-in are reported separately and are not queried. An offline source can be retried; it is not removed from the saved list.

**Product decision before implementation:** if several people have saved accounts on this TV, should all those saved connections be searched together, or should search use an explicit source selection per viewer? Recommended: explicit selection when multiple viewers share the TV; default to all eligible servers for a single viewer. There is no existing cross-provider household identity mapping to infer this safely.

## 2. External IDs and matching

Add optional normalized TMDB, IMDb and TVDB IDs to the shared item/search model. Read provider-specific metadata only inside each provider: Jellyfin/Emby provider IDs and Plex GUID metadata. Verify fields returned by real search responses on all three servers before deciding whether a small, bounded metadata lookup is necessary. Avoid fetching full details for every result.

Implement a pure matching module with these rules:

- Never merge different media kinds.
- Prefer shared external IDs, ordered TMDB, IMDb, TVDB. Namespace IDs by media kind; movie and TV ID spaces can overlap.
- Treat conflicting IDs in a shared namespace as evidence against a merge, including through intermediate matches. Do not let a metadata-poor title bridge two conflicting groups.
- Fall back to normalized title plus exact year only when external IDs do not establish a conflict. Keep normalization conservative: case, Unicode and whitespace; preserve meaningful punctuation and words. Missing year or ambiguous fallback candidates remain separate.
- Episodes require their own matching external ID, or a matched parent series plus season and episode numbers. Episode title and year alone are insufficient. Missing identity or incompatible numbering remains separate.
- Preserve every source copy inside its group. Watched state, resume position, artwork and available versions belong to individual copies; never merge or sync these values between servers.
- Choose the active connection's copy for display where available, then a deterministic source order. Keep group identity and ordering stable as late responses arrive, and preserve focus by group identity when groups combine.

Use simple, explicit relevance buckets: exact title, title prefix, then remaining matches, with stable title/year/source tie breakers. Do not compare provider relevance scores as though they share a scale.

## 3. Search coordinator

Add a pure `search/` module for models, matching and an injected controller. Keep `search.ts` keyboard helpers compatible. The controller accepts source/provider factories, time and cancellation dependencies so it runs in Node tests.

- Add optional cancellation to `MediaProvider.search` and pass it through both provider implementations to their HTTP clients, which already support abort signals.
- Retain the 300 ms debounce. Cancel obsolete work on query/filter/scope changes, screen exit, profile change, sign-out or source removal. Also reject stale generations if transport cancellation arrives late.
- Start with at most three source searches in flight. Put the concurrency limit, per-source deadline and bounded result limits in `config.ts`; tune on hardware.
- Publish independent source states: pending, complete, unavailable, sign-in required, denied or timed out. A hung server must not prevent completion from the others. Retry only failed sources for the current query generation.
- Reuse current endpoint validation/failover rules, especially Plex identity checks before sending a token to a candidate endpoint. Searching never activates a connection or changes last-used ordering.
- Keep a bounded in-memory search session keyed by query, kind filter, scope, viewer contexts and session revisions. Invalidate affected hits and artwork on credential/profile changes or removal. Recompute displayed progress after returning from playback.
- Prevent late responses from deleted or signed-out sources from repopulating results. Do not persist tokens, search history or result snapshots for this feature.

Pagination across providers is a separate extension. Initially apply a documented per-source cap consistently and avoid claiming “all results” or an exact total across truncated sources.

## 4. Navigation and “Also on”

Wire search sources and source-aware selection through `App`, `MainScreen` and `SearchScreen`. Hold search state above the screens that unmount during detail navigation and server switching.

Extend the existing switch transaction to prepare the selected destination item as well as its connection before commit. If the item has disappeared, permissions changed, authentication expired or the switch was superseded, keep the prior active context. On success, open the destination detail route atomically rather than resetting to Home. Continue using that destination provider for all playback and progress operations.

For results opened from search, reuse their known alternatives for “Also on…”. For titles opened from Home or a library, add a cancellable `findByExternalIds` provider capability and aggregator lookup. Verify provider support first; if a provider needs candidate search followed by ID validation, label only verified matches as available. An unavailable lookup is not evidence that a title is absent.

Retain per-source file/version choices; choosing a server does not imply its copy supports playback or has the same cut or quality.

## 5. TV interface and verification

Use the existing focus controls, theme and scaling helpers. Give the source chooser initial focus, contain its focus, and restore the originating card when closed. Announce source names and partial failures accessibly. Keep loaded cards visible during retries and preserve the focused card when later servers complete.

Unit-test identity collisions, provider metadata mapping, conflicts and ambiguous fallback matches; episode numbering; duplicate copies; cancellation and deadlines; partial/all failures; targeted retry; sign-out/removal/profile invalidation; restricted profile credentials; endpoint token isolation; and item preparation or switch cancellation before commit. Inject time and transport rather than waiting on real servers.

Run `npm run typecheck` and `npm test`, plus the Fire OS shell typecheck for UI integration. Check the full interaction on Vega and Fire OS hardware with one server of each kind: same title across three providers, remakes, missing IDs, two copies on one server, an episode, restricted profiles, one offline server, expired sign-in, a disappearing item, switching and Back. Verify playback/progress remain on the chosen server. Measure input responsiveness and first-result time; record server and device versions. No device behaviour is considered verified until these runs happen.

## Delivery order

1. Confirm viewer/source scope; capture sanitized metadata fixtures from the three server types.
2. Add source references, external IDs, conservative matching and unit tests.
3. Add cancellable aggregation, incremental states, source invalidation and tests.
4. Integrate grouped cards, source selection, transactional item opening and search restoration.
5. Add “Also on…” lookups outside search, then complete hardware checks and update the app docs.

Acceptance: one query searches the chosen connected sources; confidently matched titles share a card; failures never hide successful results; opening a remote copy requires an explicit switch; Back restores search; and metadata, credentials and progress stay bound to the correct server and profile.

## Implementation status (30 October 2026)

Built and unit-tested; **not yet run on hardware**, so nothing below is verified on a device.

- **Where the code is:** `packages/core/src/search/` holds the pure parts: `externalIds.ts` (normalised TMDB/IMDb/TVDB), `model.ts` (sources, `refKey` item references, hits, groups, source states), `match.ts` (grouping and ordering), `controller.ts` (`SearchController`, `findAlternatives`) and `sources.ts` (sources from the connection store, labels, default scope, status text). The screen is `screens/SearchScreen.tsx`; the copy and source chooser with “Switch to <server>?” is `components/SourceMenu.tsx`.
- **Providers:** Jellyfin and Emby search asks for `Fields=…,ProviderIds`; Plex search asks `/hubs/search` with `includeGuids=1` and reads the `Guid` list or a legacy agent `guid`. Both pass an abort signal to their HTTP clients. Whether every server really returns these fields in search answers is still to be checked against real responses (step 1 of the delivery order); without them, titles fall back to title + exact year or stay as separate cards.
- **Viewer scope:** built with the recommended default while Will decides. Profile names can't tell people apart across providers, so the app treats the TV as shared only when the same server is saved under two different profiles (for example two Plex Home profiles, or two Jellyfin users on one server). Shared: search starts on the active server only. Otherwise: all servers. Either way the scope button offers “All servers” or one server. The rule is `defaultScope` in `search/sources.ts`.
- **Switching:** `ContextCoordinator.switchTo(id, destination)` fetches the chosen title from its server after the usual check and prepare and before commit. Success opens the title on that server over the section the user came from; a missing title, refused sign-in or a cancelled switch leaves everything as it was and the chooser shows why.
- **Restoring:** the controller lives in `App`, so Back from a title page shows the same query, filter, scope, results and focused card. Answers stay in memory only (up to `SEARCH_SESSION_ENTRIES` recent queries) and are dropped per source when its profile or token changes, or it is removed.
- **“Also on…”:** a title opened from search reuses the group's other copies. A title opened from Home or a library runs `findAlternatives`: it searches the other servers by title and keeps only copies whose external ids agree. A failed or slow server just isn't listed. There is no native `findByExternalIds` per provider yet; episodes are not looked up this way.
- **Tunables** in `config.ts`: `SEARCH_CONCURRENCY` (3), `SEARCH_SOURCE_DEADLINE_MS` (8 s), `SEARCH_SESSION_ENTRIES` (12).
- **Not done:** sanitised metadata fixtures from the three real servers; progress on search cards (cards show none, and title pages load fresh progress); pagination across servers; the hardware checks listed above.
