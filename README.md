# AnyStream

A Netflix-style TV client for Jellyfin and Plex servers, built in React Native for Amazon Fire TV:
Vega OS sticks today, Fire OS (Android) sticks next. Version 0.1.0.

## Layout

```
packages/core   shared app: providers, connections, library state, player logic, screens, components
apps/vega       Vega OS shell: Amazon media stack + hls.js, MMKV, netmgr, keplercrypto; overlay for a generated Vega project
apps/fireos     Fire OS (Android TV) shell: ExoPlayer, react-native-tvos (in progress)
```

The core never imports a native module. Each shell builds a `Platform` (player engine, video surface,
storage, network, random source, remote key events) and registers it with `setPlatform()` before
rendering `App`; see `packages/core/src/platform/index.ts`.

## Status (30 Oct 2026)

Version 0.1.0 is in Amazon Appstore Live App Testing as an armv7 package (latest: build 6, which
adds Movies and Series filters and sorting). The Developer Console targets all three Vega Fire TV
sticks from the armv7 package alone, so aarch64 and x86_64 packages are no longer uploaded
(x86_64 is for the Vega Virtual Device only). Everything below has been checked on a Fire TV
Stick 4K Select unless marked otherwise.

## What works

- **Jellyfin:** add a server by address or find it on the local network, sign in with Quick
  Connect (nothing to type on a remote) or username and password.
- **Plex:** link an account with a code at plex.tv/link, pick a server, and switch Plex Home
  profiles.
- **Several servers:** saved servers of either kind, a server manager, and quick switching
  between them.
- **Browsing:** Home rows with a featured preview, libraries, genres, search, and movie and series
  pages with seasons and episodes.
- **Filters and sorting on Movies and Series** (new, 30 Oct; installed and launched on the stick,
  not yet checked against real servers): a Filters & sort panel with genre (any of several),
  watch status and year, and sorts by title, date added, release or first-aired date, rating and
  (movies) runtime. Filtering, sorting and paging run on the server across the whole library;
  Plex offers only what the library advertises. Each page remembers its own choices per server,
  profile and library, and Back from a title page returns to the same card. Details in
  `docs/library-filters.md`.
- **Playback:** direct play where the stick can decode the file (including 4K HEVC), otherwise a
  server transcode delivered as HLS. Audio and subtitle choice from an in-player menu, resume
  position, progress reporting, and a clean stop that ends the server transcode.
- **Remote:** select toggles play and pause, left and right skip 10 s, back exits.
- 23 unit test suites (400 tests) covering auth, connections, providers, playback decisions, the
  player engine and controller, and library filters and sorting.

## Known limitations

- **Credentials are kept in app-private storage (MMKV).** Vega gives apps no keystore, so
  Jellyfin and Plex tokens and the Plex signing key are stored in the app's private storage, not
  encrypted. Passwords are never stored.
- **MKV files are always transcoded by the server.** The stick's player can stall on some MKV
  files without reporting an error, so the app sends them to the server instead of direct play.
- **Plex links with the legacy account token.** Plex's newer JWT linking is written but switched
  off (`PLEX_JWT_SIGN_IN` in `src/config.ts`), because Plex Media Server 1.43.5 refused the tokens
  it produced.
- **Server discovery covers Jellyfin only**, by scanning the local /24 network on port 8096. Vega
  apps can't use UDP, so Jellyfin's own discovery is not possible. Plex servers come from the
  Plex account.
- Some Plex servers' local `plex.direct` HTTPS addresses use a certificate chain the stick doesn't
  trust. Remote or other addresses are used instead.
- **Filters:** series can't be filtered by "Not started" or "In progress" (neither server supports
  it server-side), and age rating and video quality filters aren't built yet. Where titles with no
  date, rating or runtime land in a sort follows each server's own behaviour and is unverified.
- `announceForAccessibility` does nothing on the stick (Vega's `AccessibilityManager` is missing).
- Vega-specific workarounds are listed under "Vega quirks" in `AGENTS.md`.

## Setup

1. Install the Vega SDK and CLI, then generate a project:
   `vega project generate -t helloWorld --name AnyStream` (pick your own package id).
2. From this folder run:
   `npm run apply -- <path-to-generated-project>` (copies `apps/vega/src` to the project's `src/` and
   installs `packages/core` as `node_modules/@anystream/core` there)
3. In the generated project: `npm install`, then install the Vega packages your template pins
   (`@amazon-devices/react-native-w3cmedia`, `@amazon-devices/react-native-mmkv`,
   `@amazon-devices/keplerscript-netmgr-lib`, `@amazon-devices/keplercrypto`). See
   `apps/vega/vega-project/package.json` for the versions used with React Native 0.83.
4. Merge `apps/vega/manifest.additions.toml` into `manifest.toml`.
5. Vendor Amazon's hls.js as described in `apps/vega/src/hlsjsplayer/README.md`.
6. `npm run build:app`, then run on the Vega Virtual Device or a device.

Babel and Metro configs come from the generated project; don't copy them from here.

### Fire OS (Android TV) build

`apps/fireos` is a react-native-tvos 0.83 project for Fire TV sticks running Fire OS 6 or 7 (Android
7.1 and 9; `minSdkVersion` 24). It is not an npm workspace: it keeps its own `node_modules` so React
Native resolves once, and Metro reaches `packages/core` through `metro.config.js`. Video plays through
ExoPlayer (react-native-video), which handles HLS itself, so no hls.js is needed. Package id
`com.anystream.anystream`, the same as the Vega app.

```sh
cd apps/fireos
npm install --legacy-peer-deps
npm run typecheck
npm run build:debug         # needs JDK 17 and the Android SDK (ANDROID_HOME); APK in android/app/build/outputs/apk/debug/
adb connect <stick-ip>:5555 && adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Not yet run on a Fire OS device; see AGENTS.md "Fire OS" for what is unverified.

`apps/vega/vega-project/` holds reference copies of the working Vega project's `manifest.toml`, `app.json`,
`package.json` and `index.js` (RN 0.83 template, package id `com.anystream.anystream`). Compare
against them rather than copying blindly; `manifest.toml`'s `build-number` must be unique per
uploaded VPKG.

## Amazon hls.js (not in this repo)

HLS playback uses Amazon's patched hls.js, which is Amazon proprietary and is deliberately left out
of git (see `.gitignore`). A fresh clone is missing these files:

- `apps/vega/src/hlsjsplayer/HlsJsPlayer.ts`, `.../hlsjsplayer/dist/`, `.../hlsjsplayer/polyfills/`
- `apps/vega/src/PlayerBase.ts`, `apps/vega/src/PlayerInterface.ts`

To get them, sign in to the Amazon Developer portal, open the Vega documentation page
**Media Player > HLS Player**, and download the hls.js patch package
(`hls-rel-v1.5.11-r<N>.tar.gz`, latest revision; this app was built against `r1.7`). Then follow
`apps/vega/src/hlsjsplayer/README.md` to build it and copy the files into place, including the small local
edits listed there. Until they are in place, type checking, tests that import the player, and
builds will fail. Never commit them.

## Develop here without the SDK

`npm install --legacy-peer-deps && npm run typecheck && npm test` works on any machine with Node,
once the Amazon hls.js files above are in place.

## Layout

- `src/providers`: the `MediaProvider` interface with Jellyfin and Plex implementations.
- `src/library`: Movies and Series filter and sort state, saved views, and the query transaction (`BrowseController`).
- `src/connections`: saved servers and accounts (`ConnectionStore`), and switching between them.
- `src/player`: `PlayerEngine` (surface, hls.js, URL mode), `PlaybackController` (progress, fallback), `usePlayback`.
- `src/screens`, `src/components`: the UI.
- `src/storage`: sessions, hidden items and device id (MMKV, with an in-memory fallback for tests).

## Licence

Proprietary, all rights reserved. No copying, distribution or derivative works without written permission. See `LICENSE`.
