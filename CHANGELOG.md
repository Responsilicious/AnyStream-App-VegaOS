# Changelog

What changed in AnyStream, newest first. Dates are when the work landed on a branch; "Unreleased" is not yet in a store build.

## Unreleased

### Added

- **Emby servers** (30 Oct 2026). Add a server by address or find it on the local network, pick a user from the server's own list or type one, and sign in with username and password. Browsing, library filters and sorting, playback, progress and Sign in again all work through the provider layer, reusing the Jellyfin code with Emby's own headers (`X-Emby-Authorization`, `X-Emby-Token`). Addresses are tried as typed and then under `/emby`. Checked by Will on the Fire OS stick against Emby 4.10.2. See `docs/emby.md`.
- "Could not reach this server" screen for Emby, with Try again, Edit address and Choose another provider.
- If an address on the Jellyfin screen turns out to be an Emby server (or the other way round), the app says so and offers to connect it as the right kind instead.
- **Fire OS app** (`apps/fireos`, 30 Oct 2026): a react-native-tvos 0.83 shell for Fire TV sticks on Fire OS 6 and 7, playing through ExoPlayer. Shared code moved to `packages/core`; the Vega shell is `apps/vega`.
- Player: the progress bar shows where a skip will land straight away, and quick repeated skips are sent to the player as one seek.

### Changed

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
