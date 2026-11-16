# AnyStream for the web

The shared app (`packages/core`) running in a desktop browser through react-native-web. Same screens,
providers (Jellyfin, Emby, Plex), connections and player logic as the Vega and Fire OS builds; this folder
only supplies the browser's `Platform` (see `packages/core/src/platform/index.ts`).

## Run it

From the repository root:

```sh
npm install --legacy-peer-deps
npm run web          # http://localhost:8080, rebuilds on save
npm run build:web    # static site in apps/web/dist/ (index.html, app.js, assets/)
```

`dist/` is plain files: host it on any web server or open it from `npm run web`. No server-side code.

## Controls

The UI is the TV's 10-foot design, drawn on a 1920 × 1080 stage scaled to fit the window (letterboxed when the
window is not 16:9). Full screen (F11, or double-click in the player) gives the TV look.

| Key / mouse | Does |
|---|---|
| Arrow keys | Move focus, like the remote's D-pad |
| Enter | Select the focused control |
| Escape, Backspace, browser Back, mouse back button | Back |
| Typing | Goes into the field when the on-screen keyboard is open, and into Search |
| Space | Play / pause in the player |
| Left / Right | Skip back / forward in the player |
| Down or M | Audio and subtitles in the player |
| Click | Anything; in the player, play / pause |
| Right click (player) | Audio and subtitles |
| Double click (player) | Full screen |

Tab also moves focus, in page order.

## Playback

- `<video>` plays MP4 directly; anything else is remuxed or transcoded by the server to HLS in fragmented MP4,
  played by [hls.js](https://github.com/video-dev/hls.js) (or Safari's own HLS player).
- Codec lists come from the browser (`MediaSource.isTypeSupported`): H.264 and AAC always; HEVC, AC-3 and
  E-AC-3 only where the browser decodes them (Safari, Edge, Chrome with a hardware HEVC decoder).
- Subtitles are burned in by the server, as on the TVs.

## Things a browser enforces

- **CORS.** The page calls the media server from another origin. Jellyfin and Emby allow any origin by
  default; Plex Media Server and plex.tv serve Plex's own web app cross-origin, but AnyStream's Plex calls have
  not been tried from a browser yet. A reverse proxy in front of the
  server must pass the server's `Access-Control-*` headers through (and answer `OPTIONS` preflights) rather
  than strip or replace them.
- **Mixed content.** A page served over `https://` cannot reach an `http://` server. Host the page over
  `http://` on the LAN, or give the server an `https://` address (a reverse proxy; Plex's `plex.direct`
  addresses are https).
- **No network search.** A web page cannot read its machine's address, so "Find servers on this network" says
  it cannot search; type the server's address instead.
- **Autoplay.** Browsers may refuse to start sound without a recent click or key press. The film then waits
  paused; Space or a click starts it.
- **Storage.** Sign-ins are kept in `localStorage` for this site on this browser profile (memory only where
  the browser blocks storage, such as some private windows). Passwords are never stored.

## Layout

```
scripts/build.mjs          esbuild bundle; 'react-native' is aliased to src/rn
src/index.tsx              registers the platform, the keyboard and history Back, renders App into #stage
src/rn/index.ts            react-native-web plus TV shims: BackHandler, hasTVPreferredFocus, a fixed 1920 × 1080 window
src/platform/
  index.ts                 the web Platform
  videoElement.ts          <video> as the engine's MediaElementLike; moves into the player's surface
  createEngine.ts          PlayerEngine with hls.js (or native HLS)
  capabilities.ts          codec lists from the browser
  VideoSurface.tsx         the player's host <div>, mouse gestures, Back button on mouse move
  keys.ts                  keyboard → remote key names, typing into on-screen keyboards
  spatialNavigation.ts     arrow-key focus movement
  back.ts                  BackHandler and browser Back
  stage.ts                 the scaled 1920 × 1080 stage
  storage.ts, device.ts    localStorage, browser name for the server's Devices list
```

`npm test -w @anystream/web` runs the unit tests for the pure parts (focus movement, codec lists, Back order).
