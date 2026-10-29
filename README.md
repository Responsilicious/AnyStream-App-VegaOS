# AnyStream (M1)

A Netflix-style TV client for Jellyfin (Plex later), built in React Native for Vega OS.

M1 covers three things: the project foundation, Jellyfin sign-in, and a playback spike
that proves video plays on a real device.

## What works

- Add a Jellyfin server by address (HTTPS preferred, falls back through sensible candidates).
- Sign in with Quick Connect (nothing to type on a remote) or username and password.
- Browse libraries as a poster grid, play a title.
- Playback: direct play for MP4/M4V (H.264, HEVC) through the W3C media player; automatic fallback to
  a server transcode (HLS) when direct play isn't possible or fails.
- Resume position, progress reporting, and clean stop (including ending the server transcode).
- Remote control: select/play-pause toggles, left/right skip 10 s, back exits.
- 238 unit tests covering auth, URL handling, playback decisions, the player engine and controller.

## What is not here yet

Home rows, hero, genre menu, search, multi-server handling, Plex, settings and store polish
are M2 onward (see the plan doc).

## Honest status

It builds with the Vega SDK and has run on a Fire TV Stick 4K Select: sign-in works and an HLS transcode
plays with sound and skip. Several Vega-specific bugs were fixed to get there; see "Vega quirks found on
device" in `AGENTS.md`. Not yet verified on the stick: MKV in URL-mode direct play, MP4 direct play,
long-run smoothness, and the remaining risks below.

1. Amazon's hls.js is vendored (see `src/hlsjsplayer/README.md`); keep it out of public repos.
2. `KeplerVideoSurfaceView` lifecycle and caption view wiring in `src/screens/PlayerScreen.tsx`.
3. Plain `http://` servers (common on home networks): confirm Vega permits cleartext traffic. If not,
   the app needs HTTPS servers.
4. `manifest.toml` runtime module id differs between React Native 0.72 and 0.83 templates.
   Use the generated one and only merge in the entries from `manifest.additions.toml`.

Test on a physical Fire TV Stick 4K Select before judging performance.

## Setup

1. Install the Vega SDK and CLI, then generate a project:
   `vega project generate -t helloWorld --name AnyStream` (pick your own package id).
2. From this folder run:
   `node scripts/apply-to-vega-project.mjs <path-to-generated-project>`
3. In the generated project: `npm install`, then install the Vega packages your template pins
   (`@amazon-devices/react-native-w3cmedia`, `@amazon-devices/react-native-mmkv`).
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

- `src/providers`: `MediaProvider` interface and the Jellyfin implementation. Plex will be a second provider.
- `src/player`: `PlayerEngine` (surface, hls.js, URL mode), `PlaybackController` (progress, fallback), `usePlayback`.
- `src/screens`, `src/components`: the UI.
- `src/storage`: sessions and device id (MMKV, with an in-memory fallback for tests).

## Licence

Proprietary, all rights reserved. No copying, distribution or derivative works without written permission. See `LICENSE`.
