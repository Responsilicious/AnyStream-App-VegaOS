# Emby

Implements the manual path of Will's Emby connection handoff (v2.0, 30 Oct 2026, screens EC01–EC10). Status: checked by Will on the Fire OS stick (Fire TV Stick Lite, Fire OS 7.7) against Emby 4.10.2 on 30 Oct 2026: sign-in, browsing, filters and playback. Not yet tried on a Vega stick.

## How it fits

Emby and Jellyfin share an API (Jellyfin forked from Emby), so Emby has no browsing or playback code of its own. `JellyfinProvider` serves both. Its HTTP client (`JellyfinHttp`) has a dialect, chosen from the server's kind by `httpForServer`:

| | Jellyfin | Emby |
|---|---|---|
| Client header | `Authorization: MediaBrowser Client=…, Token=…` | `X-Emby-Authorization: Emby Client=…` |
| Token | inside `Authorization` | `X-Emby-Token` |
| Stream URLs | `api_key` query | `api_key` query |
| Quick Connect | yes | no (never offered) |
| Public user list before sign-in | not used | `GET /Users/Public` |

Jellyfin keeps its own header because Jellyfin 10.11 turns the legacy `X-Emby-*` headers off by default.

| Area | Files |
|---|---|
| Emby-only calls (public users, initials) | `packages/core/src/providers/emby/index.ts` |
| Headers by dialect | `providers/jellyfin/http.ts` (`ApiDialect`, `authHeaders`) |
| Which product answered, API base | `providers/jellyfin/probe.ts` (`serverProduct`, `probeServer` with `product`) |
| Screens | `ConnectServerScreen` and `SignInScreen` with `family="emby"`, `EmbyUserPickerScreen` (EC04), `ConnectionRecovery` (EC09), `AddServerFlow` steps `emby-*`, Saved in `AddServerFlow` (EC08) |
| Saved servers | `ConnectionStore.addJellyfin` with `provider: 'emby'`; ids are `emby:<server id>`, so an Emby server never merges with a Jellyfin one |

## Decisions

- **API base.** The address is tried as typed, then with `/emby` added if the first answer is a 404 or not the API (for example the web app's HTML). Emby's own apps use `/emby`; a reverse proxy may forward only one of the two. An address already ending in `/emby` is never doubled. The base that answered is what gets saved, so every later request, image and stream URL uses it.
- **Which product.** `/System/Info/Public` is the check. Jellyfin names itself in `ProductName` and is on version 10 or later; Emby leaves `ProductName` out and is on 4.x. If the Emby screen reaches a Jellyfin server (or the other way round), it says so and offers "Connect as Jellyfin instead". It never signs in through the other provider's screens without being asked.
- **Network search** is the same /24 sweep on port 8096 as Jellyfin (Vega apps have no UDP, so Emby's UDP discovery is out too). It lists only Emby servers on the Emby screen. Choosing one runs the normal check before sign-in.
- **User list (EC04).** Only the server's public list. With no public users (or any failure to fetch the list) the sign-in form opens directly. Picking a user only fills in the username; a user with no password still goes through a real sign-in request.
- **Sign-in (EC05).** Username and password once, in the body, exactly as typed. An empty password is allowed. A token with no user in the answer is not accepted. The password is never stored.
- **Saving and switching (EC08).** Adding in-app never switches. One added server gets "Emby server added", which server is still in use, and Switch to / Keep current server. This applies to Jellyfin and Plex single additions too. First launch opens the server as before. Signing in again as the same user on the same server refreshes the entry instead of adding one.
- **Could not reach (EC09)** is its own screen for an unreachable or timed-out Emby address, with Try again, Edit address and Choose another provider. The address is kept. Certificate, wrong product and bad address stay on the form with their own message.
- **Sign in again.** An expired Emby sign-in (at start-up or from Settings → Servers) opens Emby's sign-in on the same server with the username filled in.
- **Wording** follows the handoff's §15 copy table for Emby. Jellyfin's wording is unchanged.

## Not built, and why

- **Emby Connect (EC01, EC06, EC07).** The handoff says to enable it only once the current TV PIN protocol is verified, and that protocol is not documented. With Connect off, EC01 would be a one-card screen, so the Emby card goes straight to the address screen (EC02), as the handoff allows ("omit its card").
- **Profile PIN (EC10).** Emby's four-digit profile protection has no documented client API, and the handoff forbids inventing one. A protected profile is not unlocked by AnyStream. Whether the server enforces its PIN on a fresh device sign-in needs checking on a real server.
- **Reconnect for a different user.** Sign in again on a saved Emby server with another user adds a second entry, as with Jellyfin.

## Still to check in detail

- Emby 4.10.2 answers `/System/Info/Public` and `/Users/Public` both at the root and under `/emby`, with no `ProductName` (checked 30 Oct 2026). Older versions behind a proxy may answer only one; the code handles either.
- That Emby accepts the Jellyfin device profile in `PlaybackInfo` unchanged, returns a server-relative `TranscodingUrl` under the API base, and honours `SubtitleStreamIndex=-1`.
- Filters: `GenreIds`, `Years`, `IsPlayed`, `Filters=IsResumable` and the sort fields (`SortName`, `DateCreated`, `PremiereDate`, `CommunityRating`, `Runtime`) on `/Users/{id}/Items`. Emby supports all of these in its API reference; Next Up's `DisableFirstEpisode`, `EnableResumable` and `EnableRewatching` are Jellyfin's and Emby may ignore them, so Up Next could include a series' first episode.
- Progress reports (`/Sessions/Playing*`) and stopping a transcode (`DELETE /Videos/ActiveEncodings`).
