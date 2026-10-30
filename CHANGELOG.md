# Changelog

What changed in AnyStream, newest first. Dates are when the work landed on a branch; "Unreleased" is not yet in a store build.

## Unreleased

### Added

- **Search across servers** (30 Oct 2026). Search asks every connected Jellyfin, Emby and Plex server at once and shows one card per title, with the server it is on or “On 3 servers”. Results appear as each server answers; a server that fails keeps the others' results up and gets its own Retry. A copy on another server asks “Switch to <server>?” before anything changes, then opens the title there. Back from a title returns to the same search and card. Title pages offer “Also on <server>” when another server has the same title (matched by TMDB, IMDb or TVDB id). See `docs/cross-server-search.md`. Not yet tried on a stick.
- **Emby servers** (30 Oct 2026). Add a server by address or find it on the local network, pick a user from the server's own list or type one, and sign in with username and password. Browsing, library filters and sorting, playback, progress and Sign in again all work through the provider layer, reusing the Jellyfin code with Emby's own headers (`X-Emby-Authorization`, `X-Emby-Token`). Addresses are tried as typed and then under `/emby`. Checked by Will on the Fire OS stick against Emby 4.10.2. See `docs/emby.md`.
- "Could not reach this server" screen for Emby, with Try again, Edit address and Choose another provider.
- If an address on the Jellyfin screen turns out to be an Emby server (or the other way round), the app says so and offers to connect it as the right kind instead.
- **Fire OS app** (`apps/fireos`, 30 Oct 2026): a react-native-tvos 0.83 shell for Fire TV sticks on Fire OS 6 and 7, playing through ExoPlayer. Shared code moved to `packages/core`; the Vega shell is `apps/vega`.
- Player: the progress bar shows where a skip will land straight away, and quick repeated skips are sent to the player as one seek.

### Changed

- **MKV and 4K playback** (30 Oct 2026). MKV direct plays again where the player can read it: always on Fire OS (ExoPlayer, including HEVC and Dolby audio), and H.264 MKVs over https on Vega. Anything else streams as a remux that keeps the original video: the app now asks for fragmented MP4 segments with HEVC allowed, so a 4K HEVC film stays 4K HEVC instead of being re-encoded to 1080p H.264, and only audio the TV cannot take is converted. Choosing another audio track keeps the video too. Fixes along the way: Vega's start-up codec probe wrongly reported that the stick plays no AAC or Dolby audio, which transcoded every MKV; Jellyfin burned in a title's default subtitle when none was chosen; Vega's file player refuses http:// links, so such servers now go straight to the remux instead of waiting 15 seconds; Plex no longer asks for 1080p on a 4K TV. Checked on both sticks by Will: Fire OS MKV direct play, Vega HEVC 10-bit remux, subtitles off.
- Adding a single server from inside the app ends on "<Provider> server added", which names the server still in use and offers Switch to <server> or Keep current server (all providers).
- Network search lists only servers of the kind being added.

### Not built yet

- Emby Connect sign-in and Emby profile PINs: Emby doesn't document how TV apps should do either, so they stay off until verified.

## 0.1.0 (Live App Testing, Vega)

- Jellyfin sign-in with Quick Connect or username and password; Plex account linking at plex.tv/link with Plex Home profiles.
- Several saved servers with a server manager and quick switcher.
- Home rows, libraries, genres, search, movie and series pages.
- Movies and Series filters and sorting (build 6).
- Direct play where the stick can decode the file, HLS transcode otherwise, with audio and subtitle choice, resume and progress reporting.
