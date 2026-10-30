# AnyStream agent guide

AnyStream is a Netflix-style TV client for Jellyfin (Plex later), written in React Native + TypeScript for Amazon Vega OS (Fire TV, formerly "Kepler"). The reference device is the Fire TV Stick 4K Select. Read [README.md](README.md) first; this file adds what an agent needs to work safely in the code.

## Status

- **Milestone M1 is close to the gate.** M1 = project foundation, Jellyfin sign-in, and a playback spike. On 29 Oct 2026, on a Fire TV Stick 4K Select (OS 2.0, armv7), Jellyfin sign-in worked and an HLS transcode played with working sound and skip; Will reported The Matrix (MKV) and a 1080p HEVC SDR title playing. Still unconfirmed: whether MKV goes through URL-mode direct play or the transcode, long-run smoothness, and playback of an MP4.
- The Vega build works (`npm run build:app` in a project made by `vega project generate -t helloWorld`, RN 0.83). SDK 0.24.12112 in WSL; the new `vega` CLI (`~/vega/bin`) is needed for `vega devmode`. Type checks and unit tests pass in this folder.
- This folder is a source overlay, not a full Vega project, and is not yet a git repository. The generated project lives in WSL at `~/projects/AnyStream`.

### Vega quirks found on device (all fixed in this folder)

- **Manifest:** the media stack silently fails without the `wants.service` entries in `manifest.additions.toml` (audio.control, audio.system, mediabuffer, mediatransform, playersession, media.server, gipc, audio.stream, and the accessibility privilege). Missing `audio.control` shows up as "Internal data stream error, reason not-negotiated".
- **`clearTimeout(-1)` throws** on Vega, which silently killed hls.js's fragment loader (stream buffered forever). `src/player/timerGuard.ts` ignores that error.
- **`MediaSource.isTypeSupported` throws** (InvalidOperationError) for codecs the device cannot decode, e.g. ac-3. `src/player/mseGuard.ts` turns that into `false`.
- **HLS needs `play()` after load** (`PlayerEngine.load`), as in Amazon's sample.
- **Window size:** on the Fire TV Stick 4K Select the app sees a 960 × 540 window at scale 2 (logged at start-up as "AnyStream layout: ..."), not 1920 × 1080. Every size goes through `px()` / `useScale()` in `src/layout.ts` (design pixels × width / 1920), including text via `theme.ts`. Never write a bare number for a size in a style.
- **URL mode stalls silently:** an MKV of HEVC Main 10 with E-AC-3 5.1 (Forgotten Island, 29 Oct 2026) made the native player fail to link its pads ("Failed to link outputMultiQueueSrc to rendererSinkPad") and then sit forever with no `error` event, so the transcode fallback never ran. MKV is out of `directPlayContainers` again, and `PlayerEngine` now fails direct play as recoverable if it shows no metadata within `DIRECT_PLAY_START_TIMEOUT_MS` (15 s).
- **Never give a playing element a new source:** switching to a subtitled stream (29 Oct 2026) hung the native player in `closeInternal` while it shut the old stream down, so the new stream never started. Track changes go through `PlayerEngine.reload`, which frees the element (as leaving the player does) and plays on a new one. Burn-in itself needs `MediaSourceId` in the PlaybackInfo request.
- **H.264 stops at 1080p 8-bit:** a 4K HEVC 10-bit MKV (Aladdin) was transcoded to 4K H.264 and failed in the stick's H.264 decoder. The device profile caps H.264 at 1920 × 1080 and 8-bit, and PlaybackInfo always sends `SubtitleStreamIndex=-1` when no subtitle is chosen so a default PGS track is not burned in. Aladdin and subtitle switching confirmed working on the stick, 29 Oct 2026.
- **Debugging:** `vega device start-log-stream` while reproducing; the device log shows refused services ("Missing the permissions needed to connect") and native player errors.

### Plan

The source of truth is [docs/plan.pdf](docs/plan.pdf); for Home and the visual system, [docs/design.md](docs/design.md) (29 Oct 2026) takes precedence ("AnyStream — App Plan", 28 Oct 2026). Read it before starting a milestone. Summary:

- **Product:** one app that feels like Netflix but plays from the user's own Jellyfin and Plex servers, shipped to the Amazon Appstore at store quality.
- **Server model:** one active server at a time. Home, libraries and Continue Watching show only the active server. Search is the only thing that spans every signed-in server; hits for the same title are grouped by external IDs (TMDB/IMDb/TVDB, then title + year) and offer "Switch to <server>?" / "Also on <server>".
- **v1 goals:** Jellyfin (password, Quick Connect) and Plex (PIN at plex.tv/link) sign-in with multiple servers; Netflix-style home (hero, rows, zoom-on-focus posters); reliable direct play / HLS transcode; resume, watched state and progress synced; profiles with "Who's watching?".
- **Out of scope for v1:** live TV/DVR, music, offline downloads, casting. Trickplay, Skip Intro and next-episode autoplay are v1.1.
- **Test server:** your Jellyfin at `watch.example.com` (HTTPS via Caddy).

| Milestone | Weeks (est.) | Scope | State |
|---|---|---|---|
| **M1 Playback** | 1–2 | Vega project setup, hls.js on device, Jellyfin auth | Done on a Fire TV Stick 4K Select (29 Oct 2026) |
| *Gate: HLS plays on TV* | | **Hard stop:** no UI work until HLS plays smoothly on hardware | Passed on Will's report 29 Oct 2026: two titles played smoothly with sound, skip and pause/resume; MKV-direct vs transcode path and MP4 not yet confirmed |
| M2 Jellyfin | 3–5 | Libraries, detail, series/episodes, progress sync | Code done 29 Oct 2026 (library with shows, movie detail with Resume/Play, series with season tabs and episode list, route stack); unit-tested, not yet installed or tried on the stick |
| M3 Netflix UI | 6–8 | Hero and rows, focus kit polish, search, profiles | Not started |
| *Gate: usable every day* | | | |
| M4 Plex | 9–11 | PIN link auth, decision API, cross-server match | Not started (`ServerKind` already has `'plex'`) |
| M5 Polish, ship | 12–15 | Perf on Fire TV, error states, Appstore checks (see plan "Release polish") | Not started |

### Where the code differs from the plan

The M1 code is a deliberate spike. Close these gaps as the relevant milestone starts, not all at once:

- **React Native version:** the plan targets RN 0.83 (New Architecture); `package.json` pins RN 0.72.17 for type checking. Align with the generated Vega project.
- **`MediaProvider` interface:** the plan's version adds `authenticate`, `getHomeRows`, `getItem`, `getChildren`, `search`, `findByExternalIds` and `imageUrl`. Grow `providers/types.ts` toward it, keeping it provider-agnostic.
- **Item IDs** are raw Jellyfin ids today. The plan namespaces them (`jf:<serverId>:<itemId>`, `plex:<machineId>:<ratingKey>`); do this before cross-server search.
- **Stack not adopted yet:** react-navigation native-stack, FlashList, TanStack Query, Zustand, react-native-fast-image (all Vega ports or pure JS). `App.tsx` switches screens with `useState` for now. Only use native packages from Amazon's ported list.
- **Folders the plan expects:** `providers/plex/`, `providers/aggregate.ts`, `focus/`, `state/`, `theme/` (currently `theme.ts`), plus the nine screens (AddServer, Profiles, Home, SideNav, Library, Detail, Series, Search, Player).
- **Device profile:** the plan lists MKV/TS containers and VP9/AV1 when probed. The code direct-plays MP4 and M4V only and sends everything else, MKV included, through HLS (URL-mode MKV stalled on the stick on 29 Oct 2026). Widen further only after testing on hardware.
- **Strings** are hard-coded; the plan wants them externalised "from day one" (English at launch).
- **Manifest:** `com.amazon.category.main` is still commented out in `manifest.additions.toml`; it is required to launch from the home screen and pass submission.

### Next steps

M1 is not finished until the gate passes. In order:

1. ~~Do a first real build~~ Done 28 Oct 2026.
2. ~~Vendor Amazon's patched hls.js~~ Done (r1.7). Optional later: native HLS playlist parsing (`enableNativeParsing` in `HlsJsPlayer.ts`) to cut the ~340 ms JS parse of a feature-length playlist.
3. Verify `KeplerVideoSurfaceView` lifecycle and caption view wiring in `src/screens/PlayerScreen.tsx`.
4. Confirm Vega permits cleartext `http://` to LAN servers. If not, show a clear error and document HTTPS setup.
5. Use the generated `manifest.toml`'s runtime module id (differs between RN 0.72 and 0.83 templates).
6. Play direct and transcoded titles from `watch.example.com` on a Fire TV Stick 4K Select. That is the gate.

### Open questions (from the plan; don't decide these silently)

- Support Plex remote relay connections, or local and direct only?
- Pricing: free, paid, or a one-time unlock through Vega in-app purchasing?
- Should each profile remember a default server?

## Commands

Run from this folder. They work on any machine with Node; no Vega SDK needed.

```sh
npm install --legacy-peer-deps   # npm workspaces: packages/core and apps/vega
npm run typecheck                # tsc --noEmit, strict, core then vega shell
npm test                         # jest + ts-jest, 400 unit tests in packages/core/__tests__/
```

Layout: `packages/core` is the shared app (`@anystream/core`), `apps/vega` the Vega shell, `apps/fireos` the Fire OS shell. Core code must not import `@amazon-devices/*` or any other native module; anything device-specific goes behind the `Platform` interface in `packages/core/src/platform/index.ts` and is implemented once per shell (`apps/vega/src/platform/`).

Vega device builds happen in a separate project generated by `vega project generate`; see README "Setup". `npm run apply -- <path>` copies `apps/vega/src` into it as `src/`, installs `packages/core` as `node_modules/@anystream/core` and adds runtime deps. Babel, Metro and the full `manifest.toml` come from the generated project; don't add them here.

Run `npm run typecheck && npm test` before calling any change done.

## Architecture

```
App.tsx  ── probes device codecs, loads session, picks a screen
  ├─ screens/AuthFlow          Welcome → Connect (network search) → Sign in or Quick Connect (docs/sign-in.md)
  ├─ screens/BrowseScreen      Movies / Series: library tabs, Filters & Sort drawer, chips, paged grid (docs/library-filters.md)
  ├─ screens/LibraryScreen     plain poster grid (genre pages)
  └─ screens/PlayerScreen      video surface, captions, remote keys
         └─ player/usePlayback (React binding)
               ├─ PlaybackController  one viewing: decision, progress reports, DirectPlay→Transcode retry, cleanup
               └─ PlayerEngine        one media element: surface wait, url vs hls load, state events
                     └─ createEngine.ts  real Vega deps (W3C VideoPlayer, HlsJsPlayer, polyfills)
providers/types.ts  provider-agnostic model (MediaProvider, PlaybackDecision, DeviceCapabilities)
providers/jellyfin/ http client, probe, auth, items, playback decision, DeviceProfile, errors
storage/            SessionStore over KeyValueStore (MMKV on device, MemoryStore fallback)
library/            filter/sort state, saved views per server/viewer/library/page, query transaction (BrowseController)
util/               url candidates/query building, Jellyfin ticks, device id
config.ts, theme.ts constants and the 10-foot UI palette/sizes
```

Key rules the design depends on:

- **Screens and the player only see `providers/types.ts`.** Nothing outside `providers/jellyfin/` may import Jellyfin types. Plex must be addable as a new folder under `providers/` with no changes elsewhere.
- **Playback modes:** `'url'` = direct play via `element.src` (MP4/M4V only); `'hls'` = server transcode via Amazon hls.js. A direct-play error is `recoverable`; the controller retries once with `forceTranscode`.
- **Capabilities:** `DEFAULT_CAPABILITIES` is a conservative baseline. Probing may only remove codecs, never add them, and never empties a list.
- **Progress reporting and transcode stop are best effort** (`safely`); they must never interrupt playback. `stop()` always releases the engine and, for transcodes, calls `DELETE /Videos/ActiveEncodings`.
- **Engine lifecycle is race-prone:** the native surface can appear before or after the engine, and the user can back out mid-load. Preserve the `released` checks and surface-waiter handling in `PlayerEngine`, and add a test for any new async path.
- **Native deps are injected.** `PlayerEngine` takes `EngineDeps`, `JellyfinHttp` takes a `FetchLike`, storage takes a `KeyValueStore`. Keep it that way so logic stays testable in Node.

## Conventions

- TypeScript strict, `noUnusedLocals`, `noImplicitReturns`. Two-space indent, single quotes, trailing commas, braces on every `if`.
- Errors from the Jellyfin layer are `JellyfinError` with a `kind`. Screens show `describeError(e)`: plain language, never status codes or stack traces.
- Time: Jellyfin uses 100 ns ticks. Convert at the provider boundary with `util/ticks.ts`; the rest of the app uses milliseconds.
- Tunables (timeouts, poll intervals, seek step) live in `src/config.ts`, not inline.
- Comments explain *why* (device quirks, server behaviour), in short JSDoc lines. Match the existing density.
- Images: request server-resized images (`maxWidth`) via `imageUrl`; never download originals.

### TV UI

- 10-foot UI: use `theme.ts` colours, `spacing.safeMargin` and `type` sizes, and wrap any other size in `px()`. No hard-coded colours or bare pixel numbers.
- Every interactive element needs a visible focus state for D-pad navigation. Use `FocusButton`, and set `preferred` (`hasTVPreferredFocus`) on the first control of each screen.
- `useTVEventHandler` fires each key twice (`eventKeyAction` 0 = press, 1 = release). Act on press only.
- Back (`hardwareBackPress`) exits the current screen and must return `true`.
- Quick Connect is the preferred sign-in because typing on a remote is painful.

### Security and privacy

- Passwords are sent once and never stored. Tokens live only in `SessionStore` on the device and are sent only to their own server (header, or `api_key` on stream URLs because the player can't set headers).
- `DEVICE_NAME` travels in an HTTP header: keep it ASCII.

## Testing

- Jest runs pure TypeScript only (`packages/core/__tests__/**/*.test.ts`, node environment; no platform is registered, so tests only reach pure modules). React Native screens are not unit-tested; they are checked on the simulator/device.
- Use the fakes in `packages/core/__tests__/helpers/fakes.ts` (`fakeFetch`, fake media element and loader, `SESSION`, `DEVICE`). Inject time (`sleep`, `now`, `setInterval`) instead of using real timers.
- New provider or player behaviour needs a test, including failure and cancellation paths.

## Things not to do

- `apps/vega/src/hlsjsplayer/`, `apps/vega/src/PlayerBase.ts` and `apps/vega/src/PlayerInterface.ts` are Amazon's proprietary hls.js release (see its README for the two local edits); don't publish them, and keep the `HlsJsPlayer.isStub` check in `createEngine.ts` harmless when upgrading.
- Don't copy Babel/Metro config or a whole `manifest.toml` into this folder.
- Don't add codecs to `DEFAULT_CAPABILITIES` without testing them on the reference device.
- Don't claim device behaviour is verified unless it was run on Vega hardware or the Virtual Device.
