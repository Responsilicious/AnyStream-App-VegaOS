# AnyStream

A Netflix-style TV client for Jellyfin and Plex servers, built in React Native for Vega OS
(Amazon Fire TV). Version 0.1.0.

## Status (29 Oct 2026)

Version 0.1.0 is uploaded to the Amazon Appstore for armv7, aarch64 and x86_64, and is in Live
App Testing and review. Everything below has been checked on a Fire TV Stick 4K Select unless
marked otherwise.

## What works

- **Jellyfin:** add a server by address or find it on the local network, sign in with Quick
  Connect (nothing to type on a remote) or username and password.
- **Plex:** link an account with a code at plex.tv/link, pick a server, and switch Plex Home
  profiles.
- **Several servers:** saved servers of either kind, a server manager, and quick switching
  between them.
- **Browsing:** Home rows with a featured preview, libraries, genres, search, and movie and series
  pages with seasons and episodes.
- **Playback:** direct play where the stick can decode the file (including 4K HEVC), otherwise a
  server transcode delivered as HLS. Audio and subtitle choice from an in-player menu, resume
  position, progress reporting, and a clean stop that ends the server transcode.
- **Remote:** select toggles play and pause, left and right skip 10 s, back exits.
- 23 unit test suites (about 360 tests) covering auth, connections, providers, playback
  decisions, the player engine and controller.

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
- `announceForAccessibility` does nothing on the stick (Vega's `AccessibilityManager` is missing).
- Vega-specific workarounds are listed under "Vega quirks" in `AGENTS.md`.

## Setup

1. Install the Vega SDK and CLI, then generate a project:
   `vega project generate -t helloWorld --name AnyStream` (pick your own package id).
2. From this folder run:
   `node scripts/apply-to-vega-project.mjs <path-to-generated-project>`
3. In the generated project: `npm install`, then install the Vega packages your template pins
   (`@amazon-devices/react-native-w3cmedia`, `@amazon-devices/react-native-mmkv`,
   `@amazon-devices/keplerscript-netmgr-lib`, `@amazon-devices/keplercrypto`). See
   `vega-project/package.json` for the versions used with React Native 0.83.
4. Merge `manifest.additions.toml` into `manifest.toml`.
5. Vendor Amazon's hls.js as described in `src/hlsjsplayer/README.md`.
6. `npm run build:app`, then run on the Vega Virtual Device or a device.

Babel and Metro configs come from the generated project; don't copy them from here.

`vega-project/` holds reference copies of the working Vega project's `manifest.toml`, `app.json`,
`package.json` and `index.js` (RN 0.83 template, package id `com.anystream.anystream`). Compare
against them rather than copying blindly; `manifest.toml`'s `build-number` must be unique per
uploaded VPKG.

## Amazon hls.js (not in this repo)

HLS playback uses Amazon's patched hls.js, which is Amazon proprietary and is deliberately left out
of git (see `.gitignore`). A fresh clone is missing these files:

- `src/hlsjsplayer/HlsJsPlayer.ts`, `src/hlsjsplayer/dist/`, `src/hlsjsplayer/polyfills/`
- `src/PlayerBase.ts`, `src/PlayerInterface.ts`

To get them, sign in to the Amazon Developer portal, open the Vega documentation page
**Media Player > HLS Player**, and download the hls.js patch package
(`hls-rel-v1.5.11-r<N>.tar.gz`, latest revision; this app was built against `r1.7`). Then follow
`src/hlsjsplayer/README.md` to build it and copy the files into place, including the small local
edits listed there. Until they are in place, type checking, tests that import the player, and
builds will fail. Never commit them.

## Develop here without the SDK

`npm install --legacy-peer-deps && npm run typecheck && npm test` works on any machine with Node,
once the Amazon hls.js files above are in place.

## Layout

- `src/providers`: the `MediaProvider` interface with Jellyfin and Plex implementations.
- `src/connections`: saved servers and accounts (`ConnectionStore`), and switching between them.
- `src/player`: `PlayerEngine` (surface, hls.js, URL mode), `PlaybackController` (progress, fallback), `usePlayback`.
- `src/screens`, `src/components`: the UI.
- `src/storage`: sessions, hidden items and device id (MMKV, with an in-memory fallback for tests).

## Licence

Proprietary, all rights reserved. No copying, distribution or derivative works without written permission. See `LICENSE`.
